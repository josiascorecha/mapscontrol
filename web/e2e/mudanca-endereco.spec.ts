// Aviso de mudança de endereço. O servidor de teste não tem mudança configurada,
// então a resposta de /api/config é ajustada aqui para simular as duas situações.
import { expect, test, type Page } from '@playwright/test';

async function withConfig(page: Page, patch: Record<string, unknown>) {
  await page.route('**/api/config', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), ...patch } });
  });
}

test('sem mudança configurada não mostra aviso', async ({ page }) => {
  await page.goto('/entrar');
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Mudança de endereço' })).toHaveCount(0);
});

test('no endereço antigo mostra o novo endereço, a data e o botão', async ({ page }) => {
  await withConfig(page, { appOrigin: 'https://mapscontrol.novo.example', addressChangeDate: '2026-10-23' });
  await page.goto('/entrar?x=1');
  const aviso = page.getByRole('region', { name: 'Mudança de endereço' });
  await expect(aviso).toContainText('mapscontrol.novo.example');
  await expect(aviso).toContainText('23/10/2026');
  await expect(aviso).toContainText('mesmo e-mail e senha');
  await expect(aviso.getByRole('link', { name: 'Abrir novo endereço' })).toHaveAttribute(
    'href',
    'https://mapscontrol.novo.example/entrar?x=1',
  );
  // Não empurra o formulário para fora da tela no celular
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
});

test('no endereço antigo não convida a instalar o app (ficaria preso ao endereço antigo)', async ({ page }) => {
  test.skip(!process.env.DEMO_PASSWORD, 'requer dados de demonstração (seed:demo)');
  await page.route(/tile\.openstreetmap/, (r) => r.fulfill({ status: 204, body: '' }));
  await withConfig(page, { appOrigin: 'https://mapscontrol.novo.example', addressChangeDate: '2026-10-23' });
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill('publicador@exemplo.test');
  await page.getByLabel('Senha').fill(process.env.DEMO_PASSWORD!);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Resumo' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Mudança de endereço' })).toBeVisible();
  await expect(page.getByText('Instale o MapsControl no celular')).toHaveCount(0);
});

test('no endereço novo não mostra o aviso e orienta a entrar com a mesma senha', async ({ page, baseURL }) => {
  await withConfig(page, { appOrigin: new URL(baseURL!).origin, addressChangeDate: '2026-10-23' });
  await page.goto('/entrar');
  await expect(page.getByText('Este é o novo endereço do MapsControl')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Mudança de endereço' })).toHaveCount(0);
});
