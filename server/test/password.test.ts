// Regra de senha: mínimo 6 caracteres, com letras e números; bloqueia senhas muito comuns.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, startApp, type Ctx } from './helpers.js';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await startApp();
});
afterAll(() => ctx.close());

const signup = (password: string, n: number) =>
  client(ctx.app).post('/api/auth/signup', {
    name: 'Regra Senha', email: `senha${n}@exemplo.test`, password, acceptTerms: true,
    termsVersion: ctx.cfg.TERMS_VERSION, privacyVersion: ctx.cfg.PRIVACY_VERSION,
  });

describe('regra de senha', () => {
  it.each([
    ['casa12', 202],
    ['Ab3def', 202],
    ['joão99', 202],
    ['abc 1-2!x', 202],
    ['ab12c', 400], // 5 caracteres
    ['abcdef', 400], // sem número
    ['123456', 400], // sem letra
    ['abc123', 400], // comum
    ['Senha123', 400], // comum (sem diferenciar maiúsculas)
  ])('%s → %i', async (pw, status) => {
    const r = await signup(pw, Math.floor(Math.random() * 1e9));
    expect(r.status).toBe(status);
  });

  it('mensagens claras', async () => {
    expect((await signup('abcdef', 1)).body.message).toBe('A senha precisa ter letras e números.');
    expect((await signup('a1', 2)).body.message).toBe('A senha precisa ter pelo menos 6 caracteres.');
    expect((await signup('abc123', 3)).body.message).toBe('Essa senha é muito comum. Escolha outra.');
  });
});
