// Publicadores cadastram territórios e quadras (aguardando confirmação), excluem só o
// que cadastraram enquanto não confirmado, e excluem as casas que cadastraram.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addPublisher, daysAgo, newCongregation, startApp, type Ctx } from './helpers.js';

let ctx: Ctx;
let A: Awaited<ReturnType<typeof newCongregation>>;
let p1: Awaited<ReturnType<typeof addPublisher>>;
let p2: Awaited<ReturnType<typeof addPublisher>>;

beforeAll(async () => {
  ctx = await startApp();
  A = await newCongregation(ctx, 'Congregação A');
  p1 = await addPublisher(ctx, A.admin.c, A.cid);
  p2 = await addPublisher(ctx, A.admin.c, A.cid);
});
afterAll(() => ctx.close());

const url = (p: string) => `/api/congregations/${A.cid}${p}`;
const terrInList = async (c: typeof p1.c, id: string) =>
  (await c.get(url('/territories'))).body.territories.find((t: { id: string }) => t.id === id);

describe('territórios e quadras cadastrados por publicador', () => {
  it('publicador cadastra território e quadra; ficam aguardando confirmação', async () => {
    const t = await p1.c.post(url('/territories'), { number: 50, name: 'Novo bairro' });
    expect(t.status).toBe(201);
    expect(t.body.confirmed).toBe(false);
    const b = await p1.c.post(url(`/territories/${t.body.id}/blocks`), { number: 1 });
    expect(b.status).toBe(201);
    expect(b.body.confirmed).toBe(false);

    expect(await terrInList(p1.c, t.body.id)).toMatchObject({ confirmed: false, can_delete: true });
    expect(await terrInList(p2.c, t.body.id)).toMatchObject({ confirmed: false, can_delete: false });
    expect(await terrInList(A.admin.c, t.body.id)).toMatchObject({ confirmed: false, can_delete: true });

    const pend = await A.admin.c.get(url('/pending'));
    expect(pend.body.territories.map((x: { number: number }) => x.number)).toContain(50);
    expect(pend.body.blocks.find((x: { id: string }) => x.id === b.body.id)).toMatchObject({ territory_number: 50, created_by_name: 'Publicador Teste' });
    expect((await A.admin.c.get(url(''))).body.pending).toEqual({ territories: 1, blocks: 1 });
  });

  it('administrador cadastra já confirmado', async () => {
    const t = await A.admin.c.post(url('/territories'), { number: 60 });
    expect(t.body.confirmed).toBe(true);
    expect(await terrInList(p1.c, t.body.id)).toMatchObject({ confirmed: true, can_delete: false });
  });

  it('só quem cadastrou exclui (enquanto não confirmado)', async () => {
    const t = await p1.c.post(url('/territories'), { number: 51 });
    const b = await p1.c.post(url(`/territories/${t.body.id}/blocks`), { number: 1 });
    const other = await p2.c.del(url(`/blocks/${b.body.id}`));
    expect(other.status).toBe(403);
    expect(other.body.error).toBe('NOT_OWNER');
    expect((await p2.c.del(url(`/territories/${t.body.id}`))).body.error).toBe('NOT_OWNER');
    expect((await p1.c.del(url(`/blocks/${b.body.id}`))).status).toBe(200);
    expect((await p1.c.del(url(`/territories/${t.body.id}`))).status).toBe(200);
  });

  it('não exclui se houver casas ou visitas de outras pessoas dentro', async () => {
    const t = await p1.c.post(url('/territories'), { number: 52 });
    const b = await p1.c.post(url(`/territories/${t.body.id}/blocks`), { number: 1 });
    const h = await p2.c.post(url(`/blocks/${b.body.id}/addresses`), { number: '10' });
    expect(h.status).toBe(201);
    const rb = await p1.c.del(url(`/blocks/${b.body.id}`));
    expect(rb.status).toBe(403);
    expect(rb.body.error).toBe('HAS_OTHERS');
    expect((await p1.c.del(url(`/territories/${t.body.id}`))).body.error).toBe('HAS_OTHERS');
    const tb = (await p1.c.get(url(`/territories/${t.body.id}`))).body;
    expect(tb.territory.can_delete).toBe(false);
    expect(tb.blocks[0].can_delete).toBe(false);
    // Uma visita de outra pessoa numa casa do próprio publicador também impede.
    const t2 = await p1.c.post(url('/territories'), { number: 53 });
    const b2 = await p1.c.post(url(`/territories/${t2.body.id}/blocks`), { number: 1 });
    const h2 = await p1.c.post(url(`/blocks/${b2.body.id}/addresses`), { number: '1' });
    await p2.c.post(url(`/addresses/${h2.body.id}/records`), { action: 'absent', occurredOn: daysAgo(0) });
    expect((await p1.c.del(url(`/blocks/${b2.body.id}`))).body.error).toBe('HAS_OTHERS');
    // O administrador exclui assim mesmo.
    expect((await A.admin.c.del(url(`/territories/${t.body.id}`))).status).toBe(200);
  });

  it('depois de confirmado: publicador edita, mas não exclui', async () => {
    const t = await p1.c.post(url('/territories'), { number: 54 });
    const b = await p1.c.post(url(`/territories/${t.body.id}/blocks`), { number: 1 });
    expect((await A.admin.c.post(url(`/territories/${t.body.id}/confirm`))).status).toBe(200);
    expect((await A.admin.c.post(url(`/blocks/${b.body.id}/confirm`))).status).toBe(200);
    const rt = await p1.c.del(url(`/territories/${t.body.id}`));
    expect(rt.status).toBe(403);
    expect(rt.body.error).toBe('CONFIRMED');
    expect((await p1.c.del(url(`/blocks/${b.body.id}`))).body.error).toBe('CONFIRMED');
    expect((await p1.c.patch(url(`/territories/${t.body.id}`), { number: 55, name: 'Corrigido' })).status).toBe(200);
    expect((await p2.c.patch(url(`/blocks/${b.body.id}`), { number: 2, name: 'Esquina' })).status).toBe(200);
    expect(await terrInList(p1.c, t.body.id)).toMatchObject({ number: 55, confirmed: true, can_delete: false });
    const acts = await ctx.db.query(`SELECT action FROM audit_log WHERE entity_id IN ($1, $2)`, [t.body.id, b.body.id]);
    expect(acts.rows.map((r) => r.action)).toEqual(expect.arrayContaining(['territory.create', 'territory.confirm', 'block.confirm', 'territory.update', 'block.update']));
  });

  it('confirmar todos', async () => {
    await p1.c.post(url('/territories'), { number: 56 });
    const r = await A.admin.c.post(url('/pending/confirm-all'));
    expect(r.status).toBe(200);
    expect(r.body.territories).toBeGreaterThanOrEqual(1);
    const pend = await A.admin.c.get(url('/pending'));
    expect(pend.body).toEqual({ territories: [], blocks: [] });
  });
});

describe('casas, prédios e apartamentos', () => {
  it('quem cadastrou exclui a própria casa; outro publicador não', async () => {
    const h = await p1.c.post(url(`/blocks/${A.bid}/addresses`), { number: '700' });
    const blk = (await p1.c.get(url(`/blocks/${A.bid}`))).body;
    expect(blk.addresses.find((a: { id: string }) => a.id === h.body.id).can_delete).toBe(true);
    expect((await p2.c.get(url(`/blocks/${A.bid}`))).body.addresses.find((a: { id: string }) => a.id === h.body.id).can_delete).toBe(false);
    expect((await p2.c.get(url(`/addresses/${h.body.id}`))).body.canDelete).toBe(false);
    const r = await p2.c.del(url(`/addresses/${h.body.id}`));
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('NOT_OWNER');
    // Visitas do próprio publicador não impedem
    await p1.c.post(url(`/addresses/${h.body.id}/records`), { action: 'letter', occurredOn: daysAgo(1) });
    expect((await p1.c.get(url(`/addresses/${h.body.id}`))).body.canDelete).toBe(true);
    expect((await p1.c.del(url(`/addresses/${h.body.id}`))).status).toBe(200);
    expect((await p1.c.get(url(`/addresses/${h.body.id}`))).status).toBe(404);
  });

  it('casa com visita de outra pessoa: só o administrador exclui', async () => {
    const h = await p1.c.post(url(`/blocks/${A.bid}/addresses`), { number: '701' });
    await p2.c.post(url(`/addresses/${h.body.id}/records`), { action: 'contact', occurredOn: daysAgo(0) });
    const r = await p1.c.del(url(`/addresses/${h.body.id}`));
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('HAS_OTHERS');
    // Visita anulada não conta
    const rec = (await p2.c.get(url(`/addresses/${h.body.id}/records`))).body.records[0];
    await p2.c.post(url(`/records/${rec.id}/void`), { reason: 'registro errado' });
    expect((await p1.c.get(url(`/addresses/${h.body.id}`))).body.canDelete).toBe(true);
    const h2 = await p1.c.post(url(`/blocks/${A.bid}/addresses`), { number: '702' });
    await p2.c.post(url(`/addresses/${h2.body.id}/records`), { action: 'contact', occurredOn: daysAgo(0) });
    expect((await A.admin.c.del(url(`/addresses/${h2.body.id}`))).status).toBe(200);
  });

  it('apartamentos: quem cadastrou o prédio exclui; outros não', async () => {
    const b = await p1.c.post(url(`/blocks/${A.bid}/addresses`), {
      kind: 'building', number: '900', units: [{ identifier: '101' }, { identifier: '102' }],
    });
    const units = (await p1.c.get(url(`/addresses/${b.body.id}`))).body.units;
    expect(units.every((u: { can_delete: boolean }) => u.can_delete)).toBe(true);
    expect((await p2.c.del(url(`/units/${units[0].id}`))).status).toBe(403);
    expect((await p1.c.del(url(`/units/${units[0].id}`))).status).toBe(200);
    expect((await p2.c.del(url(`/addresses/${b.body.id}`))).status).toBe(403);
    expect((await p1.c.del(url(`/addresses/${b.body.id}`))).status).toBe(200);
  });
});
