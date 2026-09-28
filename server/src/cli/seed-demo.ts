/**
 * Dados FICTÍCIOS para desenvolvimento, demonstração e capturas de tela.
 * Recusa rodar em produção. Senha dos usuários de demonstração: DEMO_PASSWORD.
 */
import { loadConfig } from '../config.js';
import { createPool, withTx } from '../lib/db.js';
import { migrate } from '../lib/migrate.js';
import { hashPassword } from '../lib/security.js';

const cfg = loadConfig();
if (cfg.NODE_ENV === 'production') {
  console.error('seed-demo não pode rodar em produção.');
  process.exit(1);
}
const pw = process.env.DEMO_PASSWORD;
if (!pw || pw.length < 6) {
  console.error('Defina DEMO_PASSWORD (mín. 6 caracteres, com letras e números) para os usuários de demonstração.');
  process.exit(1);
}
const db = createPool(cfg.DATABASE_URL);
await migrate(db);
const hash = await hashPassword(pw);

// Coordenadas genéricas de uma área central fictícia (não correspondem a territórios reais).
const BASE = { lat: -25.4284, lng: -49.2733 };

await withTx(db, async (tx) => {
  const exists = await tx.query(`SELECT 1 FROM users WHERE email = 'admin@exemplo.test'`);
  if (exists.rowCount) {
    console.log('Dados de demonstração já existem.');
    return;
  }
  const mkUser = async (name: string, email: string, intent: string) => {
    const r = await tx.query(
      `INSERT INTO users(name, email, password_hash, email_verified_at, signup_intent) VALUES ($1,$2,$3,now(),$4) RETURNING id`,
      [name, email, hash, intent],
    );
    await tx.query(`INSERT INTO consents(user_id, document, version) VALUES ($1,'terms',$2),($1,'privacy',$3)`, [r.rows[0].id, cfg.TERMS_VERSION, cfg.PRIVACY_VERSION]);
    return r.rows[0].id as string;
  };
  const admin = await mkUser('Ana Exemplo', 'admin@exemplo.test', 'admin');
  const pub = await mkUser('Bruno Exemplo', 'publicador@exemplo.test', 'publisher');
  const c = await tx.query(`INSERT INTO congregations(name, city, state, created_by) VALUES ('Congregação Exemplo', 'Cidade Fictícia', 'PR', $1) RETURNING id`, [admin]);
  const cid = c.rows[0].id;
  await tx.query(`INSERT INTO memberships(user_id, congregation_id, role) VALUES ($1,$3,'admin'), ($2,$3,'publisher')`, [admin, pub, cid]);

  for (let tn = 1; tn <= 2; tn++) {
    const t = await tx.query(`INSERT INTO territories(congregation_id, number, name) VALUES ($1,$2,$3) RETURNING id`, [cid, tn, `Setor ${tn === 1 ? 'Norte' : 'Sul'}`]);
    for (let bn = 1; bn <= (tn === 1 ? 6 : 4); bn++) {
      const lat = BASE.lat + (tn - 1) * -0.006 + Math.floor((bn - 1) / 3) * -0.0022;
      const lng = BASE.lng + ((bn - 1) % 3) * 0.0028;
      const b = await tx.query(
        `INSERT INTO blocks(congregation_id, territory_id, number, lat, lng) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [cid, t.rows[0].id, bn, lat, lng],
      );
      const bid = b.rows[0].id;
      for (let h = 0; h < 8; h++) {
        const num = String(100 + h * 12);
        const a = await tx.query(
          `INSERT INTO addresses(congregation_id, block_id, kind, number, street, created_by) VALUES ($1,$2,'house',$3,'Rua das Flores',$4) RETURNING id`,
          [cid, bid, num, pub],
        );
        const pick = (h + bn + tn) % 4;
        if (pick === 1) await rec(tx, cid, a.rows[0].id, null, 'contact', 5 + h, pub);
        if (pick === 2) await rec(tx, cid, a.rows[0].id, null, 'letter', 3 + h, pub);
        if (pick === 3) await rec(tx, cid, a.rows[0].id, null, 'absent', 2, pub);
      }
      if (bn === 2) {
        const a = await tx.query(
          `INSERT INTO addresses(congregation_id, block_id, kind, number, street, name, created_by) VALUES ($1,$2,'building','450','Av. Central','Edifício Horizonte',$3) RETURNING id`,
          [cid, bid, pub],
        );
        for (let andar = 1; andar <= 4; andar++) {
          for (let ap = 1; ap <= 4; ap++) {
            const u = await tx.query(
              `INSERT INTO units(congregation_id, address_id, tower, identifier) VALUES ($1,$2,'',$3) RETURNING id`,
              [cid, a.rows[0].id, `${andar}0${ap}`],
            );
            const pick = (andar + ap) % 3;
            if (pick === 0) await rec(tx, cid, a.rows[0].id, u.rows[0].id, 'letter', andar + ap, pub);
            if (pick === 1) await rec(tx, cid, a.rows[0].id, u.rows[0].id, 'contact', ap, admin);
          }
        }
      }
    }
  }
  console.log('Dados fictícios criados: admin@exemplo.test e publicador@exemplo.test (senha = DEMO_PASSWORD).');
});
await db.end();

async function rec(tx: import('../lib/db.js').Tx, cid: string, aid: string, uid: string | null, action: string, daysAgo: number, author: string) {
  await tx.query(
    `INSERT INTO visit_records(congregation_id, address_id, unit_id, action, occurred_on, author_id) VALUES ($1,$2,$3,$4, current_date - $5::int, $6)`,
    [cid, aid, uid, action, daysAgo, author],
  );
}
