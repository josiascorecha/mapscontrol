import type { FastifyInstance } from 'fastify';
import { audit } from '../lib/audit.js';
import { requireGlobalAdmin } from '../lib/session.js';

/**
 * Administração geral. O acesso a dados de cada congregação usa as mesmas rotas
 * dos administradores (requireAccess libera o Administrador Geral e marca a auditoria).
 */
export async function globalRoutes(app: FastifyInstance) {
  const { db } = app.deps;

  app.get('/global/congregations', async (req) => {
    const user = requireGlobalAdmin(req);
    await audit(db, { actorId: user.id, actorGlobal: true, action: 'global.list_congregations' });
    const { rows } = await db.query(
      `SELECT c.id, c.name, c.city, c.state, c.created_at,
              (SELECT count(*) FROM memberships m WHERE m.congregation_id = c.id AND m.status = 'active') AS members,
              (SELECT count(*) FROM territories t WHERE t.congregation_id = c.id) AS territories
         FROM congregations c ORDER BY c.name`,
    );
    return { congregations: rows };
  });

  app.get('/global/audit', async (req) => {
    requireGlobalAdmin(req);
    const { rows } = await db.query(
      `SELECT a.at, a.action, a.entity, a.actor_global, u.name AS actor_name, c.name AS congregation_name
         FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN congregations c ON c.id = a.congregation_id
        WHERE a.actor_global ORDER BY a.at DESC LIMIT 300`,
    );
    return { entries: rows };
  });
}
