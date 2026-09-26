/**
 * Importa um território e suas quadras de um arquivo JSON PRIVADO (fora do repositório).
 *
 *   node dist/cli/import-territory.js --congregation <uuid> --file /caminho/privado/territorio.json
 *
 * Formato: ver deploy/territorio.exemplo.json. Quadras sem lat/lng ficam sem marcador
 * até o administrador posicionar manualmente ou resolver o link pela interface.
 */
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { loadConfig } from '../config.js';
import { audit } from '../lib/audit.js';
import { createPool, withTx } from '../lib/db.js';

const { values } = parseArgs({ options: { congregation: { type: 'string' }, file: { type: 'string' } } });
if (!values.congregation || !values.file) {
  console.error('Uso: import-territory --congregation <uuid> --file <arquivo.json>');
  process.exit(1);
}
const schema = z.object({
  territorio: z.object({ numero: z.number().int().positive(), nome: z.string().optional() }),
  quadras: z.array(
    z.object({
      numero: z.number().int().positive(),
      nome: z.string().optional(),
      link: z.string().url().optional(),
      lat: z.number().min(-90).max(90).optional(),
      lng: z.number().min(-180).max(180).optional(),
    }),
  ),
});
const data = schema.parse(JSON.parse(await readFile(values.file, 'utf8')));
const cfg = loadConfig();
const db = createPool(cfg.DATABASE_URL);
await withTx(db, async (tx) => {
  const c = await tx.query('SELECT 1 FROM congregations WHERE id = $1', [values.congregation]);
  if (!c.rowCount) throw new Error('Congregação não encontrada.');
  const t = await tx.query(
    `INSERT INTO territories(congregation_id, number, name) VALUES ($1,$2,$3)
     ON CONFLICT (congregation_id, number) DO UPDATE SET name = COALESCE(EXCLUDED.name, territories.name)
     RETURNING id`,
    [values.congregation, data.territorio.numero, data.territorio.nome ?? null],
  );
  const tid = t.rows[0].id;
  for (const q of data.quadras) {
    await tx.query(
      `INSERT INTO blocks(congregation_id, territory_id, number, name, maps_url, lat, lng) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (territory_id, number) DO UPDATE SET maps_url = EXCLUDED.maps_url, lat = EXCLUDED.lat, lng = EXCLUDED.lng`,
      [values.congregation, tid, q.numero, q.nome ?? null, q.link ?? null, q.lat ?? null, q.lng ?? null],
    );
  }
  await audit(tx, { actorId: null, congregationId: values.congregation, action: 'territory.import', entity: 'territory', entityId: tid, details: { blocks: data.quadras.length } });
});
console.log(`Território ${data.territorio.numero} importado com ${data.quadras.length} quadra(s).`);
await db.end();
