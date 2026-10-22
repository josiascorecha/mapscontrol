// Fichas para recorte no modelo da congregação (4 por folha A4, 36 endereços por ficha).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadCardBlocks, shortNames } from '../src/lib/cardsData.js';
import { ENTRIES_PER_CARD, toCards } from '../src/lib/cardsPdf.js';
import { addPublisher, daysAgo, newCongregation, startApp, type Ctx } from './helpers.js';

let ctx: Ctx;
let A: Awaited<ReturnType<typeof newCongregation>>;
let B: Awaited<ReturnType<typeof newCongregation>>;
let pub: Awaited<ReturnType<typeof addPublisher>>;

beforeAll(async () => {
  ctx = await startApp();
  A = await newCongregation(ctx, 'Congregação A');
  B = await newCongregation(ctx, 'Congregação B');
  pub = await addPublisher(ctx, A.admin.c, A.cid);
});
afterAll(() => ctx.close());

const url = (p: string) => `/api/congregations/${A.cid}${p}`;
const get = (path: string, cookie = pub.c.cookie!) => ctx.app.inject({ method: 'GET', url: path, headers: { cookie } });
const pages = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;

describe('montagem das fichas', () => {
  it('36 endereços por ficha; quadra maior continua em outra ficha', () => {
    const entries = Array.from({ length: ENTRIES_PER_CARD + 4 }, (_, i) => ({ label: String(i + 1), date: null }));
    const cards = toCards([
      { territoryNumber: 3, blockNumber: 7, publishers: ['Ana'], entries },
      { territoryNumber: 3, blockNumber: 8, publishers: [], entries: [] },
    ]);
    expect(cards.map((c) => c.block)).toEqual(['7 (1/2)', '7 (2/2)', '8']);
    expect(cards[0].entries).toHaveLength(36);
    expect(cards[1].entries.map((e) => e.label)).toEqual(['37', '38', '39', '40']);
    expect(cards[2].entries).toHaveLength(0);
  });

  it('nomes curtos no campo PUBLICADORES', () => {
    expect(shortNames(['Ana Souza', 'Bruno Lima', 'Ana Prado', 'Carlos'])).toEqual(['Ana S.', 'Bruno', 'Ana P.', 'Carlos']);
  });

  it('endereços na ordem de cadastro, apartamentos com o número do prédio e a data certa', async () => {
    const h1 = await pub.c.post(url(`/blocks/${A.bid}/addresses`), { number: '30' });
    const h2 = await pub.c.post(url(`/blocks/${A.bid}/addresses`), { number: '12' });
    const h3 = await pub.c.post(url(`/blocks/${A.bid}/addresses`), { number: '5A' });
    await pub.c.post(url(`/blocks/${A.bid}/addresses`), {
      kind: 'building', number: '120', units: [{ identifier: '101' }, { tower: 'B', identifier: '201' }],
    });
    await pub.c.post(url(`/addresses/${h1.body.id}/records`), { action: 'letter', occurredOn: daysAgo(5) });
    await pub.c.post(url(`/addresses/${h1.body.id}/records`), { action: 'contact', occurredOn: daysAgo(2) });
    await A.admin.c.post(url(`/addresses/${h2.body.id}/records`), { action: 'letter', occurredOn: daysAgo(3) });
    await pub.c.post(url(`/addresses/${h3.body.id}/records`), { action: 'absent', occurredOn: daysAgo(1) });

    const [card] = await loadCardBlocks(ctx.db, A.cid, [A.bid]);
    expect(card).toMatchObject({ territoryNumber: 1, blockNumber: 1 });
    expect(card.entries).toEqual([
      { label: '30', date: daysAgo(2) }, // contato: data da conversa
      { label: '12', date: daysAgo(3) }, // só carta: data da carta
      { label: '5A', date: null }, // ninguém atendeu: continua em branco
      { label: '120/101', date: null },
      { label: '120/B-201', date: null },
    ]);
    // Quem registrou visitas na quadra, na ordem da primeira visita
    expect(card.publishers).toEqual(['Publicador', 'Admin']);
  });
});

describe('nomes do campo PUBLICADORES editáveis', () => {
  const names = (bid = A.bid) => url(`/blocks/${bid}/card-publishers`);

  it('publicador edita; a ficha usa o texto salvo; vazio volta para os nomes automáticos', async () => {
    const before = (await pub.c.get(url(`/blocks/${A.bid}`))).body.block;
    expect(before.card_publishers).toBeNull();
    expect(before.card_publishers_auto).toBe('Publicador, Admin');

    const r = await pub.c.patch(names(), { names: '  Ana e  Bruno, irmã Carla ' });
    expect(r.status).toBe(200);
    expect(r.body.card_publishers).toBe('Ana e Bruno, irmã Carla');
    expect((await pub.c.get(url(`/blocks/${A.bid}`))).body.block.card_publishers).toBe('Ana e Bruno, irmã Carla');
    expect((await loadCardBlocks(ctx.db, A.cid, [A.bid]))[0].publishers).toEqual(['Ana e Bruno, irmã Carla']);
    const a = await ctx.db.query(`SELECT details FROM audit_log WHERE action = 'block.card_publishers' AND entity_id = $1`, [A.bid]);
    expect(a.rows[0].details).toEqual({ names: 'Ana e Bruno, irmã Carla' });

    expect((await pub.c.patch(names(), { names: '' })).body.card_publishers).toBeNull();
    expect((await loadCardBlocks(ctx.db, A.cid, [A.bid]))[0].publishers).toEqual(['Publicador', 'Admin']);
  });

  it('valida o texto e isola a congregação', async () => {
    expect((await pub.c.patch(names(), { names: 'x'.repeat(201) })).status).toBe(400);
    expect((await pub.c.patch(names(), { names: 'Ana (49) 99999-1234' })).status).toBe(400); // sem telefone
    expect((await pub.c.patch(url(`/blocks/${B.bid}/card-publishers`), { names: 'Ana' })).status).toBe(404);
    expect((await pub.c.patch(`/api/congregations/${B.cid}/blocks/${B.bid}/card-publishers`, { names: 'Ana' })).status).toBe(404); // não é membro
    const b = await ctx.db.query('SELECT card_publishers FROM blocks WHERE id = $1', [B.bid]);
    expect(b.rows[0].card_publishers).toBeNull();
  });
});

describe('rotas', () => {
  it('ficha da quadra: PDF de uma folha, para qualquer membro, com auditoria', async () => {
    const r = await get(url(`/blocks/${A.bid}/pdf-recorte`));
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(String(r.headers['content-disposition'])).toContain('recorte-territorio-1-quadra-1.pdf');
    expect(r.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pages(r.rawPayload)).toBe(1);
    const a = await ctx.db.query(`SELECT 1 FROM audit_log WHERE action = 'block.pdf_cards' AND entity_id = $1`, [A.bid]);
    expect(a.rowCount).toBe(1);
  });

  it('fichas do território: todas as quadras, 4 por folha', async () => {
    for (let n = 2; n <= 6; n++) await A.admin.c.post(url(`/territories/${A.tid}/blocks`), { number: n });
    const r = await get(url(`/territories/${A.tid}/pdf-recorte`));
    expect(r.statusCode).toBe(200);
    expect(String(r.headers['content-disposition'])).toContain('recorte-territorio-1.pdf');
    expect(pages(r.rawPayload)).toBe(2); // 6 quadras → 2 folhas
  });

  it('território sem quadras avisa; outra congregação não acessa', async () => {
    const t = await A.admin.c.post(url('/territories'), { number: 9 });
    const r = await get(url(`/territories/${t.body.id}/pdf-recorte`));
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('NO_BLOCKS');
    expect((await get(`/api/congregations/${B.cid}/blocks/${B.bid}/pdf-recorte`)).statusCode).toBe(404);
    expect((await get(`/api/congregations/${B.cid}/territories/${B.tid}/pdf-recorte`)).statusCode).toBe(404);
  });
});
