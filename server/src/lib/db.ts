import pg from 'pg';

// Datas (tipo DATE) retornam como texto 'AAAA-MM-DD', sem conversão de fuso.
pg.types.setTypeParser(1082, (v) => v);
// bigint (contagens) como número.
pg.types.setTypeParser(20, (v) => Number(v));

export type Db = pg.Pool;
export type Tx = pg.PoolClient;
export type Queryable = pg.Pool | pg.PoolClient;

export function createPool(url: string): pg.Pool {
  const pool = new pg.Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000 });
  pool.on('error', (err) => {
    // Nunca registrar a string de conexão (contém senha).
    console.error('Erro no pool do PostgreSQL:', err.message);
  });
  return pool;
}

export async function withTx<T>(pool: pg.Pool, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
