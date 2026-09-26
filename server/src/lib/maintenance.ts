import type { Queryable } from './db.js';

/** Limpeza periódica conforme a política de retenção (docs/privacidade-e-retencao.md). */
export async function runMaintenance(db: Queryable, auditRetentionDays: number): Promise<void> {
  await db.query(`DELETE FROM sessions WHERE expires_at < now()`);
  await db.query(`DELETE FROM email_tokens WHERE expires_at < now() - interval '7 days'`);
  await db.query(`DELETE FROM rate_limits WHERE window_start < now() - interval '2 days'`);
  await db.query(`DELETE FROM audit_log WHERE at < now() - make_interval(days => $1)`, [auditRetentionDays]);
}
