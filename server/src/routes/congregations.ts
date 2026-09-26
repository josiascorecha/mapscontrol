import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../lib/audit.js';
import { withTx } from '../lib/db.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { googleMapsUrl, resolveMapsLink } from '../lib/maps.js';
import { hit } from '../lib/rateLimit.js';
import { hashAccessCode, normalizeAccessCode } from '../lib/security.js';
import { requireAccess, requireUser } from '../lib/session.js';
import { optionalText, parse, uuid } from '../lib/validate.js';
import { ipKey } from './auth.js';

const P = z.object({ cid: uuid });
const PT = P.extend({ tid: uuid });
const PB = P.extend({ bid: uuid });

const coord = (min: number, max: number) => z.number().min(min).max(max).nullable().optional();

const blockBody = z
  .object({
    number: z.number({ message: 'Informe o número da quadra.' }).int().positive().max(100000),
    name: optionalText(120),
    mapsUrl: optionalText(2000),
    lat: coord(-90, 90),
    lng: coord(-180, 180),
  })
  .refine((b) => (b.lat == null) === (b.lng == null), { message: 'Informe latitude e longitude juntas.' });

/** Totais por situação (casas + apartamentos) para um filtro SQL. */
export const STATUS_COUNTS = `
  count(*) FILTER (WHERE ts.status = 'pending')   AS pending,
  count(*) FILTER (WHERE ts.status = 'letter')    AS letter,
  count(*) FILTER (WHERE ts.status = 'contacted') AS contacted,
  count(ts.*) AS total`;

export async function congregationRoutes(app: FastifyInstance) {
  const { db, cfg, fetcher } = app.deps;

  // Administrador cria a própria congregação — sem aprovação do Administrador Geral.
  app.post('/congregations', async (req, reply) => {
    const user = requireUser(req);
    const body = parse(
      z.object({
        name: z.string({ message: 'Informe o nome da congregação.' }).trim().min(2, 'Informe o nome da congregação.').max(120),
        city: optionalText(80),
        state: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'UF inválida.').optional().nullable(),
      }),
      req.body,
    );
    if (user.signupIntent !== 'admin' && !user.isGlobalAdmin) {
      throw forbidden('Somente contas de Administrador podem criar congregações. Publicadores entram com um código.');
    }
    await hit(db, `create-cong:${user.id}`, 3, 86400);
    const id = await withTx(db, async (tx) => {
      const active = await tx.query(`SELECT 1 FROM memberships WHERE user_id = $1 AND status = 'active'`, [user.id]);
      if (active.rowCount) throw conflict('Você já participa de uma congregação.', 'ALREADY_MEMBER');
      const { rows } = await tx.query(
        `INSERT INTO congregations(name, city, state, created_by) VALUES ($1,$2,$3,$4) RETURNING id`,
        [body.name, body.city, body.state ?? null, user.id],
      );
      const cid = rows[0].id;
      await tx.query(`INSERT INTO memberships(user_id, congregation_id, role) VALUES ($1,$2,'admin')`, [user.id, cid]);
      await audit(tx, { actorId: user.id, congregationId: cid, action: 'congregation.create', entity: 'congregation', entityId: cid });
      return cid;
    });
    return reply.status(201).send({ id });
  });

  // Publicador ingressa com código individual, de uso único.
  app.post('/join', async (req) => {
    const user = requireUser(req);
    const body = parse(z.object({ code: z.string().max(40) }), req.body);
    // Proteção contra adivinhação: limites por usuário e por IP.
    await hit(db, `join-user:${user.id}`, 5, 900);
    await hit(db, `join-ip:${ipKey(req, cfg.CODE_PEPPER)}`, 60, 900);
    const normalized = normalizeAccessCode(body.code);
    if (!normalized) throw badRequest('Código inválido. Confira as letras e números.', 'CODE_INVALID');
    const codeHash = hashAccessCode(cfg.CODE_PEPPER, normalized);

    return withTx(db, async (tx) => {
      const active = await tx.query(`SELECT 1 FROM memberships WHERE user_id = $1 AND status = 'active'`, [user.id]);
      if (active.rowCount) throw conflict('Você já participa de uma congregação.', 'ALREADY_MEMBER');
      // Consumo atômico: só uma transação consegue marcar o código como usado.
      const { rows } = await tx.query(
        `UPDATE access_codes SET used_at = now(), used_by = $2
          WHERE code_hash = $1 AND used_at IS NULL AND canceled_at IS NULL AND expires_at > now()
          RETURNING id, congregation_id`,
        [codeHash, user.id],
      );
      if (!rows[0]) throw badRequest('Código inválido, expirado ou já utilizado. Peça um novo código ao administrador.', 'CODE_INVALID');
      const cid = rows[0].congregation_id;
      // Um publicador revogado só volta com um novo código; o vínculo é reativado como Publicador.
      await tx.query(
        `INSERT INTO memberships(user_id, congregation_id, role) VALUES ($1,$2,'publisher')
         ON CONFLICT (user_id, congregation_id) DO UPDATE
           SET status = 'active', role = 'publisher', joined_at = now(), revoked_at = NULL, revoked_by = NULL`,
        [user.id, cid],
      );
      await audit(tx, { actorId: user.id, congregationId: cid, action: 'member.join', entity: 'access_code', entityId: rows[0].id });
      return { congregationId: cid };
    });
  });

  app.get('/congregations/:cid', async (req) => {
    const { cid } = parse(P, req.params);
    const acc = await requireAccess(db, req, cid, 'publisher');
    if (acc.viaGlobal) await audit(db, { actorId: acc.user.id, actorGlobal: true, congregationId: cid, action: 'global.view_congregation' });
    const c = await db.query('SELECT id, name, city, state, created_at FROM congregations WHERE id = $1', [cid]);
    const totals = await db.query(`SELECT ${STATUS_COUNTS} FROM target_status ts WHERE ts.congregation_id = $1`, [cid]);
    return { congregation: c.rows[0], role: acc.role, isAdmin: acc.isAdmin, viaGlobal: acc.viaGlobal, totals: totals.rows[0] };
  });

  app.patch('/congregations/:cid', async (req) => {
    const { cid } = parse(P, req.params);
    const acc = await requireAccess(db, req, cid, 'admin');
    const body = parse(
      z.object({
        name: z.string().trim().min(2).max(120),
        city: optionalText(80),
        state: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'UF inválida.').optional().nullable(),
      }),
      req.body,
    );
    await db.query('UPDATE congregations SET name=$2, city=$3, state=$4 WHERE id=$1', [cid, body.name, body.city, body.state ?? null]);
    await audit(db, { actorId: acc.user.id, actorGlobal: acc.viaGlobal, congregationId: cid, action: 'congregation.update', entity: 'congregation', entityId: cid });
    return { ok: true };
  });

  // ---------------- Territórios ----------------
  app.get('/congregations/:cid/territories', async (req) => {
    const { cid } = parse(P, req.params);
    await requireAccess(db, req, cid, 'publisher');
    const { rows } = await db.query(
      `SELECT t.id, t.number, t.name, t.notes,
              (SELECT count(*) FROM blocks b WHERE b.territory_id = t.id) AS blocks,
              s.pending, s.letter, s.contacted, s.total
         FROM territories t
         LEFT JOIN LATERAL (
           SELECT ${STATUS_COUNTS}
             FROM target_status ts
             JOIN addresses a ON a.id = ts.address_id
             JOIN blocks b ON b.id = a.block_id
            WHERE b.territory_id = t.id
         ) s ON true
        WHERE t.congregation_id = $1
        ORDER BY t.number`,
      [cid],
    );
    return { territories: rows };
  });

  const territoryBody = z.object({
    number: z.number({ message: 'Informe o número do território.' }).int().positive().max(100000),
    name: optionalText(120),
    notes: optionalText(1000),
  });

  app.post('/congregations/:cid/territories', async (req, reply) => {
    const { cid } = parse(P, req.params);
    const acc = await requireAccess(db, req, cid, 'admin');
    const body = parse(territoryBody, req.body);
    const { rows } = await db.query(
      `INSERT INTO territories(congregation_id, number, name, notes) VALUES ($1,$2,$3,$4) RETURNING id`,
      [cid, body.number, body.name, body.notes],
    );
    await audit(db, { actorId: acc.user.id, actorGlobal: acc.viaGlobal, congregationId: cid, action: 'territory.create', entity: 'territory', entityId: rows[0].id, details: { number: body.number } });
    return reply.status(201).send({ id: rows[0].id });
  });

  app.get('/congregations/:cid/territories/:tid', async (req) => {
    const { cid, tid } = parse(PT, req.params);
    const acc = await requireAccess(db, req, cid, 'publisher');
    const t = await db.query('SELECT id, number, name, notes FROM territories WHERE id=$1 AND congregation_id=$2', [tid, cid]);
    if (!t.rows[0]) throw notFound();
    const { rows } = await db.query(
      `SELECT b.id, b.number, b.name, b.maps_url, b.lat, b.lng,
              s.pending, s.letter, s.contacted, s.total,
              (SELECT count(*) FROM addresses a WHERE a.block_id = b.id AND a.kind = 'building') AS buildings
         FROM blocks b
         LEFT JOIN LATERAL (
           SELECT ${STATUS_COUNTS} FROM target_status ts JOIN addresses a ON a.id = ts.address_id WHERE a.block_id = b.id
         ) s ON true
        WHERE b.territory_id = $1 AND b.congregation_id = $2
        ORDER BY b.number`,
      [tid, cid],
    );
    return {
      territory: t.rows[0],
      isAdmin: acc.isAdmin,
      blocks: rows.map((b) => ({ ...b, googleMapsUrl: b.lat != null ? googleMapsUrl(b.lat, b.lng) : b.maps_url })),
    };
  });

  app.patch('/congregations/:cid/territories/:tid', async (req) => {
    const { cid, tid } = parse(PT, req.params);
    const acc = await requireAccess(db, req, cid, 'admin');
    const body = parse(territoryBody, req.body);
    const r = await db.query(`UPDATE territories SET number=$3, name=$4, notes=$5 WHERE id=$1 AND congregation_id=$2`, [
      tid, cid, body.number, body.name, body.notes,
    ]);
    if (!r.rowCount) throw notFound();
    await audit(db, { actorId: acc.user.id, actorGlobal: acc.viaGlobal, congregationId: cid, action: 'territory.update', entity: 'territory', entityId: tid });
    return { ok: true };
  });

  app.delete('/congregations/:cid/territories/:tid', async (req) => {
    const { cid, tid } = parse(PT, req.params);
    const acc = await requireAccess(db, req, cid, 'admin');
    const r = await db.query('DELETE FROM territories WHERE id=$1 AND congregation_id=$2 RETURNING number', [tid, cid]);
    if (!r.rowCount) throw notFound();
    await audit(db, { actorId: acc.user.id, actorGlobal: acc.viaGlobal, congregationId: cid, action: 'territory.delete', entity: 'territory', entityId: tid, details: { number: r.rows[0].number } });
    return { ok: true };
  });

  // ---------------- Quadras ----------------
  app.post('/congregations/:cid/territories/:tid/blocks', async (req, reply) => {
    const { cid, tid } = parse(PT, req.params);
    const acc = await requireAccess(db, req, cid, 'admin');
    const body = parse(blockBody, req.body);
    const t = await db.query('SELECT 1 FROM territories WHERE id=$1 AND congregation_id=$2', [tid, cid]);
    if (!t.rowCount) throw notFound();
    const { rows } = await db.query(
      `INSERT INTO blocks(congregation_id, territory_id, number, name, maps_url, lat, lng)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [cid, tid, body.number, body.name, body.mapsUrl, body.lat ?? null, body.lng ?? null],
    );
    await audit(db, { actorId: acc.user.id, actorGlobal: acc.viaGlobal, congregationId: cid, action: 'block.create', entity: 'block', entityId: rows[0].id, details: { number: body.number } });
    return reply.status(201).send({ id: rows[0].id });
  });

  app.patch('/congregations/:cid/blocks/:bid', async (req) => {
    const { cid, bid } = parse(PB, req.params);
    const acc = await requireAccess(db, req, cid, 'admin');
    const body = parse(blockBody, req.body);
    const r = await db.query(
      `UPDATE blocks SET number=$3, name=$4, maps_url=$5, lat=$6, lng=$7 WHERE id=$1 AND congregation_id=$2`,
      [bid, cid, body.number, body.name, body.mapsUrl, body.lat ?? null, body.lng ?? null],
    );
    if (!r.rowCount) throw notFound();
    await audit(db, { actorId: acc.user.id, actorGlobal: acc.viaGlobal, congregationId: cid, action: 'block.update', entity: 'block', entityId: bid });
    return { ok: true };
  });

  app.delete('/congregations/:cid/blocks/:bid', async (req) => {
    const { cid, bid } = parse(PB, req.params);
    const acc = await requireAccess(db, req, cid, 'admin');
    const r = await db.query('DELETE FROM blocks WHERE id=$1 AND congregation_id=$2 RETURNING number', [bid, cid]);
    if (!r.rowCount) throw notFound();
    await audit(db, { actorId: acc.user.id, actorGlobal: acc.viaGlobal, congregationId: cid, action: 'block.delete', entity: 'block', entityId: bid, details: { number: r.rows[0].number } });
    return { ok: true };
  });

  // Resolve link do Google Maps em coordenadas (somente administradores, com limite de uso).
  app.post('/congregations/:cid/maps/resolve', async (req) => {
    const { cid } = parse(P, req.params);
    const acc = await requireAccess(db, req, cid, 'admin');
    const body = parse(z.object({ url: z.string().trim().min(8).max(2000) }), req.body);
    await hit(db, `maps:${acc.user.id}`, 30, 3600);
    return resolveMapsLink(body.url, fetcher);
  });
}
