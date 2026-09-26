// Gera capturas de tela com os dados FICTÍCIOS do seed-demo (npm run seed:demo no servidor).
// Uso: SHOT_DIR=../docs/screenshots DEMO_PASSWORD=... node e2e/screenshots.mjs
import { chromium, devices } from '@playwright/test';
const base = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const dir = process.env.SHOT_DIR ?? '../docs/screenshots';
const b = await chromium.launch();

async function session(theme) {
  const ctx = await b.newContext({ ...devices['Pixel 7'], locale: 'pt-BR', colorScheme: theme });
  await ctx.route(/tile\.openstreetmap/, (r) => r.fulfill({ status: 204, body: '' }));
  const p = await ctx.newPage();
  return { ctx, p };
}
async function login(p, email) {
  await p.goto(`${base}/entrar`);
  await p.getByLabel('E-mail').fill(email);
  await p.getByLabel('Senha').fill(process.env.DEMO_PASSWORD);
  await p.getByRole('button', { name: 'Entrar' }).click();
  await p.getByRole('heading', { name: 'Territórios' }).waitFor();
}
const shot = (p, name) => p.screenshot({ path: `${dir}/${name}.png` });

{
  const { ctx, p } = await session('light');
  await p.goto(`${base}/entrar`);
  await shot(p, '01-entrar');
  await login(p, 'publicador@exemplo.test');
  await shot(p, '02-inicio');
  await p.getByRole('link', { name: /Território 1/ }).click();
  await p.locator('.block-marker').first().waitFor();
  await shot(p, '03-territorio-mapa');
  await p.getByRole('link', { name: /Quadra 2/ }).click();
  await p.getByRole('heading', { name: 'Endereços' }).waitFor();
  await shot(p, '04-quadra');
  await p.locator('.list-item', { hasText: 'Rua das Flores, 112' }).click();
  await p.getByRole('button', { name: /Deixei uma carta/ }).click();
  await shot(p, '05-registro-rapido');
  await p.getByRole('button', { name: 'Fechar' }).click();
  await p.getByRole('link', { name: /Edifício Horizonte/ }).click();
  await p.locator('.unit-btn').first().waitFor();
  await shot(p, '06-predio-apartamentos');
  await ctx.close();
}
{
  const { ctx, p } = await session('dark');
  await login(p, 'admin@exemplo.test');
  await shot(p, '07-inicio-escuro');
  await p.getByRole('link', { name: 'Gerenciar' }).click();
  await p.getByRole('button', { name: 'Gerar código' }).click();
  await p.getByRole('button', { name: 'Gerar', exact: true }).click();
  await p.locator('.code-box').waitFor();
  await p.locator('.code-box').evaluate((el) => (el.textContent = 'ABCD-EFGH-JKLM')); // não expor código real
  await shot(p, '08-codigo-escuro');
  await ctx.close();
}
await b.close();
console.log('capturas geradas em', dir);
