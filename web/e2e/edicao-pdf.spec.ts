// Correção de número, nomes da ficha e PDF para recorte (usa os dados fictícios do seed:demo).
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('corrige o número de uma casa, edita os nomes da ficha e gera o PDF para recorte', async ({ page }) => {
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

  // O relatório antigo da quadra foi retirado
  await expect(page.getByRole('link', { name: 'Gerar PDF da quadra' })).toHaveCount(0);

  // Nomes do campo PUBLICADORES
  const nomes = `Ana e Bruno ${Date.now() % 1000}`;
  await page.getByRole('button', { name: 'Editar nomes' }).click();
  await page.getByLabel('Nomes que saem no PDF para recorte').fill(nomes);
  await page.getByRole('button', { name: 'Salvar nomes' }).click();
  await expect(page.getByText('Nomes salvos para a ficha')).toBeVisible();
  await expect(page.locator('.card-names strong')).toHaveText(nomes);

  // PDF para recorte
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Gerar PDF para Recorte' }).click()]);
  expect(download.suggestedFilename()).toBe('recorte-territorio-2-quadra-1.pdf');
  const file = await download.path();
  expect(readFileSync(file!).subarray(0, 5).toString()).toBe('%PDF-');

  // Apagando os nomes, o campo fica em branco (mantém os dados de demonstração como estavam)
  await page.getByRole('button', { name: 'Editar nomes' }).click();
  await page.getByLabel('Nomes que saem no PDF para recorte').fill('');
  await page.getByRole('button', { name: 'Salvar nomes' }).click();
  await expect(page.getByText('O campo PUBLICADORES vai sair em branco')).toBeVisible();
  await expect(page.locator('.card-names strong')).toHaveText('em branco');
});
