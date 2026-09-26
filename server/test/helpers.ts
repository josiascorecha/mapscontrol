import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { buildApp } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';
import { createPool } from '../src/lib/db.js';
import { createMailer, type Mailer } from '../src/lib/mail.js';
import type { Fetcher } from '../src/lib/maps.js';
import { migrate } from '../src/lib/migrate.js';

export const ORIGIN = 'http://localhost:3000';
export const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://mapscontrol:devpass@localhost:5432/mapscontrol_test';

export function testConfig(): Config {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DB,
    APP_ORIGIN: ORIGIN,
    CODE_PEPPER: 'pepper-de-teste-com-mais-de-32-caracteres!!',
    MAIL_TRANSPORT: 'memory',
    LOG_LEVEL: 'silent',
  });
}

export async function resetDb(): Promise<void> {
  const c = new pg.Client({ connectionString: TEST_DB });
  await c.connect();
  await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await c.end();
}

export interface Ctx {
  app: FastifyInstance;
  db: pg.Pool;
  cfg: Config;
  mailer: Mailer;
  close(): Promise<void>;
}

export async function startApp(opts: { reset?: boolean; fetcher?: Fetcher } = {}): Promise<Ctx> {
  if (opts.reset !== false) await resetDb();
  const cfg = testConfig();
  const db = createPool(TEST_DB);
  await migrate(db);
  const mailer = createMailer(cfg);
  const app = await buildApp(cfg, db, { mailer, logger: false, fetcher: opts.fetcher });
  await app.ready();
  return {
    app,
    db,
    cfg,
    mailer,
    async close() {
      await app.close();
      await db.end();
    },
  };
}

export interface Client {
  cookie: string | null;
  get(url: string): Promise<Res>;
  post(url: string, body?: unknown): Promise<Res>;
  patch(url: string, body?: unknown): Promise<Res>;
  del(url: string): Promise<Res>;
}
export interface Res {
  status: number;
  body: any;
}

let ipSeq = 1;
/** Cada cliente simula um aparelho com IP próprio (evita esbarrar nos limites por IP entre testes). */
export function client(app: FastifyInstance, cookie: string | null = null, ip = `203.0.113.${(ipSeq++ % 250) + 1}`): Client {
  const c: Client = {
    cookie,
    async get(url) {
      return send('GET', url);
    },
    async post(url, body = {}) {
      return send('POST', url, body);
    },
    async patch(url, body = {}) {
      return send('PATCH', url, body);
    },
    async del(url) {
      return send('DELETE', url);
    },
  };
  async function send(method: any, url: string, body?: unknown): Promise<Res> {
    const res = await app.inject({
      method,
      url,
      payload: body === undefined ? undefined : (body as any),
      remoteAddress: ip,
      headers: { origin: ORIGIN, ...(c.cookie ? { cookie: c.cookie } : {}) },
    });
    const set = res.cookies.find((k) => k.name === 'mcs');
    if (set) c.cookie = set.value ? `mcs=${set.value}` : null;
    let parsed: any = null;
    try {
      parsed = res.json();
    } catch {
      parsed = res.body;
    }
    return { status: res.statusCode, body: parsed };
  }
  return c;
}

export function lastTokenFor(mailer: Mailer, email: string): string {
  const mail = [...(mailer.outbox ?? [])].reverse().find((m) => m.to === email);
  if (!mail) throw new Error(`nenhum e-mail para ${email}`);
  const m = mail.text.match(/#t=([A-Za-z0-9_-]+)/);
  if (!m) throw new Error('token não encontrado no e-mail');
  return m[1];
}

let seq = 0;
export async function newUser(ctx: Ctx, intent: 'publisher' | 'admin' = 'publisher', name = 'Pessoa Teste') {
  const email = `u${Date.now()}_${seq++}@exemplo.test`;
  const c = client(ctx.app);
  const r = await c.post('/api/auth/signup', {
    name,
    email,
    password: 'senha-forte-123',
    intent,
    acceptTerms: true,
    termsVersion: ctx.cfg.TERMS_VERSION,
    privacyVersion: ctx.cfg.PRIVACY_VERSION,
  });
  if (r.status !== 202) throw new Error(`signup falhou: ${JSON.stringify(r.body)}`);
  const v = await c.post('/api/auth/verify-email', { token: lastTokenFor(ctx.mailer, email) });
  if (v.status !== 200) throw new Error('verify falhou');
  const me = await c.get('/api/me');
  return { c, email, id: me.body.user.id as string };
}

/** Administrador com congregação, território e quadra prontos. */
export async function newCongregation(ctx: Ctx, name = 'Congregação Teste') {
  const admin = await newUser(ctx, 'admin', 'Admin Teste');
  const cr = await admin.c.post('/api/congregations', { name, city: 'Cidade', state: 'SC' });
  if (cr.status !== 201) throw new Error(`criar congregação falhou: ${JSON.stringify(cr.body)}`);
  const cid = cr.body.id as string;
  const t = await admin.c.post(`/api/congregations/${cid}/territories`, { number: 1, name: 'Centro' });
  const b = await admin.c.post(`/api/congregations/${cid}/territories/${t.body.id}/blocks`, { number: 1 });
  return { admin, cid, tid: t.body.id as string, bid: b.body.id as string };
}

export async function addPublisher(ctx: Ctx, admin: Client, cid: string) {
  const pub = await newUser(ctx, 'publisher', 'Publicador Teste');
  const code = await admin.post(`/api/congregations/${cid}/codes`, { validDays: 7 });
  const j = await pub.c.post('/api/join', { code: code.body.code });
  if (j.status !== 200) throw new Error(`join falhou: ${JSON.stringify(j.body)}`);
  const me = await pub.c.get('/api/me');
  return { ...pub, membershipId: me.body.membership.id as string };
}

export const today = () => new Date().toISOString().slice(0, 10);
export const daysAgo = (n: number) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
