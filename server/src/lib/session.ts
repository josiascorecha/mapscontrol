import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config.js';
import type { Queryable } from './db.js';
import { forbidden, notFound, unauthorized } from './errors.js';
import { newToken, sha256 } from './security.js';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  isGlobalAdmin: boolean;
  signupIntent: 'publisher' | 'admin';
  sessionId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

export async function createSession(db: Queryable, cfg: Config, reply: FastifyReply, userId: string) {
  const token = newToken();
  await db.query(
    `INSERT INTO sessions(user_id, token_hash, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))`,
    [userId, sha256(token), cfg.SESSION_TTL_DAYS],
  );
  reply.setCookie(cfg.cookieName, token, {
    path: '/',
    httpOnly: true,
    secure: cfg.cookieSecure,
    sameSite: 'lax',
    maxAge: cfg.SESSION_TTL_DAYS * 86400,
  });
}

export function clearSessionCookie(cfg: Config, reply: FastifyReply) {
  reply.clearCookie(cfg.cookieName, { path: '/', secure: cfg.cookieSecure, httpOnly: true, sameSite: 'lax' });
}

/** Carrega o usuário a partir do cookie. Cada requisição consulta o banco: sessões revogadas param de valer imediatamente. */
export async function loadSession(db: Queryable, cfg: Config, req: FastifyRequest): Promise<SessionUser | null> {
  const token = req.cookies[cfg.cookieName];
  if (!token || token.length > 100) return null;
  const { rows } = await db.query(
    `SELECT s.id AS session_id, s.last_seen_at, u.id, u.name, u.email, u.is_global_admin, u.signup_intent
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()
        AND u.deleted_at IS NULL AND u.email_verified_at IS NOT NULL`,
    [sha256(token)],
  );
  const r = rows[0];
  if (!r) return null;
  // Renovação deslizante, no máximo uma escrita por hora por sessão.
  if (Date.now() - new Date(r.last_seen_at).getTime() > 3600_000) {
    await db.query(
      `UPDATE sessions SET last_seen_at = now(), expires_at = now() + make_interval(days => $2) WHERE id = $1`,
      [r.session_id, cfg.SESSION_TTL_DAYS],
    );
  }
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    isGlobalAdmin: r.is_global_admin,
    signupIntent: r.signup_intent,
    sessionId: r.session_id,
  };
}

export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

export type Role = 'publisher' | 'admin';

export interface Access {
  user: SessionUser;
  congregationId: string;
  role: Role | 'global';
  /** true quando o acesso só existe por ser Administrador Geral (ação será marcada na auditoria). */
  viaGlobal: boolean;
  isAdmin: boolean;
}

/**
 * Autorização por congregação, sempre verificada no servidor a partir do banco.
 * O vínculo precisa estar ativo: um publicador revogado perde acesso na próxima requisição.
 */
export async function requireAccess(db: Queryable, req: FastifyRequest, congregationId: string, min: Role): Promise<Access> {
  const user = requireUser(req);
  if (!/^[0-9a-f-]{36}$/i.test(congregationId)) throw notFound();
  const { rows } = await db.query<{ role: Role }>(
    `SELECT m.role FROM memberships m WHERE m.user_id = $1 AND m.congregation_id = $2 AND m.status = 'active'`,
    [user.id, congregationId],
  );
  const role = rows[0]?.role;
  if (role && (min === 'publisher' || role === 'admin')) {
    return { user, congregationId, role, viaGlobal: false, isAdmin: role === 'admin' };
  }
  if (role && !user.isGlobalAdmin) throw forbidden('Apenas administradores podem fazer isso.');
  if (user.isGlobalAdmin) {
    const c = await db.query('SELECT 1 FROM congregations WHERE id = $1', [congregationId]);
    if (!c.rowCount) throw notFound();
    return { user, congregationId, role: 'global', viaGlobal: true, isAdmin: true };
  }
  // Mesma resposta para "não existe" e "não é sua": não revela outras congregações.
  throw notFound();
}

export function requireGlobalAdmin(req: FastifyRequest): SessionUser {
  const user = requireUser(req);
  if (!user.isGlobalAdmin) throw forbidden();
  return user;
}
