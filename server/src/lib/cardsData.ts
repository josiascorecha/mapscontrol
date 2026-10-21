import type { Queryable } from './db.js';
import type { CardBlock } from './cardsPdf.js';

/** Dados das fichas para recorte: endereços na ordem de cadastro, data e quem trabalhou a quadra. */

/** Nome curto para o campo PUBLICADORES: primeiro nome; com inicial do sobrenome se repetir. */
export function shortNames(names: string[]): string[] {
  const parts = names.map((n) => n.trim().split(/\s+/));
  const firsts = parts.map((p) => p[0]);
  return parts.map((p, i) => {
    const dup = firsts.filter((f) => f.toLowerCase() === firsts[i].toLowerCase()).length > 1;
    return dup && p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : p[0];
  });
}

export async function loadCardBlocks(db: Queryable, cid: string, blockIds: string[]): Promise<CardBlock[]> {
  if (!blockIds.length) return [];
  const blocks = await db.query(
    `SELECT b.id, b.number, t.number AS territory_number FROM blocks b JOIN territories t ON t.id = b.territory_id
      WHERE b.id = ANY($1::uuid[]) AND b.congregation_id = $2 ORDER BY t.number, b.number`,
    [blockIds, cid],
  );
  // Data na ficha: a da conversa (contato) ou, se só houve carta, a da carta. Pendente fica em branco.
  const houses = await db.query(
    `SELECT a.block_id, a.id, a.kind, a.number, hs.status, hs.last_contact_on, hs.last_letter_on
       FROM addresses a LEFT JOIN target_status hs ON hs.address_id = a.id AND hs.unit_id IS NULL AND a.kind = 'house'
      WHERE a.block_id = ANY($1::uuid[]) AND a.congregation_id = $2 ORDER BY a.seq`,
    [blockIds, cid],
  );
  const units = await db.query(
    `SELECT u.address_id, u.tower, u.identifier, ts.status, ts.last_contact_on, ts.last_letter_on
       FROM units u JOIN addresses a ON a.id = u.address_id JOIN target_status ts ON ts.unit_id = u.id
      WHERE a.block_id = ANY($1::uuid[]) AND a.congregation_id = $2 ORDER BY u.seq`,
    [blockIds, cid],
  );
  const pubs = await db.query(
    `SELECT a.block_id, u.name, min(v.created_at) AS first_at
       FROM visit_records v JOIN addresses a ON a.id = v.address_id JOIN users u ON u.id = v.author_id
      WHERE a.block_id = ANY($1::uuid[]) AND v.congregation_id = $2 AND v.voided_at IS NULL AND u.deleted_at IS NULL
      GROUP BY a.block_id, u.id, u.name ORDER BY first_at`,
    [blockIds, cid],
  );
  const dateOf = (r: { status: string | null; last_contact_on: string | null; last_letter_on: string | null }) =>
    r.status === 'contacted' ? r.last_contact_on : r.status === 'letter' ? r.last_letter_on : null;
  return blocks.rows.map((b) => {
    const entries: CardBlock['entries'] = [];
    for (const a of houses.rows.filter((h) => h.block_id === b.id)) {
      if (a.kind === 'house') entries.push({ label: a.number, date: dateOf(a) });
      else {
        for (const u of units.rows.filter((x) => x.address_id === a.id)) {
          entries.push({ label: `${a.number}/${u.tower ? `${u.tower}-` : ''}${u.identifier}`, date: dateOf(u) });
        }
      }
    }
    const names = pubs.rows.filter((p) => p.block_id === b.id).map((p) => p.name as string);
    return { territoryNumber: b.territory_number, blockNumber: b.number, publishers: shortNames(names), entries };
  });
}

