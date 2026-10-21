import type { Queryable } from './db.js';
import { forbidden } from './errors.js';

/**
 * Regras de exclusão para publicadores (administradores excluem tudo):
 *
 * - território ou quadra: só quem cadastrou, enquanto não foi confirmado por um
 *   administrador, e desde que não haja nada de outras pessoas dentro (quadras,
 *   endereços ou visitas). Depois de confirmado, publicadores só editam;
 * - casa ou prédio: quem cadastrou, desde que não haja visitas de outras pessoas;
 * - apartamento: quem cadastrou o prédio, desde que não haja visitas de outras pessoas.
 *
 * As funções `*Sql` devolvem uma expressão booleana para usar em SELECTs (para a
 * interface saber se mostra o botão "Excluir"); as `assert*` aplicam a regra na hora.
 * `u` é o placeholder do id do usuário (ex.: '$3').
 */

const othersInBlock = (b: string, u: string) => `(
  EXISTS (SELECT 1 FROM addresses xa WHERE xa.block_id = ${b} AND xa.created_by IS DISTINCT FROM ${u})
  OR EXISTS (SELECT 1 FROM visit_records xv JOIN addresses xa ON xa.id = xv.address_id
              WHERE xa.block_id = ${b} AND xv.voided_at IS NULL AND xv.author_id IS DISTINCT FROM ${u}))`;

const othersInTerritory = (t: string, u: string) => `(
  EXISTS (SELECT 1 FROM blocks xb WHERE xb.territory_id = ${t}
           AND (xb.created_by IS DISTINCT FROM ${u} OR xb.confirmed_at IS NOT NULL))
  OR EXISTS (SELECT 1 FROM addresses xa JOIN blocks xb ON xb.id = xa.block_id
              WHERE xb.territory_id = ${t} AND xa.created_by IS DISTINCT FROM ${u})
  OR EXISTS (SELECT 1 FROM visit_records xv JOIN addresses xa ON xa.id = xv.address_id JOIN blocks xb ON xb.id = xa.block_id
              WHERE xb.territory_id = ${t} AND xv.voided_at IS NULL AND xv.author_id IS DISTINCT FROM ${u}))`;

const othersOnAddress = (a: string, u: string) =>
  `EXISTS (SELECT 1 FROM visit_records xv WHERE xv.address_id = ${a} AND xv.voided_at IS NULL AND xv.author_id IS DISTINCT FROM ${u})`;

const othersOnUnit = (unit: string, u: string) =>
  `EXISTS (SELECT 1 FROM visit_records xv WHERE xv.unit_id = ${unit} AND xv.voided_at IS NULL AND xv.author_id IS DISTINCT FROM ${u})`;

export const territoryOwnDeletableSql = (t: string, u: string) =>
  `(${t}.created_by = ${u} AND ${t}.confirmed_at IS NULL AND NOT ${othersInTerritory(`${t}.id`, u)})`;

export const blockOwnDeletableSql = (b: string, u: string) =>
  `(${b}.created_by = ${u} AND ${b}.confirmed_at IS NULL AND NOT ${othersInBlock(`${b}.id`, u)})`;

export const addressOwnDeletableSql = (a: string, u: string) => `(${a}.created_by = ${u} AND NOT ${othersOnAddress(`${a}.id`, u)})`;

/** `a` é o endereço (prédio) do apartamento `unit`. */
export const unitOwnDeletableSql = (unit: string, a: string, u: string) => `(${a}.created_by = ${u} AND NOT ${othersOnUnit(`${unit}.id`, u)})`;

interface Check {
  mine: boolean;
  confirmed?: boolean;
  others: boolean;
}

function explain(kind: 'territory' | 'block' | 'address' | 'unit', c: Check): never {
  const what = { territory: 'este território', block: 'esta quadra', address: 'este endereço', unit: 'este apartamento' }[kind];
  if (!c.mine) {
    throw forbidden(
      kind === 'unit'
        ? 'Só quem cadastrou o prédio ou um administrador pode excluir apartamentos.'
        : `Só quem cadastrou ${what} ou um administrador pode excluir.`,
      'NOT_OWNER',
    );
  }
  if (c.confirmed) {
    throw forbidden(
      `${what[0].toUpperCase()}${what.slice(1)} já foi confirmad${kind === 'territory' ? 'o' : 'a'} por um administrador. Você pode editar, mas só um administrador pode excluir.`,
      'CONFIRMED',
    );
  }
  throw forbidden(
    kind === 'territory' || kind === 'block'
      ? `Há endereços ou visitas de outras pessoas em ${what}. Peça a um administrador para excluir.`
      : `Há visitas registradas por outras pessoas em ${what}. Peça a um administrador para excluir.`,
    'HAS_OTHERS',
  );
}

export async function assertCanDeleteTerritory(db: Queryable, tid: string, userId: string): Promise<void> {
  const { rows } = await db.query(
    `SELECT t.created_by = $2 AS mine, t.confirmed_at IS NOT NULL AS confirmed, ${othersInTerritory('t.id', '$2')} AS others
       FROM territories t WHERE t.id = $1`,
    [tid, userId],
  );
  const c = rows[0] as Check | undefined;
  if (c && (!c.mine || c.confirmed || c.others)) explain('territory', c);
}

export async function assertCanDeleteBlock(db: Queryable, bid: string, userId: string): Promise<void> {
  const { rows } = await db.query(
    `SELECT b.created_by = $2 AS mine, b.confirmed_at IS NOT NULL AS confirmed, ${othersInBlock('b.id', '$2')} AS others
       FROM blocks b WHERE b.id = $1`,
    [bid, userId],
  );
  const c = rows[0] as Check | undefined;
  if (c && (!c.mine || c.confirmed || c.others)) explain('block', c);
}

export async function assertCanDeleteAddress(db: Queryable, aid: string, userId: string): Promise<void> {
  const { rows } = await db.query(
    `SELECT a.created_by = $2 AS mine, ${othersOnAddress('a.id', '$2')} AS others FROM addresses a WHERE a.id = $1`,
    [aid, userId],
  );
  const c = rows[0] as Check | undefined;
  if (c && (!c.mine || c.others)) explain('address', c);
}

export async function assertCanDeleteUnit(db: Queryable, uid: string, userId: string): Promise<void> {
  const { rows } = await db.query(
    `SELECT a.created_by = $2 AS mine, ${othersOnUnit('u.id', '$2')} AS others
       FROM units u JOIN addresses a ON a.id = u.address_id WHERE u.id = $1`,
    [uid, userId],
  );
  const c = rows[0] as Check | undefined;
  if (c && (!c.mine || c.others)) explain('unit', c);
}
