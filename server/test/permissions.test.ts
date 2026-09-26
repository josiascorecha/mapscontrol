// Critérios 5, 6, 7, 10: isolamento, funções administrativas, criação sem aprovação, Administrador Geral.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addPublisher, daysAgo, newCongregation, newUser, startApp, type Ctx } from './helpers.js';

let ctx: Ctx;
let A: Awaited<ReturnType<typeof newCongregation>>;
let B: Awaited<ReturnType<typeof newCongregation>>;
let pubA: Awaited<ReturnType<typeof addPublisher>>;
let houseB: string;

beforeAll(async () => {
  ctx = await startApp();
  A = await newCongregation(ctx, 'Congregação A');
  B = await newCongregation(ctx, 'Congregação B');
  pubA = await addPublisher(ctx, A.admin.c, A.cid);
  houseB = (await B.admin.c.post(`/api/congregations/${B.cid}/blocks/${B.bid}/addresses`, { number: '1' })).body.id;
});
afterAll(() => ctx.close());

describe('7. administrador cria congregação sem aprovação', () => {
  it('fica como administrador imediatamente', async () => {
    const me = await A.admin.c.get('/api/me');
    expect(me.body.membership.role).toBe('admin');
    expect(me.body.membership.congregation.name).toBe('Congregação A');
  });
  it('conta de publicador não cria congregação', async () => {
    const p = await newUser(ctx, 'publisher');
    const r = await p.c.post('/api/congregations', { name: 'Tentativa' });
    expect(r.status).toBe(403);
  });
  it('não cria segunda congregação estando em uma', async () => {
    const r = await A.admin.c.post('/api/congregations', { name: 'Outra' });
    expect(r.status).toBe(409);
  });
});

describe('5. publicador não acessa outra congregação', () => {
  const paths = () => [
    `/api/congregations/${B.cid}`,
    `/api/congregations/${B.cid}/territories`,
    `/api/congregations/${B.cid}/territories/${B.tid}`,
    `/api/congregations/${B.cid}/blocks/${B.bid}`,
    `/api/congregations/${B.cid}/addresses/${houseB}`,
    `/api/congregations/${B.cid}/buildings`,
  ];
  it('leituras retornam 404', async () => {
    for (const p of paths()) expect((await pubA.c.get(p)).status, p).toBe(404);
  });
  it('escritas retornam 404', async () => {
    expect((await pubA.c.post(`/api/congregations/${B.cid}/blocks/${B.bid}/addresses`, { number: '9' })).status).toBe(404);
    expect((await pubA.c.post(`/api/congregations/${B.cid}/addresses/${houseB}/records`, { action: 'contact', occurredOn: daysAgo(0) })).status).toBe(404);
  });
  it('ids de outra congregação sob a própria congregação também são rejeitados', async () => {
    expect((await pubA.c.get(`/api/congregations/${A.cid}/blocks/${B.bid}`)).status).toBe(404);
    expect((await pubA.c.get(`/api/congregations/${A.cid}/addresses/${houseB}`)).status).toBe(404);
    expect((await pubA.c.post(`/api/congregations/${A.cid}/addresses/${houseB}/records`, { action: 'contact', occurredOn: daysAgo(0) })).status).toBe(404);
    expect((await A.admin.c.del(`/api/congregations/${A.cid}/addresses/${houseB}`)).status).toBe(404);
  });
  it('administrador de A também não acessa B', async () => {
    expect((await A.admin.c.get(`/api/congregations/${B.cid}/territories`)).status).toBe(404);
    expect((await A.admin.c.post(`/api/congregations/${B.cid}/codes`, {})).status).toBe(404);
  });
});

describe('6. publicador não executa funções administrativas', () => {
  it('bloqueia estrutura, membros e códigos', async () => {
    const c = pubA.c;
    const cid = A.cid;
    const checks = [
      await c.post(`/api/congregations/${cid}/territories`, { number: 99 }),
      await c.patch(`/api/congregations/${cid}/territories/${A.tid}`, { number: 5 }),
      await c.del(`/api/congregations/${cid}/territories/${A.tid}`),
      await c.post(`/api/congregations/${cid}/territories/${A.tid}/blocks`, { number: 50 }),
      await c.patch(`/api/congregations/${cid}/blocks/${A.bid}`, { number: 51 }),
      await c.del(`/api/congregations/${cid}/blocks/${A.bid}`),
      await c.get(`/api/congregations/${cid}/codes`),
      await c.post(`/api/congregations/${cid}/codes`, {}),
      await c.get(`/api/congregations/${cid}/members`),
      await c.post(`/api/congregations/${cid}/members/${pubA.membershipId}/role`, { role: 'admin' }),
      await c.patch(`/api/congregations/${cid}`, { name: 'X' }),
      await c.get(`/api/congregations/${cid}/audit`),
      await c.post(`/api/congregations/${cid}/maps/resolve`, { url: 'https://maps.app.goo.gl/x' }),
      await c.get('/api/global/congregations'),
    ];
    for (const r of checks) expect(r.status).toBe(403);
  });
  it('mas pode cadastrar casas, prédios e registrar visitas', async () => {
    const h = await pubA.c.post(`/api/congregations/${A.cid}/blocks/${A.bid}/addresses`, { number: '77' });
    expect(h.status).toBe(201);
    const r = await pubA.c.post(`/api/congregations/${A.cid}/addresses/${h.body.id}/records`, { action: 'letter', occurredOn: daysAgo(0) });
    expect(r.status).toBe(201);
  });
});

describe('10. Administrador Geral', () => {
  it('não pode ser obtido por parâmetros enviados no cadastro', async () => {
    const r = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      headers: { origin: ctx.cfg.APP_ORIGIN, 'x-role': 'global', 'x-admin': '1' },
      payload: {
        name: 'Tentativa', email: 'hacker@exemplo.test', password: 'senha-forte-123', intent: 'admin',
        isGlobalAdmin: true, is_global_admin: true, role: 'global',
        acceptTerms: true, termsVersion: ctx.cfg.TERMS_VERSION, privacyVersion: ctx.cfg.PRIVACY_VERSION,
      },
    });
    expect(r.statusCode).toBe(202);
    const u = await ctx.db.query(`SELECT is_global_admin FROM users WHERE email = 'hacker@exemplo.test'`);
    expect(u.rows[0].is_global_admin).toBe(false);
  });

  it('acessa e edita todas as congregações, com auditoria', async () => {
    const g = await newUser(ctx, 'admin', 'Suporte Geral');
    // Promoção só por procedimento de servidor (equivalente ao script bootstrap).
    await ctx.db.query('UPDATE users SET is_global_admin = true WHERE id = $1', [g.id]);

    const list = await g.c.get('/api/global/congregations');
    expect(list.status).toBe(200);
    expect(list.body.congregations.map((c: any) => c.name)).toEqual(expect.arrayContaining(['Congregação A', 'Congregação B']));

    for (const cong of [A, B]) {
      expect((await g.c.get(`/api/congregations/${cong.cid}/territories`)).status).toBe(200);
      const t = await g.c.post(`/api/congregations/${cong.cid}/territories`, { number: 42, name: 'Criado pelo suporte' });
      expect(t.status).toBe(201);
      const h = await g.c.post(`/api/congregations/${cong.cid}/blocks/${cong.bid}/addresses`, { number: '500' });
      expect(h.status).toBe(201);
      expect((await g.c.post(`/api/congregations/${cong.cid}/addresses/${h.body.id}/records`, { action: 'contact', occurredOn: daysAgo(0) })).status).toBe(201);
      expect((await g.c.get(`/api/congregations/${cong.cid}/members`)).status).toBe(200);
    }
    const audit = await ctx.db.query(`SELECT action FROM audit_log WHERE actor_id = $1 AND actor_global`, [g.id]);
    const actions = audit.rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['global.list_congregations', 'territory.create', 'address.create', 'record.contact']));
    const ga = await g.c.get('/api/global/audit');
    expect(ga.body.entries.length).toBeGreaterThan(0);
  });
});

describe('segurança de requisição', () => {
  it('rejeita escrita com origem diferente (CSRF)', async () => {
    const r = await ctx.app.inject({
      method: 'POST',
      url: `/api/congregations/${A.cid}/territories`,
      headers: { origin: 'https://site-malicioso.example', cookie: A.admin.c.cookie! },
      payload: { number: 70 },
    });
    expect(r.statusCode).toBe(403);
  });
  it('sem sessão retorna 401', async () => {
    const r = await ctx.app.inject({ method: 'GET', url: `/api/congregations/${A.cid}` });
    expect(r.statusCode).toBe(401);
  });
});
