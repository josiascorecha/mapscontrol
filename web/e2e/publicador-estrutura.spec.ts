// Publicador cadastra território e quadra (aguardando confirmação), exclui o que cadastrou,
// exclui a própria casa; o administrador confirma e a exclusão some para o publicador.
import { expect, test, type Browser, type Page } from '@playwright/test';

async function login(browser: Browser, email: string): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  await page.route(/tile\.openstreetmap/, (r) => r.fulfill({ status: 204, body: '' }));
  await page.goto('/entrar');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(process.env.DEMO_PASSWORD!);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('heading', { name: 'Territórios' })).toBeVisible();
  return page;
}

test('publicador cadastra, exclui o que é seu e, depois da confirmação, só edita', async ({ browser }, info) => {
  test.skip(!process.env.DEMO_PASSWORD, 'requer dados de demonstração (seed:demo)');
  const number = String(800 + Math.floor(Math.random() * 99) + (info.project.name === 'celular' ? 0 : 100));

  // 1. Publicador cria território e quadras
  const pub = await login(browser, 'publicador@exemplo.test');
  await pub.getByRole('button', { name: 'Novo' }).click();
  await pub.getByLabel('Número').fill(number);
  await pub.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(pub.getByText('Aguardando confirmação de um administrador')).toBeVisible();
  for (const q of ['1', '2']) {
    await pub.getByRole('button', { name: 'Nova quadra' }).click();
    await pub.getByLabel('Número').fill(q);
    await pub.getByRole('button', { name: 'Salvar quadra' }).click();
    await expect(pub.getByRole('link', { name: new RegExp(`Quadra ${q}`) })).toBeVisible();
  }
  await expect(pub.getByText('aguardando confirmação').first()).toBeVisible();

  // Exclui a quadra 2 (é dele e ainda não foi confirmada)
  await pub.getByRole('button', { name: 'Editar quadra 2' }).click();
  await pub.getByRole('button', { name: 'Excluir quadra' }).click();
  await expect(pub.getByRole('link', { name: /Quadra 2/ })).toHaveCount(0);

  // 2. Cadastra e exclui a própria casa
  await pub.getByRole('link', { name: /Quadra 1/ }).click();
  await pub.getByRole('button', { name: 'Cadastrar casa ou prédio' }).click();
  await pub.getByLabel('Número').fill('31');
  await pub.getByRole('button', { name: 'Salvar', exact: true }).click();
  await pub.getByRole('button', { name: 'Casa 31: registrar visita' }).click();
  await pub.getByRole('button', { name: 'Excluir casa' }).click();
  await expect(pub.getByText('Casa excluída')).toBeVisible();
  await expect(pub.getByRole('button', { name: 'Casa 31: registrar visita' })).toHaveCount(0);
  await expect(pub.getByRole('link', { name: 'Gerar PDF para Recorte' })).toBeVisible();
  await pub.getByRole('button', { name: 'Voltar' }).click();
  const territoryUrl = pub.url();

  // 3. Administrador vê o aviso e confirma
  const adm = await login(browser, 'admin@exemplo.test');
  await expect(adm.getByText('Aguardando sua confirmação')).toBeVisible();
  await adm.getByText('Aguardando sua confirmação').click();
  await expect(adm.getByRole('heading', { name: 'Aguardando confirmação' })).toBeVisible();
  await expect(adm.getByText(`Território ${number}`).first()).toBeVisible();
  await adm.getByRole('button', { name: 'Confirmar todos' }).click();
  await expect(adm.getByText('Tudo confirmado')).toBeVisible();
  await expect(adm.getByRole('heading', { name: 'Aguardando confirmação' })).toHaveCount(0);

  // 4. Publicador: sem "Excluir", mas ainda pode editar
  await pub.goto(territoryUrl);
  await expect(pub.getByRole('button', { name: 'Editar dados' })).toBeVisible();
  await expect(pub.getByRole('button', { name: 'Excluir território' })).toHaveCount(0);
  await expect(pub.getByText('aguardando confirmação')).toHaveCount(0);
  await pub.getByRole('button', { name: 'Editar quadra 1' }).click();
  await expect(pub.getByRole('button', { name: 'Salvar quadra' })).toBeVisible();
  await expect(pub.getByRole('button', { name: 'Excluir quadra' })).toHaveCount(0);
  await pub.getByLabel('Nome ou referência').fill('Esquina da praça');
  await pub.getByRole('button', { name: 'Salvar quadra' }).click();
  await expect(pub.getByRole('link', { name: /Esquina da praça/ })).toBeVisible();

  // Limpeza: o administrador exclui o território de teste
  await adm.goto(territoryUrl);
  await adm.getByRole('button', { name: 'Excluir território' }).click();
  await expect(adm.getByRole('heading', { name: 'Territórios' })).toBeVisible();
  await pub.context().close();
  await adm.context().close();
});
