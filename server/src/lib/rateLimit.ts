import type { Queryable } from './db.js';
import { tooMany } from './errors.js';

/**
 * Limite em janela fixa, persistido no PostgreSQL (sobrevive a reinícios e
 * vale para várias instâncias). Lança 429 ao exceder.
 */
export async function hit(db: Queryable, bucket: string, limit: number, windowSec: number): Promise<void> {
  const { rows } = await db.query<{ hits: number }>(
    `INSERT INTO rate_limits(bucket, window_start, hits)
     VALUES ($1, to_timestamp(floor(extract(epoch from now()) / $2) * $2), 1)
     ON CONFLICT (bucket, window_start) DO UPDATE SET hits = rate_limits.hits + 1
     RETURNING hits`,
    [bucket, windowSec],
  );
  if (rows[0].hits > limit) throw tooMany();
}
