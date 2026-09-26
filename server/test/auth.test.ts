// Autenticação, recuperação de senha, termos e exclusão de conta.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, lastTokenFor, newCongregation, newUser, startApp, type Ctx } from './helpers.js';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await startApp();
});
afterAll(() => ctx.close());

const signup = (c: ReturnType<typeof client>, email: string, extra: object = {}) =>
  c.post('/api/auth/signup', {
    name: 'Maria Teste', email, password: 'senha-forte-123', acceptTerms: true,
    termsVersion: ctx.cfg.TERMS_VERSION, privacyVersion: ctx.cfg.PRIVACY_VERSION, ...extra,
  });

describe('cadastro e confirmação de e-mail', () => {
  it('publicador é o padrão; exige aceite dos termos; registra versões aceitas', async () => {
    const c = client(ctx.app);
    const semAceite = await signup(c, 'semaceite@exemplo.test', { acceptTerms: false });
    expect(semAceite.status).toBe(400);
    const r = await signup(c, 'maria@exemplo.test');
    expect(r.status).toBe(202);
    const u = await ctx.db.query(`SELECT id, signup_intent FROM users WHERE email = 'maria@exemplo.test'`);
    expect(u.rows[0].signup_intent).toBe('publisher');
    const cons = await ctx.db.query('SELECT document, version FROM consents WHERE user_id = $1 ORDER BY document', [u.rows[0].id]);
    expect(cons.rows).toEqual([
      { document: 'privacy', version: ctx.cfg.PRIVACY_VERSION },
      { document: 'terms', version: ctx.cfg.TERMS_VERSION },
    ]);
  });

  it('não entra antes de confirmar e-mail; token é de uso único', async () => {
    const c = client(ctx.app);
    await signup(c, 'joao@exemplo.test');
    const early = await c.post('/api/auth/login', { email: 'joao@exemplo.test', password: 'senha-forte-123' });
    expect(early.status).toBe(403);
    expect(early.body.error).toBe('EMAIL_NOT_VERIFIED');
    const token = lastTokenFor(ctx.mailer, 'joao@exemplo.test');
    expect((await c.post('/api/auth/verify-email', { token })).status).toBe(200);
    expect((await c.get('/api/me')).status).toBe(200);
    expect((await client(ctx.app).post('/api/auth/verify-email', { token })).status).toBe(400);
  });

  it('não revela se o e-mail já está cadastrado', async () => {
    const c = client(ctx.app);
    const again = await signup(c, 'joao@exemplo.test');
    expect(again.status).toBe(202);
    const fresh = await signup(c, 'novo@exemplo.test');
    expect(again.body).toEqual(fresh.body);
  });

  it('senha errada e e-mail inexistente dão a mesma resposta', async () => {
    const c = client(ctx.app);
    const a = await c.post('/api/auth/login', { email: 'joao@exemplo.test', password: 'errada-errada' });
    const b = await c.post('/api/auth/login', { email: 'ninguem@exemplo.test', password: 'errada-errada' });
    expect(a.status).toBe(401);
    expect(a.body).toEqual(b.body);
  });

  it('senha é armazenada com Argon2id', async () => {
    const r = await ctx.db.query(`SELECT password_hash FROM users WHERE email = 'joao@exemplo.test'`);
    expect(r.rows[0].password_hash).toMatch(/^\$argon2id\$/);
  });
});

describe('recuperação de senha', () => {
  it('link seguro redefine a senha e encerra sessões antigas', async () => {
    const u = await newUser(ctx);
    const other = client(ctx.app);
    await other.post('/api/auth/login', { email: u.email, password: 'senha-forte-123' });
    const f = await client(ctx.app).post('/api/auth/forgot-password', { email: u.email });
    expect(f.status).toBe(200);
    const token = lastTokenFor(ctx.mailer, u.email);
    const c = client(ctx.app);
    expect((await c.post('/api/auth/set-password', { token, password: 'nova-senha-456' })).status).toBe(200);
    expect((await other.get('/api/me')).status).toBe(401);
    expect((await u.c.get('/api/me')).status).toBe(401);
    expect((await c.get('/api/me')).status).toBe(200);
    expect((await client(ctx.app).post('/api/auth/login', { email: u.email, password: 'senha-forte-123' })).status).toBe(401);
    expect((await client(ctx.app).post('/api/auth/login', { email: u.email, password: 'nova-senha-456' })).status).toBe(200);
    expect((await client(ctx.app).post('/api/auth/set-password', { token, password: 'outra-senha-789' })).status).toBe(400);
  });

  it('e-mail inexistente recebe a mesma resposta e nenhum e-mail é enviado', async () => {
    const before = ctx.mailer.outbox!.length;
    const r = await client(ctx.app).post('/api/auth/forgot-password', { email: 'naoexiste@exemplo.test' });
    expect(r.status).toBe(200);
    expect(ctx.mailer.outbox!.length).toBe(before);
  });
});

describe('logout e sessão', () => {
  it('logout invalida o cookie no servidor', async () => {
    const u = await newUser(ctx);
    const saved = u.c.cookie;
    await u.c.post('/api/auth/logout');
    u.c.cookie = saved;
    expect((await u.c.get('/api/me')).status).toBe(401);
  });
  it('cookie de sessão é HttpOnly e SameSite', async () => {
    await newUser(ctx);
    const r = await ctx.app.inject({
      method: 'POST', url: '/api/auth/login', headers: { origin: ctx.cfg.APP_ORIGIN },
      payload: { email: 'joao@exemplo.test', password: 'senha-forte-123' },
    });
    const sc = String(r.headers['set-cookie']);
    expect(sc).toMatch(/HttpOnly/);
    expect(sc).toMatch(/SameSite=Lax/);
    const db = await ctx.db.query('SELECT token_hash FROM sessions LIMIT 1');
    expect(db.rows[0].token_hash).toBeInstanceOf(Buffer); // só o hash fica no banco
  });
});

describe('exclusão de conta', () => {
  it('anonimiza dados pessoais, encerra sessões e mantém histórico sem identificação', async () => {
    const cong = await newCongregation(ctx);
    const u = await newUser(ctx, 'publisher', 'Pedro Excluir');
    const { code } = (await cong.admin.c.post(`/api/congregations/${cong.cid}/codes`, {})).body;
    await u.c.post('/api/join', { code });
    const h = await u.c.post(`/api/congregations/${cong.cid}/blocks/${cong.bid}/addresses`, { number: '5' });
    await u.c.post(`/api/congregations/${cong.cid}/addresses/${h.body.id}/records`, { action: 'contact', occurredOn: new Date().toISOString().slice(0, 10) });
    expect((await u.c.post('/api/me/delete', { password: 'errada', confirm: 'EXCLUIR' })).status).toBe(401);
    expect((await u.c.post('/api/me/delete', { password: 'senha-forte-123', confirm: 'EXCLUIR' })).status).toBe(200);
    const row = await ctx.db.query('SELECT name, email, password_hash, deleted_at FROM users WHERE id = $1', [u.id]);
    expect(row.rows[0]).toMatchObject({ name: 'Usuário removido', email: null, password_hash: null });
    expect(row.rows[0].deleted_at).not.toBeNull();
    expect((await client(ctx.app).post('/api/auth/login', { email: u.email, password: 'senha-forte-123' })).status).toBe(401);
    const hist = await cong.admin.c.get(`/api/congregations/${cong.cid}/addresses/${h.body.id}/records`);
    expect(hist.body.records[0].author_name).toBe('Usuário removido');
    // O e-mail volta a ficar disponível para novo cadastro
    expect((await signup(client(ctx.app), u.email)).status).toBe(202);
  });

  it('único administrador com membros precisa transferir antes', async () => {
    const cong = await newCongregation(ctx);
    const p = await newUser(ctx);
    const { code } = (await cong.admin.c.post(`/api/congregations/${cong.cid}/codes`, {})).body;
    await p.c.post('/api/join', { code });
    const r = await cong.admin.c.post('/api/me/delete', { password: 'senha-forte-123', confirm: 'EXCLUIR' });
    expect(r.status).toBe(409);
  });
});
