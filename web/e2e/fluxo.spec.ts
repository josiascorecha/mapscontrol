// Critério 12: a interface funciona em celular e computador (fluxo completo real, sem simulação da API).
import { expect, test, type Page } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const MAIL_DIR = process.env.E2E_MAIL_DIR ?? '.dev-mail';
const PASSWORD = 'senha-e2e-12345';

async function linkFor(email: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const files = readdirSync(MAIL_DIR).sort().reverse();
    for (const f of files) {
      const body = readFileSync(path.join(MAIL_DIR, f), 'utf8');
      if (body.startsWith(`Para: ${email}`)) {
        const m = body.match(/(https?:\/\/\S+#t=[A-Za-z0-9_-]+)/);
        if (m) return m[1];
      }
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`e-mail para ${email} não encontrado`);
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function signup(page: Page, name: string, email: string, admin: boolean) {
  await page.goto('/cadastro');
  await expect(page.getByRole('button', { name: 'Publicador' })).toHaveAttribute('aria-pressed', 'true'); // pré-selecionado
  if (admin) await page.getByRole('button', { name: 'Administrador' }).click();
  await page.getByLabel('Nome').fill(name);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Repita a senha').fill(PASSWORD);
  await page.getByRole('checkbox').check();
  await noHorizontalScroll(page);
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await expect(page.getByRole('heading', { name: 'Confira seu e-mail' })).toBeVisible();
  const link = new URL(await linkFor(email));
  await page.goto(link.pathname + link.hash);
}

test('administrador e publicador: do cadastro ao registro de visita', async ({ browser }, info) => {
  const tag = `${info.project.name}-${Date.now()}`;
  const adminEmail = `adm-${tag}@exemplo.test`;
  const pubEmail = `pub-${tag}@exemplo.test`;

  // ---------- Administrador ----------
  const adminCtx = await browser.newContext(info.project.use);
  const a = await adminCtx.newPage();
  await signup(a, 'Ana Administradora', adminEmail, true);
  await expect(a.getByRole('heading', { name: /Olá, Ana/ })).toBeVisible();
  await a.getByLabel('Nome da congregação').fill(`Congregação E2E ${tag}`);
  await a.getByLabel('Cidade').fill('Cidade Teste');
  await a.getByRole('button', { name: 'Criar congregação' }).click();
  await expect(a.getByRole('heading', { name: 'Territórios' })).toBeVisible();

  await a.getByRole('button', { name: 'Novo' }).click();
  await a.getByLabel('Número').fill('1');
  await a.getByLabel('Nome ou localização (opcional)').fill('Centro');
  await a.getByRole('button', { name: 'Salvar' }).click();
  await expect(a.getByText('Território 1', { exact: false }).first()).toBeVisible();

  await a.getByRole('button', { name: 'Nova quadra' }).click();
  await a.getByLabel('Latitude').fill('-25.43');
  await a.getByLabel('Longitude').fill('-49.27');
  await a.getByRole('button', { name: 'Salvar quadra' }).click();
  await expect(a.locator('.block-marker')).toHaveCount(1);
  await noHorizontalScroll(a);

  await a.getByRole('link', { name: 'Gerenciar' }).click();
  await a.getByRole('button', { name: 'Gerar código' }).first().click();
  await a.getByRole('button', { name: 'Gerar', exact: true }).click();
  const code = (await a.locator('.code-box').textContent())!.trim();
  expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  await a.getByRole('button', { name: 'Fechar' }).click();
  await expect(a.getByText(/Usado|Disponível/).first()).toBeVisible();

  // ---------- Publicador ----------
  const pubCtx = await browser.newContext(info.project.use);
  const p = await pubCtx.newPage();
  await signup(p, 'Paulo Publicador', pubEmail, false);
  await p.getByLabel('Código de acesso').fill(code.toLowerCase());
  await p.getByRole('button', { name: 'Entrar na congregação' }).click();
  await expect(p.getByRole('heading', { name: 'Territórios' })).toBeVisible();
  await expect(p.getByRole('button', { name: 'Novo' })).toHaveCount(0); // sem funções administrativas
  await expect(p.getByRole('link', { name: 'Gerenciar' })).toHaveCount(0);

  await p.getByRole('link', { name: /Território 1/ }).click();
  await p.getByRole('link', { name: /Quadra 1/ }).click();

  // Casa (padrão) + carta
  await p.getByRole('button', { name: 'Cadastrar casa ou prédio' }).click();
  await expect(p.getByRole('button', { name: 'Casa', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await p.getByLabel('Número').fill('120');
  await p.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(p.getByText('Casa 120 cadastrada')).toBeVisible();
  await p.getByRole('button', { name: /Casa 120/ }).click();
  await p.getByRole('button', { name: /Deixei uma carta/ }).click();
  await p.getByRole('button', { name: 'Salvar registro' }).click();
  await expect(p.getByText('Carta registrada')).toBeVisible();
  const row = p.getByRole('button', { name: /Casa 120/ });
  await expect(row).toContainText('Com carta');
  await expect(row).toContainText('Carta em');

  // Contato na mesma casa
  await row.click();
  await p.getByRole('button', { name: /Conversei com alguém/ }).click();
  await p.getByRole('button', { name: 'Salvar registro' }).click();
  await expect(p.getByRole('button', { name: /Casa 120/ })).toContainText('Contato realizado');

  // Prédio com apartamentos
  await p.getByRole('button', { name: 'Cadastrar casa ou prédio' }).click();
  await p.getByRole('button', { name: 'Prédio', exact: true }).click();
  await p.getByLabel('Número').fill('500');
  await p.getByLabel('Nome do prédio (opcional)').fill('Edifício Teste');
  await p.getByLabel('Até o andar').fill('2');
  await p.getByLabel('Aptos por andar').fill('2');
  await p.getByRole('button', { name: /Adicionar 4 à revisão/ }).click();
  await p.getByRole('button', { name: /Remover\s+202/ }).click(); // revisão antes de salvar
  await p.getByRole('button', { name: /Salvar prédio e 3 apto/ }).click();
  await expect(p.locator('.unit-btn')).toHaveCount(3);
  await p.locator('.unit-btn', { hasText: '101' }).click();
  await p.getByRole('button', { name: /Deixei uma carta/ }).click();
  await p.getByRole('button', { name: 'Salvar registro' }).click();
  await expect(p.locator('.unit-btn', { hasText: '101' })).toContainText('Carta');
  await expect(p.locator('.unit-btn', { hasText: '102' })).toContainText('Pendente');
  await noHorizontalScroll(p);

  // Visão de prédios e cartas
  await p.getByRole('link', { name: 'Prédios', exact: true }).click();
  await p.getByRole('button', { name: 'Só com carta pendente' }).click();
  await expect(p.getByText(/Carta: 101/)).toBeVisible();

  // Erro de rede preserva o que foi digitado e não mostra sucesso
  await p.goBack();
  await p.locator('.unit-btn', { hasText: '102' }).click();
  await p.getByRole('button', { name: /Conversei com alguém/ }).click();
  await p.getByLabel('Observação (opcional)').fill('portão lateral');
  await pubCtx.setOffline(true);
  await p.getByRole('button', { name: 'Salvar registro' }).click();
  await expect(p.getByText(/Sem conexão com o servidor/)).toBeVisible();
  await expect(p.getByLabel('Observação (opcional)')).toHaveValue('portão lateral');
  await expect(p.getByText('Contato registrado')).toHaveCount(0);
  await pubCtx.setOffline(false);
  await p.getByRole('button', { name: 'Salvar registro' }).click();
  await expect(p.getByText('Contato registrado')).toBeVisible();

  // ---------- Revogação reflete no aparelho do publicador ----------
  await a.getByRole('button', { name: 'Membros' }).click();
  a.once('dialog', (d) => d.accept());
  await a.getByRole('button', { name: 'Revogar acesso' }).click();
  await expect(a.getByText('Acesso revogado')).toBeVisible();
  await p.reload();
  await expect(p.getByRole('heading', { name: 'Entrar' })).toBeVisible();

  await adminCtx.close();
  await pubCtx.close();
});

test('tema claro e escuro', async ({ page }) => {
  await page.goto('/entrar');
  await page.emulateMedia({ colorScheme: 'dark' });
  const bgDark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.emulateMedia({ colorScheme: 'light' });
  const bgLight = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bgDark).not.toBe(bgLight);
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(bgDark);
});
