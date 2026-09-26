import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { audit } from '../lib/audit.js';
import { withTx } from '../lib/db.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { googleMapsUrl } from '../lib/maps.js';
import { requireAccess } from '../lib/session.js';
import { isoDate, operationalNote, optionalText, parse, uuid } from '../lib/validate.js';
import { STATUS_COUNTS } from './congregations.js';

const P = z.object({ cid: uuid });
const PB = P.extend({ bid: uuid });
const PA = P.extend({ aid: uuid });

const unitItem = z.object({
  tower: z.string().trim().max(30).default(''),
  identifier: z.string({ message: 'Informe o número do apartamento.' }).trim().min(1, 'Informe o número do apartamento.').max(20),
});
const unitList = z.array(unitItem).max(500, 'Máximo de 500 apartamentos por vez.');

const addressBody = z.object({
  kind: z.enum(['house', 'building']).default('house'),
  number: z.string({ message: 'Informe o número.' }).trim().min(1, 'Informe o número.').max(20, 'Número muito longo.'),
  street: optionalText(120),
  name: optionalText(120),
  notes: operationalNote(500),
  units: unitList.optional(),
});

export async function fieldRoutes(app: FastifyInstance) {
  const { db } = app.deps;

  async function getAddress(cid: string, aid: string) {
    const { rows } = await db.query(
      `SELECT a.id, a.kind, a.number, a.street, a.name, a.notes, a.block_id, a.created_by,
              b.number AS block_number, b.territory_id, t.number AS territory_number
         FROM addresses a JOIN blocks b ON b.id = a.block_id JOIN territories t ON t.id = b.territory_id
        WHERE a.id = $1 AND a.congregation_id = $2`,
      [aid, cid],
    );
    if (!rows[0]) throw notFound();
    return rows[0];
  }

  // Quadra com casas e prédios
  app.get('/congregations/:cid/blocks/:bid', async (req) => {
    const { cid, bid } = parse(PB, req.params);
    const acc = await requireAccess(db, req, cid, 'publisher');
    const b = await db.query(
      `SELECT b.id, b.number, b.name, b.maps_url, b.lat, b.lng, b.territory_id, t.number AS territory_number, t.name AS territory_name
         FROM blocks b JOIN territories t ON t.id = b.territory_id
        WHERE b.id = $1 AND b.congregation_id = $2`,
      [bid, cid],
    );
    if (!b.rows[0]) throw notFound();
    const { rows } = await db.query(
      `SELECT a.id, a.kind, a.number, a.street, a.name, a.notes,
              hs.status, hs.last_contact_on, hs.last_letter_on, hs.last_absent_on,
              us.pending, us.letter, us.contacted, us.total
         FROM addresses a
         LEFT JOIN target_status hs ON hs.address_id = a.id AND hs.unit_id IS NULL AND a.kind = 'house'
         LEFT JOIN LATERAL (
           SELECT ${STATUS_COUNTS} FROM target_status ts WHERE ts.address_id = a.id AND ts.unit_id IS NOT NULL
         ) us ON a.kind = 'building'
        WHERE a.block_id = $1 AND a.congregation_id = $2
        ORDER BY a.street NULLS FIRST, NULLIF(regexp_replace(a.number, '\\D', '', 'g'), '')::bigint NULLS LAST, a.number`,
      [bid, cid],
    );
    const block = b.rows[0];
    return {
      block: { ...block, googleMapsUrl: block.lat != null ? googleMapsUrl(block.lat, block.lng) : block.maps_url },
      isAdmin: acc.isAdmin,
      addresses: rows,
    };
  });

  // Cadastro de casa (padrão) ou prédio com apartamentos
  app.post('/congregations/:cid/blocks/:bid/addresses', async (req, reply) => {
    const { cid, bid } = parse(PB, req.params);
    const acc = await requireAccess(db, req, cid, 'publisher');
    const body = parse(addressBody, req.body);
    if (body.kind === 'house' && body.units?.length) throw badRequest('Casas não têm apartamentos.');
    const blk = await db.query('SELECT 1 FROM blocks WHERE id=$1 AND congregation_id=$2', [bid, cid]);
    if (!blk.rowCount) throw notFound();

    const id = await withTx(db, async (tx) => {
      const dup = await tx.query(
        `SELECT 1 FROM addresses WHERE block_id=$1 AND kind=$2 AND lower(number)=lower($3) AND coalesce(lower(street),'') = coalesce(lower($4),'')`,
        [bid, body.kind, body.number, body.street],
      );
      if (dup.rowCount) throw conflict(`Já existe ${body.kind === 'house' ? 'uma casa' : 'um prédio'} com o número ${body.number} nesta quadra.`, 'DUPLICATE');
      const { rows } = await tx.query(
        `INSERT INTO addresses(congregation_id, block_id, kind, number, street, name, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [cid, bid, body.kind, body.number, body.street, body.kind === 'building' ? body.name : null, body.notes, acc.user.id],
      );
      const aid = rows[0].id;
      if (body.kind === 'building' && body.units?.length) {
        await insertUnits(tx, cid, aid, body.units);
      }
      await audit(tx, { actorId: acc.user.id, actorGlobal: acc.viaGlobal, congregationId: cid, action: 'address.create', entity: 'address', entityId: aid, details: { kind: body.kind, units: body.units?.length ?? 0 } });
      return aid;
    });
    return reply.status(201).send({ id });
  });

  app.get('/congregations/:cid/addresses/:aid', async (req) => {
    const { cid, aid } = parse(PA, req.params);
    const acc = await requireAccess(db, req, cid, 'publisher');
    const address = await getAddress(cid, aid);
    let units: unknown[] = [];
    let status = null;
    if (address.kind === 'building') {
      const r = await db.query(
        `SELECT u.id, u.tower, u.identifier, ts.status, ts.last_contact_on, ts.last_letter_on, ts.last_absent_on
           FROM units u JOIN target_status ts ON ts.unit_id = u.id
          WHERE u.address_id = $1 AND u.congregation_id = $2
          ORDER BY u.tower, NULLIF(regexp_replace(u.identifier, '\\D', '', 'g'), '')::bigint NULLS LAST, u.identifier`,
        [aid, cid],
      );
      units = r.rows;
    } else {
      const r = await db.query(
        `SELECT status, last_contact_on, last_letter_on, last_absent_on FROM target_status WHERE address_id = $1 AND unit_id IS NULL`,
        [aid],
      );
      status = r.rows[0];
    }
    const canEdit = acc.isAdmin || address.created_by === acc.user.id;
    delete address.created_by;
    return { address, status, units, isAdmin: acc.isAdmin, canEdit };
  });

  app.patch('/congregations/:cid/addresses/:aid', async (req) => {
    const { cid, aid } = parse(PA, req.params);
    const acc = await requireAccess(db, req, cid, 'publisher');
    const address = await getAddress(cid, aid);
    if (!acc.isAdmin && address.created_by !== acc.user.id) throw forbidden('Só quem cadastrou ou um administrador pode editar.');
    const body = parse(addressBody.omit({ kind: true, units: true }), req.body);
    await db.query(`UPDATE addresses SET number=$3, street=$4, name=$5, notes=$6 WHERE id=$1 AND congregation_id=$2`, [
      aid, cid, body.number, body.street, address.kind === 'building' ? body.name : null, body.notes,
    ]);
    await audit(db, { actorId: acc.user.id, actorGlobal: acc.viaGlobal, congregationId: cid, action: 'address.update', entity: 'address', entityId: aid });
    return { ok: true };
  });

  app.delete('/congregations/:cid/addresses/:aid', async (req) => {
    const { cid, aid } = parse(PA, req.params);
    const acc = await requireAccess(db, req, cid, 'admin');
    const r = await db.query('DELETE FROM addresses WHERE id=$1 AND congregation_id=$2 RETURNING number, kind', [aid, cid]);
    if (!r.rowCount) throw notFound();
    await audit(db, { actorId: acc.user.id, actorGlobal: acc.viaGlobal, congregationId: cid, action: 'address.delete', entity: 'address', entityId: aid, details: r.rows[0] });
    return { ok: true };
  });

  // Inclusão de apartamentos em lote (a revisão é feita na interface antes de enviar)
  app.post('/congregations/:cid/addresses/:aid/units', async (req, reply) => {
    const { cid, aid } = parse(PA, req.params);
    const acc = await requireAccess(db, req, cid, 'publisher');
    const address = await getAddress(cid, aid);
    if (address.kind !== 'building') throw badRequest('Apartamentos só podem ser incluídos em prédios.');
    const body = parse(z.object({ units: unitList.min(1, 'Informe ao menos um apartamento.') }), req.body);
    const result = await withTx(db, (tx) => insertUnits(tx, cid, aid, body.units));
    await audit(db, { actorId: acc.user.id, actorGlobal: acc.viaGlobal, congregationId: cid, action: 'unit.create_bulk', entity: 'address', entityId: aid, details: { created: result.created } });
    return reply.status(201).send(result);
  });

  app.delete('/congregations/:cid/units/:uid', async (req) => {
    const { cid, uid } = parse(P.extend({ uid: uuid }), req.params);
    const acc = await requireAccess(db, req, cid, 'admin');
    const r = await db.query('DELETE FROM units WHERE id=$1 AND congregation_id=$2 RETURNING address_id', [uid, cid]);
    if (!r.rowCount) throw notFound();
    await audit(db, { actorId: acc.user.id, actorGlobal: acc.viaGlobal, congregationId: cid, action: 'unit.delete', entity: 'unit', entityId: uid });
    return { ok: true };
  });

  // ---------------- Registros de visita ----------------
  app.get('/congregations/:cid/addresses/:aid/records', async (req) => {
    const { cid, aid } = parse(PA, req.params);
    const q = parse(z.object({ unitId: uuid.optional() }), req.query);
    const acc = await requireAccess(db, req, cid, 'publisher');
    const address = await getAddress(cid, aid);
    if (address.kind === 'building' && !q.unitId) throw badRequest('Informe o apartamento.');
    const { rows } = await db.query(
      `SELECT v.id, v.action, v.occurred_on, v.note, v.created_at, v.voided_at, v.void_reason,
              v.author_id, u.name AS author_name
         FROM visit_records v LEFT JOIN users u ON u.id = v.author_id
        WHERE v.address_id = $1 AND v.congregation_id = $2 AND v.unit_id IS NOT DISTINCT FROM $3
        ORDER BY v.occurred_on DESC, v.created_at DESC`,
      [aid, cid, address.kind === 'building' ? q.unitId : null],
    );
    return {
      records: rows.map((r) => ({ ...r, canVoid: !r.voided_at && (acc.isAdmin || r.author_id === acc.user.id), author_id: undefined })),
    };
  });

  app.post('/congregations/:cid/addresses/:aid/records', async (req, reply) => {
    const { cid, aid } = parse(PA, req.params);
    const acc = await requireAccess(db, req, cid, 'publisher');
    const body = parse(
      z.object({
        unitId: uuid.optional().nullable(),
        action: z.enum(['contact', 'letter', 'absent'], { message: 'Escolha: contato, carta ou ausência.' }),
        occurredOn: isoDate,
        note: operationalNote(300),
      }),
      req.body,
    );
    const address = await getAddress(cid, aid);
    let unitId: string | null = null;
    if (address.kind === 'building') {
      if (!body.unitId) throw badRequest('Escolha o apartamento.');
      const u = await db.query('SELECT 1 FROM units WHERE id=$1 AND address_id=$2 AND congregation_id=$3', [body.unitId, aid, cid]);
      if (!u.rowCount) throw notFound();
      unitId = body.unitId;
    } else if (body.unitId) {
      throw badRequest('Casas não têm apartamentos.');
    }
    const { rows } = await db.query(
      `INSERT INTO visit_records(congregation_id, address_id, unit_id, action, occurred_on, note, author_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [cid, aid, unitId, body.action, body.occurredOn, body.note, acc.user.id],
    );
    await audit(db, { actorId: acc.user.id, actorGlobal: acc.viaGlobal, congregationId: cid, action: `record.${body.action}`, entity: 'visit_record', entityId: rows[0].id });
    const s = await db.query(
      `SELECT status, last_contact_on, last_letter_on, last_absent_on FROM target_status WHERE address_id = $1 AND unit_id IS NOT DISTINCT FROM $2`,
      [aid, unitId],
    );
    return reply.status(201).send({ id: rows[0].id, status: s.rows[0] });
  });

  // Anulação (correção de engano): o registro permanece no histórico, marcado como anulado.
  app.post('/congregations/:cid/records/:rid/void', async (req) => {
    const { cid, rid } = parse(P.extend({ rid: uuid }), req.params);
    const acc = await requireAccess(db, req, cid, 'publisher');
    const body = parse(z.object({ reason: z.string().trim().min(3, 'Informe o motivo.').max(200) }), req.body);
    const r = await db.query('SELECT author_id, voided_at FROM visit_records WHERE id=$1 AND congregation_id=$2', [rid, cid]);
    if (!r.rows[0]) throw notFound();
    if (r.rows[0].voided_at) throw conflict('Este registro já foi anulado.');
    if (!acc.isAdmin && r.rows[0].author_id !== acc.user.id) throw forbidden('Só o autor ou um administrador pode anular.');
    await db.query(`UPDATE visit_records SET voided_at = now(), voided_by = $3, void_reason = $4 WHERE id=$1 AND congregation_id=$2`, [
      rid, cid, acc.user.id, body.reason,
    ]);
    await audit(db, { actorId: acc.user.id, actorGlobal: acc.viaGlobal, congregationId: cid, action: 'record.void', entity: 'visit_record', entityId: rid });
    return { ok: true };
  });

  // Visão de prédios e cartas, com vínculo ao território e à quadra
  app.get('/congregations/:cid/buildings', async (req) => {
    const { cid } = parse(P, req.params);
    const q = parse(z.object({ onlyLetters: z.enum(['1', '0']).optional() }), req.query);
    await requireAccess(db, req, cid, 'publisher');
    const { rows } = await db.query(
      `SELECT a.id, a.number, a.street, a.name, b.id AS block_id, b.number AS block_number,
              t.id AS territory_id, t.number AS territory_number, s.pending, s.letter, s.contacted, s.total,
              COALESCE((
                SELECT json_agg(json_build_object('id', u.id, 'tower', u.tower, 'identifier', u.identifier, 'lastLetterOn', ts.last_letter_on)
                                ORDER BY u.tower, u.identifier)
                  FROM units u JOIN target_status ts ON ts.unit_id = u.id
                 WHERE u.address_id = a.id AND ts.status = 'letter'), '[]') AS letter_units
         FROM addresses a
         JOIN blocks b ON b.id = a.block_id
         JOIN territories t ON t.id = b.territory_id
         LEFT JOIN LATERAL (SELECT ${STATUS_COUNTS} FROM target_status ts WHERE ts.address_id = a.id) s ON true
        WHERE a.congregation_id = $1 AND a.kind = 'building'
        ORDER BY t.number, b.number, a.number`,
      [cid],
    );
    // Casas com carta pendente também aparecem no filtro de cartas.
    const houses = await db.query(
      `SELECT a.id, a.number, a.street, ts.last_letter_on, b.id AS block_id, b.number AS block_number, t.id AS territory_id, t.number AS territory_number
         FROM addresses a JOIN target_status ts ON ts.address_id = a.id AND ts.unit_id IS NULL
         JOIN blocks b ON b.id = a.block_id JOIN territories t ON t.id = b.territory_id
        WHERE a.congregation_id = $1 AND a.kind = 'house' AND ts.status = 'letter'
        ORDER BY t.number, b.number, a.number`,
      [cid],
    );
    const buildings = q.onlyLetters === '1' ? rows.filter((r) => r.letter > 0) : rows;
    return { buildings, letterHouses: houses.rows };
  });
}

async function insertUnits(tx: import('../lib/db.js').Tx, cid: string, aid: string, units: { tower: string; identifier: string }[]) {
  let created = 0;
  const skipped: string[] = [];
  const seen = new Set<string>();
  for (const u of units) {
    const key = `${u.tower.toLowerCase()}|${u.identifier.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const r = await tx.query(
      `INSERT INTO units(congregation_id, address_id, tower, identifier) VALUES ($1,$2,$3,$4)
       ON CONFLICT (address_id, tower, identifier) DO NOTHING`,
      [cid, aid, u.tower, u.identifier],
    );
    if (r.rowCount) created++;
    else skipped.push(u.tower ? `${u.tower} ${u.identifier}` : u.identifier);
  }
  return { created, skipped };
}
