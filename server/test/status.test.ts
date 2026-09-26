// Critérios 1–4: situação de casas e apartamentos, datas e histórico.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addPublisher, daysAgo, newCongregation, startApp, type Ctx } from './helpers.js';

let ctx: Ctx;
let cid: string, bid: string;
let pub: Awaited<ReturnType<typeof addPublisher>>;

beforeAll(async () => {
  ctx = await startApp();
  const cong = await newCongregation(ctx);
  cid = cong.cid;
  bid = cong.bid;
  pub = await addPublisher(ctx, cong.admin.c, cid);
});
afterAll(() => ctx.close());

async function house(number: string) {
  const r = await pub.c.post(`/api/congregations/${cid}/blocks/${bid}/addresses`, { number });
  expect(r.status).toBe(201);
  return r.body.id as string;
}
const status = async (aid: string) => (await pub.c.get(`/api/congregations/${cid}/addresses/${aid}`)).body.status;

describe('casas', () => {
  it('cadastro usa "casa" como padrão', async () => {
    const aid = await house('10');
    const r = await pub.c.get(`/api/congregations/${cid}/addresses/${aid}`);
    expect(r.body.address.kind).toBe('house');
  });

  it('1. casa sem contato permanece pendente, inclusive após ausência', async () => {
    const aid = await house('12');
    expect((await status(aid)).status).toBe('pending');
    const r = await pub.c.post(`/api/congregations/${cid}/addresses/${aid}/records`, { action: 'absent', occurredOn: daysAgo(1) });
    expect(r.status).toBe(201);
    const s = await status(aid);
    expect(s.status).toBe('pending');
    expect(s.last_contact_on).toBeNull();
    expect(s.last_absent_on).toBe(daysAgo(1));
  });

  it('2. carta mantém a pendência e registra a data da carta', async () => {
    const aid = await house('14');
    await pub.c.post(`/api/congregations/${cid}/addresses/${aid}/records`, { action: 'letter', occurredOn: daysAgo(3) });
    const s = await status(aid);
    expect(s.status).toBe('letter');
    expect(s.last_letter_on).toBe(daysAgo(3));
    expect(s.last_contact_on).toBeNull();
  });

  it('3. contato registra a data da conversa; carta/ausência posteriores não apagam o contato', async () => {
    const aid = await house('16');
    await pub.c.post(`/api/congregations/${cid}/addresses/${aid}/records`, { action: 'letter', occurredOn: daysAgo(10) });
    await pub.c.post(`/api/congregations/${cid}/addresses/${aid}/records`, { action: 'contact', occurredOn: daysAgo(5) });
    let s = await status(aid);
    expect(s.status).toBe('contacted');
    expect(s.last_contact_on).toBe(daysAgo(5));
    await pub.c.post(`/api/congregations/${cid}/addresses/${aid}/records`, { action: 'absent', occurredOn: daysAgo(1) });
    await pub.c.post(`/api/congregations/${cid}/addresses/${aid}/records`, { action: 'letter', occurredOn: daysAgo(0) });
    s = await status(aid);
    expect(s.status).toBe('contacted');
    expect(s.last_contact_on).toBe(daysAgo(5)); // data do contato não se confunde com a da carta
    const hist = await pub.c.get(`/api/congregations/${cid}/addresses/${aid}/records`);
    expect(hist.body.records).toHaveLength(4);
    expect(hist.body.records[0]).toMatchObject({ action: 'letter', author_name: 'Publicador Teste' });
  });

  it('anular um registro o mantém no histórico e recalcula a situação', async () => {
    const aid = await house('18');
    const r = await pub.c.post(`/api/congregations/${cid}/addresses/${aid}/records`, { action: 'contact', occurredOn: daysAgo(2) });
    expect((await status(aid)).status).toBe('contacted');
    const v = await pub.c.post(`/api/congregations/${cid}/records/${r.body.id}/void`, { reason: 'Casa errada' });
    expect(v.status).toBe(200);
    expect((await status(aid)).status).toBe('pending');
    const hist = await pub.c.get(`/api/congregations/${cid}/addresses/${aid}/records`);
    expect(hist.body.records[0].voided_at).not.toBeNull();
  });

  it('rejeita data futura e observação com telefone', async () => {
    const aid = await house('20');
    const future = new Date(Date.now() + 5 * 86400_000).toISOString().slice(0, 10);
    expect((await pub.c.post(`/api/congregations/${cid}/addresses/${aid}/records`, { action: 'contact', occurredOn: future })).status).toBe(400);
    const r = await pub.c.post(`/api/congregations/${cid}/addresses/${aid}/records`, { action: 'contact', occurredOn: daysAgo(0), note: 'ligar 49 99999-1234' });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/telefone/);
  });
});

describe('prédios e apartamentos', () => {
  it('4. cada apartamento mantém seu próprio histórico e situação', async () => {
    const r = await pub.c.post(`/api/congregations/${cid}/blocks/${bid}/addresses`, {
      kind: 'building',
      number: '300',
      name: 'Edifício Teste',
      units: [
        { tower: 'A', identifier: '101' },
        { tower: 'A', identifier: '102' },
        { tower: 'B', identifier: '101' },
      ],
    });
    expect(r.status).toBe(201);
    const aid = r.body.id;
    const b = await pub.c.get(`/api/congregations/${cid}/addresses/${aid}`);
    expect(b.body.units).toHaveLength(3);
    const [a101, a102, b101] = b.body.units;
    expect([a101.tower, a101.identifier, b101.tower]).toEqual(['A', '101', 'B']);

    await pub.c.post(`/api/congregations/${cid}/addresses/${aid}/records`, { unitId: a101.id, action: 'letter', occurredOn: daysAgo(4) });
    await pub.c.post(`/api/congregations/${cid}/addresses/${aid}/records`, { unitId: a102.id, action: 'contact', occurredOn: daysAgo(2) });

    const after = (await pub.c.get(`/api/congregations/${cid}/addresses/${aid}`)).body.units;
    const byId = Object.fromEntries(after.map((u: any) => [u.id, u]));
    expect(byId[a101.id]).toMatchObject({ status: 'letter', last_letter_on: daysAgo(4), last_contact_on: null });
    expect(byId[a102.id]).toMatchObject({ status: 'contacted', last_contact_on: daysAgo(2) });
    expect(byId[b101.id]).toMatchObject({ status: 'pending' });

    const h1 = await pub.c.get(`/api/congregations/${cid}/addresses/${aid}/records?unitId=${a101.id}`);
    const h3 = await pub.c.get(`/api/congregations/${cid}/addresses/${aid}/records?unitId=${b101.id}`);
    expect(h1.body.records).toHaveLength(1);
    expect(h3.body.records).toHaveLength(0);

    // Registro em prédio exige apartamento
    const noUnit = await pub.c.post(`/api/congregations/${cid}/addresses/${aid}/records`, { action: 'contact', occurredOn: daysAgo(0) });
    expect(noUnit.status).toBe(400);

    // Inclusão em lote ignora duplicados
    const more = await pub.c.post(`/api/congregations/${cid}/addresses/${aid}/units`, { units: [{ tower: 'A', identifier: '101' }, { tower: 'A', identifier: '103' }] });
    expect(more.body).toEqual({ created: 1, skipped: ['A 101'] });

    // Visão de prédios e cartas
    const list = await pub.c.get(`/api/congregations/${cid}/buildings?onlyLetters=1`);
    expect(list.body.buildings).toHaveLength(1);
    expect(list.body.buildings[0].letter_units[0]).toMatchObject({ tower: 'A', identifier: '101', lastLetterOn: daysAgo(4) });
    expect(list.body.buildings[0]).toMatchObject({ territory_number: 1, block_number: 1 });
  });

  it('apartamento de outro prédio é rejeitado', async () => {
    const p1 = await pub.c.post(`/api/congregations/${cid}/blocks/${bid}/addresses`, { kind: 'building', number: '400', units: [{ identifier: '1' }] });
    const p2 = await pub.c.post(`/api/congregations/${cid}/blocks/${bid}/addresses`, { kind: 'building', number: '402', units: [{ identifier: '1' }] });
    const u2 = (await pub.c.get(`/api/congregations/${cid}/addresses/${p2.body.id}`)).body.units[0];
    const r = await pub.c.post(`/api/congregations/${cid}/addresses/${p1.body.id}/records`, { unitId: u2.id, action: 'contact', occurredOn: daysAgo(0) });
    expect(r.status).toBe(404);
  });
});
