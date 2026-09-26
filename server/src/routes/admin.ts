import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../lib/audit.js';
import { withTx } from '../lib/db.js';
import { conflict, notFound } from '../lib/errors.js';
import { hit } from '../lib/rateLimit.js';
import { hashAccessCode, newAccessCode, normalizeAccessCode } from '../lib/security.js';
import { requireAccess } from '../lib/session.js';
import { optionalText, parse, uuid } from '../lib/validate.js';

const P = z.object({ cid: uuid });

export async function adminRoutes(app: FastifyInstance) {
  const { db, cfg } = app.deps;

  // ---------------- Códigos de acesso ----------------
  app.get('/congregations/:cid/codes', async (req) => {
    const { cid } = parse(P, req.params);
    await requireAccess(db, req, cid, 'admin');
    const { rows } = await db.query(
      `SELECT c.id, c.code_hint, c.label, c.created_at, c.expires_at, c.used_at, c.canceled_at,
              cu.name AS created_by_name, uu.name AS used_by_name,
              CASE WHEN c.canceled_at IS NOT NULL THEN 'canceled'
                   WHEN c.used_at IS NOT NULL THEN 'used'
                   WHEN c.expires_at <= now() THEN 'expired'
                   ELSE 'active' END AS state
         FROM access_codes c
         LEFT JOIN users cu ON cu.id = c.created_by
         LEFT JOIN users uu ON uu.id = c.used_by
        WHERE c.congregation_id = $1
        ORDER BY c.created_at DESC LIMIT 200`,
      [cid],
    );
    return { codes: rows };
  });

  app.post('/congregations/:cid/codes', async (req, reply) => {
    const { cid } = parse(P, req.params);
    const acc = await requireAccess(db, req, cid, 'admin');
    const body = parse(
      z.object({ label: optionalText(60), validDays: z.number().int().min(1).max(30).default(7) }),
      req.body,
    );
    await hit(db, `codes:${acc.user.id}`, 100, 86400);
    const code = newAccessCode();
    const normalized = normalizeAccessCode(code)!;
    const { rows } = await db.query(
      `INSERT INTO access_codes(congregation_id, code_hash, code_hint, label, created_by, expires_at)
       VALUES ($1,$2,$3,$4,$5, now() + make_interval(days => $6)) RETURNING id, expires_at`,
      [cid, hashAccessCode(cfg.CODE_PEPPER, normalized), normalized.slice(-4), body.label, acc.user.id, body.validDays],
    );
    await audit(db, { actorId: acc.user.id, actorGlobal: acc.viaGlobal, congregationId: cid, action: 'code.create', entity: 'access_code', entityId: rows[0].id, details: { validDays: body.validDays } });
    // O código em texto só é mostrado agora; no banco fica apenas o HMAC.
    return reply.status(201).send({ id: rows[0].id, code, expiresAt: rows[0].expires_at });
  });

  app.post('/congregations/:cid/codes/:codeId/cancel', async (req) => {
    const { cid, codeId } = parse(P.extend({ codeId: uuid }), req.params);
    const acc = await requireAccess(db, req, cid, 'admin');
    const r = await db.query(
      `UPDATE access_codes SET canceled_at = now(), canceled_by = $3
        WHERE id = $1 AND congregation_id = $2 AND used_at IS NULL AND canceled_at IS NULL`,
      [codeId, cid, acc.user.id],
    );
    if (!r.rowCount) throw notFound('Código não encontrado ou já utilizado/cancelado.');
    await audit(db, { actorId: acc.user.id, actorGlobal: acc.viaGlobal, congregationId: cid, action: 'code.cancel', entity: 'access_code', entityId: codeId });
    return { ok: true };
  });

  // ---------------- Membros ----------------
  app.get('/congregations/:cid/members', async (req) => {
    const { cid } = parse(P, req.params);
    await requireAccess(db, req, cid, 'admin');
    const { rows } = await db.query(
      `SELECT m.id, m.role, m.status, m.joined_at, m.revoked_at, u.id AS user_id, u.name, u.email,
              (SELECT max(v.created_at) FROM visit_records v WHERE v.author_id = u.id AND v.congregation_id = m.congregation_id) AS last_record_at
         FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.congregation_id = $1
        ORDER BY m.status, m.role DESC, u.name`,
      [cid],
    );
    return { members: rows };
  });

  // Revogação: o vínculo fica inativo e todas as sessões do usuário são encerradas.
  // Mesmo que uma sessão sobrevivesse, requireAccess consulta o vínculo a cada requisição.
  app.post('/congregations/:cid/members/:mid/revoke', async (req) => {
    const { cid, mid } = parse(P.extend({ mid: uuid }), req.params);
    const acc = await requireAccess(db, req, cid, 'admin');
    await withTx(db, async (tx) => {
      const m = await tx.query(`SELECT user_id, role, status FROM memberships WHERE id = $1 AND congregation_id = $2 FOR UPDATE`, [mid, cid]);
      const row = m.rows[0];
      if (!row) throw notFound();
      if (row.status !== 'active') throw conflict('Este acesso já foi revogado.');
      if (row.user_id === acc.user.id) throw conflict('Você não pode revogar o próprio acesso.');
      if (row.role === 'admin') {
        const others = await tx.query(
          `SELECT count(*)::int AS n FROM memberships WHERE congregation_id = $1 AND role = 'admin' AND status = 'active' AND id <> $2`,
          [cid, mid],
        );
        if (others.rows[0].n === 0) throw conflict('A congregação precisa de ao menos um administrador.');
      }
      await tx.query(`UPDATE memberships SET status = 'revoked', revoked_at = now(), revoked_by = $3 WHERE id = $1 AND congregation_id = $2`, [
        mid, cid, acc.user.id,
      ]);
      await tx.query('DELETE FROM sessions WHERE user_id = $1', [row.user_id]);
      await audit(tx, { actorId: acc.user.id, actorGlobal: acc.viaGlobal, congregationId: cid, action: 'member.revoke', entity: 'membership', entityId: mid });
    });
    return { ok: true };
  });

  app.post('/congregations/:cid/members/:mid/role', async (req) => {
    const { cid, mid } = parse(P.extend({ mid: uuid }), req.params);
    const acc = await requireAccess(db, req, cid, 'admin');
    const body = parse(z.object({ role: z.enum(['publisher', 'admin']) }), req.body);
    await withTx(db, async (tx) => {
      const m = await tx.query(`SELECT role, status FROM memberships WHERE id = $1 AND congregation_id = $2 FOR UPDATE`, [mid, cid]);
      if (!m.rows[0] || m.rows[0].status !== 'active') throw notFound();
      if (m.rows[0].role === 'admin' && body.role === 'publisher') {
        const others = await tx.query(
          `SELECT count(*)::int AS n FROM memberships WHERE congregation_id = $1 AND role = 'admin' AND status = 'active' AND id <> $2`,
          [cid, mid],
        );
        if (others.rows[0].n === 0) throw conflict('A congregação precisa de ao menos um administrador.');
      }
      await tx.query('UPDATE memberships SET role = $3 WHERE id = $1 AND congregation_id = $2', [mid, cid, body.role]);
      await audit(tx, { actorId: acc.user.id, actorGlobal: acc.viaGlobal, congregationId: cid, action: 'member.role', entity: 'membership', entityId: mid, details: { role: body.role } });
    });
    return { ok: true };
  });

  app.get('/congregations/:cid/audit', async (req) => {
    const { cid } = parse(P, req.params);
    await requireAccess(db, req, cid, 'admin');
    const { rows } = await db.query(
      `SELECT a.at, a.action, a.entity, a.actor_global, u.name AS actor_name
         FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
        WHERE a.congregation_id = $1 ORDER BY a.at DESC LIMIT 200`,
      [cid],
    );
    return { entries: rows };
  });
}
