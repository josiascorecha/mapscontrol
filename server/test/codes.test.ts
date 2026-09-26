// Critérios 8 e 9: códigos de uso único e revogação com sessões abertas.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, daysAgo, newCongregation, newUser, startApp, type Ctx } from './helpers.js';

let ctx: Ctx;
let A: Awaited<ReturnType<typeof newCongregation>>;

beforeAll(async () => {
  ctx = await startApp();
  A = await newCongregation(ctx);
});
afterAll(() => ctx.close());

describe('8. códigos de acesso', () => {
  it('é aleatório, guardado como hash e mostrado só na criação', async () => {
    const r1 = await A.admin.c.post(`/api/congregations/${A.cid}/codes`, { label: 'Teste' });
    const r2 = await A.admin.c.post(`/api/congregations/${A.cid}/codes`, {});
    expect(r1.body.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(r1.body.code).not.toBe(r2.body.code);
    const stored = await ctx.db.query('SELECT code_hash, code_hint FROM access_codes WHERE id = $1', [r1.body.id]);
    expect(stored.rows[0].code_hash.toString()).not.toContain(r1.body.code.replace(/-/g, ''));
    const list = await A.admin.c.get(`/api/congregations/${A.cid}/codes`);
    expect(JSON.stringify(list.body)).not.toContain(r1.body.code);
  });

  it('não pode ser reutilizado', async () => {
    const { code } = (await A.admin.c.post(`/api/congregations/${A.cid}/codes`, {})).body;
    const p1 = await newUser(ctx);
    const p2 = await newUser(ctx);
    expect((await p1.c.post('/api/join', { code })).status).toBe(200);
    const again = await p2.c.post('/api/join', { code });
    expect(again.status).toBe(400);
    expect(again.body.error).toBe('CODE_INVALID');
  });

  it('consumo concorrente: só um usuário consegue', async () => {
    const { code } = (await A.admin.c.post(`/api/congregations/${A.cid}/codes`, {})).body;
    const users = await Promise.all([1, 2, 3, 4, 5].map(() => newUser(ctx)));
    const results = await Promise.all(users.map((u) => u.c.post('/api/join', { code: code.toLowerCase() })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const used = await ctx.db.query(`SELECT count(*)::int AS n FROM memberships WHERE congregation_id = $1 AND role = 'publisher'`, [A.cid]);
    expect(used.rows[0].n).toBe(2); // 1 do teste anterior + 1 aqui
  });

  it('libera somente o perfil Publicador', async () => {
    const { code } = (await A.admin.c.post(`/api/congregations/${A.cid}/codes`, {})).body;
    const p = await newUser(ctx, 'admin'); // mesmo quem se cadastrou como "Administrador"
    await p.c.post('/api/join', { code });
    expect((await p.c.get('/api/me')).body.membership.role).toBe('publisher');
  });

  it('expirado e cancelado não funcionam', async () => {
    const exp = (await A.admin.c.post(`/api/congregations/${A.cid}/codes`, {})).body;
    await ctx.db.query(`UPDATE access_codes SET expires_at = now() - interval '1 minute' WHERE id = $1`, [exp.id]);
    const can = (await A.admin.c.post(`/api/congregations/${A.cid}/codes`, {})).body;
    expect((await A.admin.c.post(`/api/congregations/${A.cid}/codes/${can.id}/cancel`)).status).toBe(200);
    const p = await newUser(ctx);
    expect((await p.c.post('/api/join', { code: exp.code })).status).toBe(400);
    expect((await p.c.post('/api/join', { code: can.code })).status).toBe(400);
  });

  it('bloqueia tentativas repetidas de adivinhação', async () => {
    const p = await newUser(ctx);
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await p.c.post('/api/join', { code: 'AAAA-BBBB-CCCC' })).status);
    expect(statuses.slice(0, 5).every((s) => s === 400)).toBe(true);
    expect(statuses[5]).toBe(429);
    // Mesmo um código válido é recusado enquanto o limite estiver ativo.
    const { code } = (await A.admin.c.post(`/api/congregations/${A.cid}/codes`, {})).body;
    expect((await p.c.post('/api/join', { code })).status).toBe(429);
  });
});

describe('9. revogação bloqueia sessões existentes', () => {
  it('sessões abertas (inclusive em outro aparelho) perdem acesso', async () => {
    const { code } = (await A.admin.c.post(`/api/congregations/${A.cid}/codes`, {})).body;
    const p = await newUser(ctx);
    await p.c.post('/api/join', { code });
    // Segunda sessão do mesmo usuário ("celular")
    const phone = client(ctx.app);
    expect((await phone.post('/api/auth/login', { email: p.email, password: 'senha-forte-123' })).status).toBe(200);
    expect((await phone.get(`/api/congregations/${A.cid}/territories`)).status).toBe(200);
    const snapshot = phone.cookie;

    const me = await p.c.get('/api/me');
    const rv = await A.admin.c.post(`/api/congregations/${A.cid}/members/${me.body.membership.id}/revoke`);
    expect(rv.status).toBe(200);

    for (const c of [p.c, phone]) {
      c.cookie = c === phone ? snapshot : c.cookie;
      expect((await c.get(`/api/congregations/${A.cid}/territories`)).status).toBe(401);
    }
    // Mesmo que faça login de novo, não acessa a congregação.
    const again = client(ctx.app);
    await again.post('/api/auth/login', { email: p.email, password: 'senha-forte-123' });
    expect((await again.get(`/api/congregations/${A.cid}/territories`)).status).toBe(404);
    expect((await again.post(`/api/congregations/${A.cid}/blocks/${A.bid}/addresses`, { number: '1' })).status).toBe(404);
    const meAfter = await again.get('/api/me');
    expect(meAfter.body.membership).toBeNull();
    expect(meAfter.body.wasRevoked).toBe(true);
  });

  it('o histórico criado pelo publicador revogado é preservado', async () => {
    const { code } = (await A.admin.c.post(`/api/congregations/${A.cid}/codes`, {})).body;
    const p = await newUser(ctx, 'publisher', 'Carlos Revogado');
    await p.c.post('/api/join', { code });
    const h = await p.c.post(`/api/congregations/${A.cid}/blocks/${A.bid}/addresses`, { number: '909' });
    await p.c.post(`/api/congregations/${A.cid}/addresses/${h.body.id}/records`, { action: 'contact', occurredOn: daysAgo(1) });
    const mid = (await p.c.get('/api/me')).body.membership.id;
    await A.admin.c.post(`/api/congregations/${A.cid}/members/${mid}/revoke`);
    const hist = await A.admin.c.get(`/api/congregations/${A.cid}/addresses/${h.body.id}/records`);
    expect(hist.body.records[0]).toMatchObject({ action: 'contact', author_name: 'Carlos Revogado' });
  });

  it('não permite remover o último administrador', async () => {
    const me = await A.admin.c.get('/api/me');
    const r = await A.admin.c.post(`/api/congregations/${A.cid}/members/${me.body.membership.id}/role`, { role: 'publisher' });
    expect(r.status).toBe(409);
  });
});
