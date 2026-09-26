import { defineConfig, devices } from '@playwright/test';

// Pré-requisito: servidor rodando em E2E_BASE_URL (padrão http://localhost:3000)
// com MAIL_TRANSPORT=file e MAIL_FILE_DIR apontando para E2E_MAIL_DIR.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'celular', use: { ...devices['Pixel 7'] } },
    { name: 'computador', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
});
