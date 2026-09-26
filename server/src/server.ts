import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './lib/db.js';
import { runMaintenance } from './lib/maintenance.js';
import { migrate } from './lib/migrate.js';

const cfg = loadConfig();
const db = createPool(cfg.DATABASE_URL);

await migrate(db, (m) => console.log(m));
const app = await buildApp(cfg, db);

const maintenance = async () => {
  try {
    await runMaintenance(db, cfg.AUDIT_RETENTION_DAYS);
  } catch (err) {
    app.log.error({ err: (err as Error).message }, 'falha na manutenção');
  }
};
await maintenance();
const timer = setInterval(maintenance, 3600_000);

const shutdown = async (signal: string) => {
  app.log.info(`recebido ${signal}, encerrando`);
  clearInterval(timer);
  await app.close();
  await db.end();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: cfg.HOST, port: cfg.PORT });
