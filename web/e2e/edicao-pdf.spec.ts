// Correção de número e PDF da quadra (usa os dados fictícios do seed:demo).
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('corrige o número de uma casa e gera o PDF da quadra', async ({ page }) => {
  test.skip(!process.env.DEMO_PASSWORD, 'requer dados de demonstração (seed:demo)');
  await page.route(/tile\.openstreetmap/, (r) => r.fulfill({ status: 204, body: '' }));
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill('publicador@exemplo.test');
  await page.getByLabel('Senha').fill(process.env.DEMO_PASSWORD!);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('link', { name: /Território 2/ }).click();
  await page.getByRole('link', { name: /Quadra 1/ }).click();
  await expect(page.getByRole('heading', { name: 'Endereços' })).toBeVisible();

  const items = page.locator('.list .list-item');
  const before = (await items.allInnerTexts()).map((t) => t.split('\n')[0]);
  const second = before[1];

  // Abre o registro rápido da segunda casa e usa "Corrigir número"
  await items.nth(1).click();
  await page.getByRole('button', { name: 'Corrigir número' }).click();
  const novo = `${Date.now() % 100000}A`;
  const numero = page.getByLabel('Número');
  await numero.fill(novo);
  await page.getByRole('button', { name: 'Salvar correção' }).click();
  await expect(page.getByText('Endereço corrigido')).toBeVisible();
  await page.getByRole('button', { name: 'Voltar' }).click();

  // Mesma posição na lista, número novo
  await expect(items.nth(1)).toContainText(novo);
  const after = (await items.allInnerTexts()).map((t) => t.split('\n')[0]);
  expect(after.length).toBe(before.length);
  expect(after[0]).toBe(before[0]);
  expect(after[1]).not.toBe(second);

  // PDF
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Gerar PDF da quadra' }).click()]);
  expect(download.suggestedFilename()).toBe('territorio-2-quadra-1.pdf');
  const file = await download.path();
  expect(readFileSync(file!).subarray(0, 5).toString()).toBe('%PDF-');
});
