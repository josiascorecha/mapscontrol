// Mudança de domínio: o endereço antigo continua funcionando durante a transição,
// os e-mails passam a levar ao endereço novo e o app recebe o que precisa para o aviso.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { lastTokenFor, startApp, type Ctx } from './helpers.js';

const NOVO = 'http://localhost:3000';
const ANTIGO = 'http://antigo.localhost:3000';

const base = {
  DATABASE_URL: 'postgres://x@localhost/x',
  CODE_PEPPER: 'pepper-de-teste-com-mais-de-32-caracteres!!',
};

describe('configuração', () => {
  it('lê os endereços antigos e a data da mudança', () => {
    const c = loadConfig({ ...base, APP_ORIGIN: 'https://novo.exemplo/', EXTRA_ORIGINS: ' https://antigo.exemplo , https://outro.exemplo/ ', ADDRESS_CHANGE_DATE: '2026-10-23' });
    expect(c.APP_ORIGIN).toBe('https://novo.exemplo');
    expect(c.allowedOrigins).toEqual(['https://novo.exemplo', 'https://antigo.exemplo', 'https://outro.exemplo']);
    expect(c.ADDRESS_CHANGE_DATE).toBe('2026-10-23');
  });

  it('sem mudança configurada aceita só o endereço principal', () => {
    const c = loadConfig({ ...base, APP_ORIGIN: 'https://novo.exemplo', EXTRA_ORIGINS: '', ADDRESS_CHANGE_DATE: '' });
    expect(c.allowedOrigins).toEqual(['https://novo.exemplo']);
    expect(c.ADDRESS_CHANGE_DATE).toBeUndefined();
  });

  it('recusa endereço com caminho, data em outro formato e http em produção', () => {
    expect(() => loadConfig({ ...base, EXTRA_ORIGINS: 'https://antigo.exemplo/app' })).toThrow(/sem caminho/);
    expect(() => loadConfig({ ...base, EXTRA_ORIGINS: 'não é endereço' })).toThrow(/inválido/);
    expect(() => loadConfig({ ...base, ADDRESS_CHANGE_DATE: '23/10/2026' })).toThrow(/AAAA-MM-DD/);
    expect(() =>
      loadConfig({
        ...base,
        NODE_ENV: 'production',
        APP_ORIGIN: 'https://novo.exemplo',
        EXTRA_ORIGINS: 'http://antigo.exemplo',
        MAIL_TRANSPORT: 'smtp',
        SMTP_HOST: 'smtp.exemplo',
      }),
    ).toThrow(/EXTRA_ORIGINS deve usar https/);
  });
});

describe('servidor durante a mudança', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await startApp({ env: { APP_ORIGIN: NOVO, EXTRA_ORIGINS: ANTIGO, ADDRESS_CHANGE_DATE: '2026-10-23' } });
  });
  afterAll(() => ctx.close());

  const signup = (origin: string | undefined, email: string) =>
    ctx.app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      remoteAddress: '198.51.100.7',
      headers: origin ? { origin } : {},
      payload: {
        name: 'Pessoa', email, password: 'senha-forte-123', intent: 'publisher', acceptTerms: true,
        termsVersion: ctx.cfg.TERMS_VERSION, privacyVersion: ctx.cfg.PRIVACY_VERSION,
      },
    });

  it('informa o endereço principal e a data ao app', async () => {
    const r = await ctx.app.inject({ method: 'GET', url: '/api/config' });
    expect(r.json()).toMatchObject({ appOrigin: NOVO, addressChangeDate: '2026-10-23' });
  });

  it('aceita pedidos vindos do endereço antigo e do novo', async () => {
    expect((await signup(ANTIGO, 'antigo@exemplo.test')).statusCode).toBe(202);
    expect((await signup(NOVO, 'novo@exemplo.test')).statusCode).toBe(202);
  });

  it('continua recusando outras origens e pedidos sem origem', async () => {
    for (const o of ['https://site-malicioso.example', 'http://localhost:3001', 'null', undefined]) {
      const r = await signup(o, 'x@exemplo.test');
      expect(r.statusCode, String(o)).toBe(403);
      expect(r.json().error).toBe('BAD_ORIGIN');
    }
  });

  it('o link do e-mail leva sempre ao endereço novo, mesmo quando o cadastro veio do antigo', async () => {
    const mail = [...(ctx.mailer.outbox ?? [])].find((m) => m.to === 'antigo@exemplo.test');
    expect(mail?.text).toContain(`${NOVO}/`);
    expect(mail?.text).not.toContain(ANTIGO);
    expect(lastTokenFor(ctx.mailer, 'antigo@exemplo.test')).toBeTruthy();
  });
});
