/**
 * Configura o Administrador Geral por procedimento de servidor.
 *
 *   GLOBAL_ADMIN_EMAIL=... GLOBAL_ADMIN_NAME="..." npm run bootstrap:global-admin
 *
 * - Não existe senha fixa: é enviado um link de ativação (72 h) para definir a senha.
 * - Não há rota da API capaz de conceder este perfil.
 * - Nada sensível é impresso: o e-mail aparece mascarado e o link não é exibido.
 */
import { loadConfig } from '../config.js';
import { audit } from '../lib/audit.js';
import { createPool, withTx } from '../lib/db.js';
import { createMailer, templates } from '../lib/mail.js';
import { migrate } from '../lib/migrate.js';
import { createEmailToken } from '../routes/auth.js';
import { email as emailSchema, personName } from '../lib/validate.js';

const cfg = loadConfig();
const email = emailSchema.parse(process.env.GLOBAL_ADMIN_EMAIL ?? '');
const name = personName.parse(process.env.GLOBAL_ADMIN_NAME ?? '');
const mask = (e: string) => e.replace(/^(.).*?(@.*)$/, '$1***$2');

const db = createPool(cfg.DATABASE_URL);
await migrate(db);
const { url, created, hasPassword } = await withTx(db, async (tx) => {
  const found = await tx.query('SELECT id, password_hash FROM users WHERE email = $1 AND deleted_at IS NULL', [email]);
  let id: string;
  let created = false;
  if (found.rows[0]) {
    id = found.rows[0].id;
    await tx.query('UPDATE users SET is_global_admin = true WHERE id = $1', [id]);
  } else {
    const r = await tx.query(
      `INSERT INTO users(name, email, signup_intent, is_global_admin) VALUES ($1,$2,'admin',true) RETURNING id`,
      [name, email],
    );
    id = r.rows[0].id;
    created = true;
  }
  await audit(tx, { actorId: null, action: 'global.bootstrap', entity: 'user', entityId: id, details: { created } });
  const hasPassword = Boolean(found.rows[0]?.password_hash);
  const url = hasPassword ? null : await createEmailToken(tx, cfg.APP_ORIGIN, id, 'activate');
  return { url, created, hasPassword };
});

if (url) {
  await createMailer(cfg).send({ to: email, ...templates.activate(name, url) });
  console.log(`Administrador Geral ${created ? 'criado' : 'atualizado'}. Link de ativação enviado para ${mask(email)}.`);
} else if (hasPassword) {
  console.log(`Perfil de Administrador Geral confirmado para ${mask(email)} (a conta já tem senha).`);
}
await db.end();
