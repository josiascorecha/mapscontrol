import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { audit } from '../lib/audit.js';
import { withTx, type Queryable } from '../lib/db.js';
import { badRequest, conflict, HttpError } from '../lib/errors.js';
import { templates } from '../lib/mail.js';
import { hit } from '../lib/rateLimit.js';
import { hashPassword, hmac, newToken, sha256, verifyPassword } from '../lib/security.js';
import { clearSessionCookie, createSession, requireUser } from '../lib/session.js';
import { email, parse, password, personName } from '../lib/validate.js';

type Purpose = 'verify_email' | 'reset_password' | 'activate';
const TTL_HOURS: Record<Purpose, number> = { verify_email: 24, reset_password: 1, activate: 72 };
const PATHS: Record<Purpose, string> = { verify_email: '/confirmar-email', reset_password: '/nova-senha', activate: '/nova-senha' };

/** Cria token de uso único e invalida os anteriores do mesmo tipo. O token vai no fragmento (#) da URL: não chega a logs de servidor nem ao Referer. */
export async function createEmailToken(db: Queryable, origin: string, userId: string, purpose: Purpose): Promise<string> {
  await db.query(`UPDATE email_tokens SET used_at = now() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`, [userId, purpose]);
  const token = newToken();
  await db.query(
    `INSERT INTO email_tokens(user_id, purpose, token_hash, expires_at) VALUES ($1,$2,$3, now() + make_interval(hours => $4))`,
    [userId, purpose, sha256(token), TTL_HOURS[purpose]],
  );
  return `${origin}${PATHS[purpose]}#t=${token}`;
}

/** Consome o token de forma atômica (uso único). */
async function consumeEmailToken(db: Queryable, token: string, purposes: Purpose[]): Promise<{ userId: string; purpose: Purpose } | null> {
  if (!token || token.length > 100) return null;
  const { rows } = await db.query(
    `UPDATE email_tokens SET used_at = now()
      WHERE token_hash = $1 AND purpose = ANY($2) AND used_at IS NULL AND expires_at > now()
      RETURNING user_id, purpose`,
    [sha256(token), purposes],
  );
  return rows[0] ? { userId: rows[0].user_id, purpose: rows[0].purpose } : null;
}

export function ipKey(req: FastifyRequest, pepper: string): string {
  // Guardamos só um hash truncado do IP, para limitação de tentativas.
  return hmac(pepper, `ip:${req.ip}`).subarray(0, 12).toString('hex');
}

export async function authRoutes(app: FastifyInstance) {
  const { cfg, db, mailer } = app.deps;

  app.post('/auth/signup', async (req, reply) => {
    const body = parse(
      z.object({
        name: personName,
        email,
        password,
        intent: z.enum(['publisher', 'admin']).default('publisher'),
        acceptTerms: z.literal(true, { message: 'É preciso aceitar os termos de uso e a política de privacidade.' }),
        termsVersion: z.string(),
        privacyVersion: z.string(),
      }),
      req.body,
    );
    if (body.termsVersion !== cfg.TERMS_VERSION || body.privacyVersion !== cfg.PRIVACY_VERSION) {
      throw conflict('Os termos foram atualizados. Recarregue a página e leia a nova versão.', 'TERMS_OUTDATED');
    }
    await hit(db, `signup:${ipKey(req, cfg.CODE_PEPPER)}`, 30, 3600);

    const existing = await db.query('SELECT id, email_verified_at FROM users WHERE email = $1', [body.email]);
    if (existing.rows[0]) {
      const u = existing.rows[0];
      if (u.email_verified_at) {
        const url = await createEmailToken(db, cfg.APP_ORIGIN, u.id, 'reset_password');
        await mailer.send({ to: body.email, ...templates.alreadyRegistered(url) });
      } else {
        const url = await createEmailToken(db, cfg.APP_ORIGIN, u.id, 'verify_email');
        await mailer.send({ to: body.email, ...templates.verify(body.name, url) });
      }
    } else {
      const pwHash = await hashPassword(body.password);
      const url = await withTx(db, async (tx) => {
        const { rows } = await tx.query(
          `INSERT INTO users(name, email, password_hash, signup_intent) VALUES ($1,$2,$3,$4) RETURNING id`,
          [body.name, body.email, pwHash, body.intent],
        );
        const id = rows[0].id;
        await tx.query(
          `INSERT INTO consents(user_id, document, version) VALUES ($1,'terms',$2), ($1,'privacy',$3)`,
          [id, cfg.TERMS_VERSION, cfg.PRIVACY_VERSION],
        );
        await audit(tx, { actorId: id, action: 'user.signup', entity: 'user', entityId: id, details: { intent: body.intent } });
        return createEmailToken(tx, cfg.APP_ORIGIN, id, 'verify_email');
      });
      await mailer.send({ to: body.email, ...templates.verify(body.name, url) });
    }
    // Resposta idêntica em todos os casos: não revela se o e-mail já existe.
    return reply.status(202).send({ ok: true, message: 'Enviamos um link de confirmação para o seu e-mail.' });
  });

  app.post('/auth/resend-verification', async (req) => {
    const body = parse(z.object({ email }), req.body);
    await hit(db, `resend:${ipKey(req, cfg.CODE_PEPPER)}`, 20, 3600);
    await hit(db, `resend-email:${sha256(body.email).toString('hex')}`, 3, 3600);
    const { rows } = await db.query(
      `SELECT id, name FROM users WHERE email = $1 AND email_verified_at IS NULL AND deleted_at IS NULL`,
      [body.email],
    );
    if (rows[0]) {
      const url = await createEmailToken(db, cfg.APP_ORIGIN, rows[0].id, 'verify_email');
      await mailer.send({ to: body.email, ...templates.verify(rows[0].name, url) });
    }
    return { ok: true, message: 'Se houver cadastro pendente, enviaremos um novo link.' };
  });

  app.post('/auth/verify-email', async (req, reply) => {
    const body = parse(z.object({ token: z.string() }), req.body);
    const t = await consumeEmailToken(db, body.token, ['verify_email']);
    if (!t) throw badRequest('Link inválido ou expirado. Peça um novo link.', 'TOKEN_INVALID');
    await db.query(`UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1 AND deleted_at IS NULL`, [t.userId]);
    await audit(db, { actorId: t.userId, action: 'user.email_verified', entity: 'user', entityId: t.userId });
    await createSession(db, cfg, reply, t.userId);
    return { ok: true };
  });

  app.post('/auth/login', async (req, reply) => {
    const body = parse(z.object({ email, password: z.string().max(200) }), req.body);
    await hit(db, `login-ip:${ipKey(req, cfg.CODE_PEPPER)}`, 100, 900);
    await hit(db, `login-email:${sha256(body.email).toString('hex')}`, 10, 900);
    const { rows } = await db.query(
      `SELECT id, password_hash, email_verified_at FROM users WHERE email = $1 AND deleted_at IS NULL`,
      [body.email],
    );
    const u = rows[0];
    const ok = await verifyPassword(u?.password_hash ?? null, body.password);
    if (!u || !ok) throw new HttpError(401, 'INVALID_CREDENTIALS', 'E-mail ou senha incorretos.');
    if (!u.email_verified_at) {
      throw new HttpError(403, 'EMAIL_NOT_VERIFIED', 'Confirme seu e-mail antes de entrar. Verifique sua caixa de entrada.');
    }
    await createSession(db, cfg, reply, u.id);
    await audit(db, { actorId: u.id, action: 'user.login', entity: 'user', entityId: u.id });
    return { ok: true };
  });

  app.post('/auth/logout', async (req, reply) => {
    if (req.user) await db.query('DELETE FROM sessions WHERE id = $1', [req.user.sessionId]);
    clearSessionCookie(cfg, reply);
    return { ok: true };
  });

  app.post('/auth/forgot-password', async (req) => {
    const body = parse(z.object({ email }), req.body);
    await hit(db, `forgot-ip:${ipKey(req, cfg.CODE_PEPPER)}`, 30, 3600);
    await hit(db, `forgot-email:${sha256(body.email).toString('hex')}`, 3, 3600);
    const { rows } = await db.query(`SELECT id, name FROM users WHERE email = $1 AND deleted_at IS NULL`, [body.email]);
    if (rows[0]) {
      const url = await createEmailToken(db, cfg.APP_ORIGIN, rows[0].id, 'reset_password');
      await mailer.send({ to: body.email, ...templates.reset(rows[0].name, url) });
    }
    return { ok: true, message: 'Se o e-mail estiver cadastrado, enviaremos um link para criar nova senha.' };
  });

  // Serve tanto para redefinição quanto para ativação de conta criada pelo servidor.
  app.post('/auth/set-password', async (req, reply) => {
    const body = parse(z.object({ token: z.string(), password }), req.body);
    await hit(db, `setpw-ip:${ipKey(req, cfg.CODE_PEPPER)}`, 20, 3600);
    const pwHash = await hashPassword(body.password);
    const userId = await withTx(db, async (tx) => {
      const t = await consumeEmailToken(tx, body.token, ['reset_password', 'activate']);
      if (!t) throw badRequest('Link inválido ou expirado. Peça um novo link.', 'TOKEN_INVALID');
      await tx.query(
        `UPDATE users SET password_hash = $2, email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1 AND deleted_at IS NULL`,
        [t.userId, pwHash],
      );
      // Troca de senha encerra todas as sessões abertas.
      await tx.query('DELETE FROM sessions WHERE user_id = $1', [t.userId]);
      await audit(tx, { actorId: t.userId, action: t.purpose === 'activate' ? 'user.activated' : 'user.password_reset', entity: 'user', entityId: t.userId });
      return t.userId;
    });
    await createSession(db, cfg, reply, userId);
    return { ok: true };
  });

  app.get('/me', async (req) => {
    const user = requireUser(req);
    const m = await db.query(
      `SELECT m.id, m.role, c.id AS congregation_id, c.name, c.city, c.state
         FROM memberships m JOIN congregations c ON c.id = m.congregation_id
        WHERE m.user_id = $1 AND m.status = 'active'`,
      [user.id],
    );
    const revoked = await db.query(
      `SELECT 1 FROM memberships WHERE user_id = $1 AND status = 'revoked' LIMIT 1`,
      [user.id],
    );
    const consent = await db.query(
      `SELECT document, max(version) AS version FROM consents WHERE user_id = $1 GROUP BY document`,
      [user.id],
    );
    const accepted = Object.fromEntries(consent.rows.map((r) => [r.document, r.version]));
    const row = m.rows[0];
    return {
      user: { id: user.id, name: user.name, email: user.email, isGlobalAdmin: user.isGlobalAdmin, signupIntent: user.signupIntent },
      membership: row
        ? { id: row.id, role: row.role, congregation: { id: row.congregation_id, name: row.name, city: row.city, state: row.state } }
        : null,
      wasRevoked: !row && (revoked.rowCount ?? 0) > 0,
      needsConsent: accepted.terms !== cfg.TERMS_VERSION || accepted.privacy !== cfg.PRIVACY_VERSION,
    };
  });

  app.post('/me/consent', async (req) => {
    const user = requireUser(req);
    const body = parse(z.object({ termsVersion: z.string(), privacyVersion: z.string(), accept: z.literal(true) }), req.body);
    if (body.termsVersion !== cfg.TERMS_VERSION || body.privacyVersion !== cfg.PRIVACY_VERSION) {
      throw conflict('Versão dos termos desatualizada. Recarregue a página.', 'TERMS_OUTDATED');
    }
    await db.query(`INSERT INTO consents(user_id, document, version) VALUES ($1,'terms',$2), ($1,'privacy',$3)`, [
      user.id,
      cfg.TERMS_VERSION,
      cfg.PRIVACY_VERSION,
    ]);
    return { ok: true };
  });

  app.patch('/me', async (req) => {
    const user = requireUser(req);
    const body = parse(z.object({ name: personName }), req.body);
    await db.query('UPDATE users SET name = $2 WHERE id = $1', [user.id, body.name]);
    return { ok: true };
  });

  app.post('/me/password', async (req) => {
    const user = requireUser(req);
    const body = parse(z.object({ current: z.string().max(200), password }), req.body);
    await hit(db, `chpw:${user.id}`, 10, 3600);
    const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [user.id]);
    if (!(await verifyPassword(rows[0]?.password_hash ?? null, body.current))) {
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Senha atual incorreta.');
    }
    await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, await hashPassword(body.password)]);
    // Encerra as outras sessões; mantém a atual.
    await db.query('DELETE FROM sessions WHERE user_id = $1 AND id <> $2', [user.id, user.sessionId]);
    await audit(db, { actorId: user.id, action: 'user.password_changed', entity: 'user', entityId: user.id });
    return { ok: true };
  });

  // Exclusão de conta: anonimiza os dados pessoais e mantém o histórico operacional sem identificação.
  app.post('/me/delete', async (req, reply) => {
    const user = requireUser(req);
    const body = parse(z.object({ password: z.string().max(200), confirm: z.literal('EXCLUIR', { message: 'Digite EXCLUIR para confirmar.' }) }), req.body);
    await hit(db, `delete:${user.id}`, 5, 3600);
    const { rows } = await db.query('SELECT password_hash FROM users WHERE id = $1', [user.id]);
    if (!(await verifyPassword(rows[0]?.password_hash ?? null, body.password))) {
      throw new HttpError(401, 'INVALID_CREDENTIALS', 'Senha incorreta.');
    }
    await withTx(db, async (tx) => {
      // Impede deixar uma congregação com membros e sem administrador.
      const sole = await tx.query(
        `SELECT m.congregation_id FROM memberships m
          WHERE m.user_id = $1 AND m.role = 'admin' AND m.status = 'active'
            AND NOT EXISTS (SELECT 1 FROM memberships o WHERE o.congregation_id = m.congregation_id
                             AND o.role = 'admin' AND o.status = 'active' AND o.user_id <> $1)
            AND EXISTS (SELECT 1 FROM memberships p WHERE p.congregation_id = m.congregation_id
                         AND p.status = 'active' AND p.user_id <> $1)`,
        [user.id],
      );
      if (sole.rowCount) {
        throw conflict('Você é o único administrador de uma congregação com membros. Promova outro administrador antes de excluir a conta.', 'SOLE_ADMIN');
      }
      await tx.query(
        `UPDATE memberships SET status = 'revoked', revoked_at = now(), revoked_by = $1 WHERE user_id = $1 AND status = 'active'`,
        [user.id],
      );
      await tx.query(
        `UPDATE users SET name = 'Usuário removido', email = NULL, password_hash = NULL, is_global_admin = false, deleted_at = now() WHERE id = $1`,
        [user.id],
      );
      await tx.query('DELETE FROM sessions WHERE user_id = $1', [user.id]);
      await tx.query('DELETE FROM email_tokens WHERE user_id = $1', [user.id]);
      await audit(tx, { actorId: user.id, action: 'user.deleted', entity: 'user', entityId: user.id });
    });
    clearSessionCookie(cfg, reply);
    return { ok: true };
  });
}
