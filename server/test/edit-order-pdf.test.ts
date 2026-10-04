// Ordem de cadastro, correção de número (casa e apartamento) e PDF da quadra.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

const numbers = async () =>
  (await pub.c.get(`/api/congregations/${A.cid}/blocks/${A.bid}`)).body.addresses.map((a: { number: string }) => a.number);

describe('ordem de cadastro', () => {
  it('lista na ordem em que foi cadastrado, não em ordem alfanumérica', async () => {
    for (const n of ['120', '94D', 'Fretes', '50', '05']) {
      expect((await pub.c.post(`/api/congregations/${A.cid}/blocks/${A.bid}/addresses`, { number: n })).status).toBe(201);
    }
    expect(await numbers()).toEqual(['120', '94D', 'Fretes', '50', '05']);
  });

  it('apartamentos também seguem a ordem de cadastro', async () => {
    const r = await pub.c.post(`/api/congregations/${A.cid}/blocks/${A.bid}/addresses`, {
      kind: 'building', number: '300', units: [{ identifier: '302' }, { identifier: '101' }, { identifier: '201' }],
    });
    await pub.c.post(`/api/congregations/${A.cid}/addresses/${r.body.id}/units`, { units: [{ identifier: '001' }] });
    const b = await pub.c.get(`/api/congregations/${A.cid}/addresses/${r.body.id}`);
    expect(b.body.units.map((u: { identifier: string }) => u.identifier)).toEqual(['302', '101', '201', '001']);
    expect(await numbers()).toEqual(['120', '94D', 'Fretes', '50', '05', '300']);
  });
});

describe('correção de número', () => {
  it('quem cadastrou corrige o número; a posição e o histórico são mantidos', async () => {
    const list = (await pub.c.get(`/api/congregations/${A.cid}/blocks/${A.bid}`)).body.addresses;
    const casa = list.find((a: { number: string }) => a.number === '50');
    await pub.c.post(`/api/congregations/${A.cid}/addresses/${casa.id}/records`, { action: 'contact', occurredOn: daysAgo(1) });
    const r = await pub.c.patch(`/api/congregations/${A.cid}/addresses/${casa.id}`, { number: '58', street: null, notes: null });
    expect(r.status).toBe(200);
    expect(await numbers()).toEqual(['120', '94D', 'Fretes', '58', '05', '300']);
    const h = await pub.c.get(`/api/congregations/${A.cid}/addresses/${casa.id}/records`);
    expect(h.body.records).toHaveLength(1);
    const audit = await ctx.db.query(`SELECT details FROM audit_log WHERE action = 'address.update' AND entity_id = $1`, [casa.id]);
    expect(audit.rows[0].details).toEqual({ numberFrom: '50', numberTo: '58' });
  });

  it('não permite número repetido na mesma quadra', async () => {
    const list = (await pub.c.get(`/api/congregations/${A.cid}/blocks/${A.bid}`)).body.addresses;
    const casa = list.find((a: { number: string }) => a.number === '05');
    const r = await pub.c.patch(`/api/congregations/${A.cid}/addresses/${casa.id}`, { number: '120' });
    expect(r.status).toBe(409);
  });

  it('outro publicador não edita o que não cadastrou; administrador edita', async () => {
    const other = await addPublisher(ctx, A.admin.c, A.cid);
    const list = (await pub.c.get(`/api/congregations/${A.cid}/blocks/${A.bid}`)).body.addresses;
    const casa = list.find((a: { number: string }) => a.number === '120');
    expect((await other.c.patch(`/api/congregations/${A.cid}/addresses/${casa.id}`, { number: '121' })).status).toBe(403);
    expect((await A.admin.c.patch(`/api/congregations/${A.cid}/addresses/${casa.id}`, { number: '121' })).status).toBe(200);
  });

  it('corrige apartamento e impede duplicado', async () => {
    const list = (await pub.c.get(`/api/congregations/${A.cid}/blocks/${A.bid}`)).body.addresses;
    const predio = list.find((a: { kind: string }) => a.kind === 'building');
    const units = (await pub.c.get(`/api/congregations/${A.cid}/addresses/${predio.id}`)).body.units;
    const u = units.find((x: { identifier: string }) => x.identifier === '001');
    expect((await pub.c.patch(`/api/congregations/${A.cid}/units/${u.id}`, { tower: '', identifier: '101' })).status).toBe(409);
    expect((await pub.c.patch(`/api/congregations/${A.cid}/units/${u.id}`, { tower: 'B', identifier: '102' })).status).toBe(200);
    const after = (await pub.c.get(`/api/congregations/${A.cid}/addresses/${predio.id}`)).body.units;
    expect(after.map((x: { tower: string; identifier: string }) => `${x.tower}${x.identifier}`)).toEqual(['302', '101', '201', 'B102']);
    // de outra congregação: 404
    expect((await B.admin.c.patch(`/api/congregations/${B.cid}/units/${u.id}`, { tower: '', identifier: '9' })).status).toBe(404);
  });
});

describe('PDF da quadra', () => {
  it('gera PDF para membros e registra na auditoria', async () => {
    const r = await ctx.app.inject({ method: 'GET', url: `/api/congregations/${A.cid}/blocks/${A.bid}/pdf`, headers: { cookie: pub.c.cookie! } });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(String(r.headers['content-disposition'])).toContain('territorio-1-quadra-1.pdf');
    expect(r.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(r.rawPayload.length).toBeGreaterThan(2000);
    const a = await ctx.db.query(`SELECT 1 FROM audit_log WHERE action = 'block.pdf' AND entity_id = $1`, [A.bid]);
    expect(a.rowCount).toBe(1);
  });

  it('quadra vazia também gera PDF; outra congregação não acessa', async () => {
    const r = await ctx.app.inject({ method: 'GET', url: `/api/congregations/${B.cid}/blocks/${B.bid}/pdf`, headers: { cookie: B.admin.c.cookie! } });
    expect(r.statusCode).toBe(200);
    const x = await ctx.app.inject({ method: 'GET', url: `/api/congregations/${B.cid}/blocks/${B.bid}/pdf`, headers: { cookie: pub.c.cookie! } });
    expect(x.statusCode).toBe(404);
  });
});
