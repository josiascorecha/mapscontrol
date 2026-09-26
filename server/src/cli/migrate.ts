import { loadConfig } from '../config.js';
import { createPool } from '../lib/db.js';
import { migrate } from '../lib/migrate.js';

const cfg = loadConfig();
const db = createPool(cfg.DATABASE_URL);
const applied = await migrate(db, (m) => console.log(m));
console.log(applied.length ? `${applied.length} migração(ões) aplicada(s).` : 'Banco já está atualizado.');
await db.end();
