// O mapa não "sequestra" a rolagem da página: a rodinha só dá zoom depois de clicar nele.
import { expect, test } from '@playwright/test';

const zoom = (page: import('@playwright/test').Page) =>
  page.evaluate(() => Math.max(0, ...[...document.querySelectorAll<HTMLImageElement>('.leaflet-tile')].map((i) => Number(new URL(i.src).pathname.split('/')[1]) || 0)));

test('rodinha rola a página até o usuário clicar no mapa', async ({ page }, info) => {
  test.skip(info.project.name !== 'computador', 'rodinha do mouse só se aplica ao computador');
  test.skip(!process.env.DEMO_PASSWORD, 'requer dados de demonstração (seed:demo)');
  await page.route(/tile\.openstreetmap/, (r) => r.fulfill({ status: 204, body: '' }));
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill('publicador@exemplo.test');
  await page.getByLabel('Senha').fill(process.env.DEMO_PASSWORD!);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('link', { name: /Território 1/ }).click();
  const map = page.locator('.map').first();
  await map.waitFor();
  await page.waitForTimeout(500);
  const z0 = await zoom(page);
  const box = (await map.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(600);
  expect(await zoom(page)).toBe(z0); // sem clique: não aplica zoom
  await page.mouse.click(box.x + 20, box.y + box.height - 20); // clique numa área sem marcador
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(800);
  expect(await zoom(page)).toBeGreaterThan(z0);
});
