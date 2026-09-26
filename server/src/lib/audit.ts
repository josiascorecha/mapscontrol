import type { Queryable } from './db.js';

export interface AuditEntry {
  actorId: string | null;
  actorGlobal?: boolean;
  congregationId?: string | null;
  action: string;
  entity?: string;
  entityId?: string | null;
  /** Somente metadados operacionais. Nunca senhas, tokens, códigos ou dados de moradores. */
  details?: Record<string, unknown>;
}

export async function audit(db: Queryable, e: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO audit_log(actor_id, actor_global, congregation_id, action, entity, entity_id, details)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      e.actorId,
      e.actorGlobal ?? false,
      e.congregationId ?? null,
      e.action,
      e.entity ?? null,
      e.entityId ?? null,
      JSON.stringify(e.details ?? {}),
    ],
  );
}
