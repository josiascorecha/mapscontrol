// Cabeçalhos de segurança e compatibilidade com o servidor de mapas.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startApp, type Ctx } from './helpers.js';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await startApp();
});
afterAll(() => ctx.close());

it('envia só a origem como Referer (OpenStreetMap bloqueia requisições sem Referer)', async () => {
  const r = await ctx.app.inject({ method: 'GET', url: '/api/config' });
  expect(r.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(String(r.headers['content-security-policy'])).toContain("img-src 'self' data: https://tile.openstreetmap.org");
  expect(r.headers['x-content-type-options']).toBe('nosniff');
});
