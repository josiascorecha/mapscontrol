import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatório'),
  APP_ORIGIN: z.string().url().default('http://localhost:3000'),
  // Endereços antigos que continuam aceitos durante uma mudança de domínio
  // (lista separada por vírgula). Ex.: https://mapscontrol.dominio-antigo.com.br
  EXTRA_ORIGINS: z.string().default(''),
  // Data (AAAA-MM-DD) a partir da qual o endereço antigo passa a redirecionar.
  // Só é usada no aviso mostrado a quem ainda acessa pelo endereço antigo.
  ADDRESS_CHANGE_DATE: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'use o formato AAAA-MM-DD')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  TRUST_PROXY: bool.default(false),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  // Segredo usado no HMAC dos códigos de acesso e na chave de limitação por IP.
  CODE_PEPPER: z.string().min(32, 'CODE_PEPPER deve ter ao menos 32 caracteres'),
  MAIL_TRANSPORT: z.enum(['smtp', 'file', 'memory']).default('file'),
  MAIL_FROM: z.string().default('MapsControl <nao-responda@example.com>'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: bool.default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FILE_DIR: z.string().default('.dev-mail'),
  TERMS_VERSION: z.string().default('2026-09-26'),
  PRIVACY_VERSION: z.string().default('2026-09-26'),
  TILE_URL: z.string().default('https://tile.openstreetmap.org/{z}/{x}/{y}.png'),
  TILE_ATTRIBUTION: z
    .string()
    .default('&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'),
  AUDIT_RETENTION_DAYS: z.coerce.number().int().min(30).default(730),
  STATIC_DIR: z.string().optional(),
  ANDROID_PACKAGE: z.string().optional(),
  ANDROID_CERT_SHA256: z.string().optional(), // lista separada por vírgula
  CONTACT_EMAIL: z.string().default('contato@example.com'),
  LOG_LEVEL: z.string().default('info'),
});

export type Config = z.infer<typeof schema> & {
  cookieSecure: boolean;
  cookieName: string;
  /** APP_ORIGIN seguido dos EXTRA_ORIGINS, sem barra no final. */
  allowedOrigins: string[];
};

const stripSlash = (o: string) => o.replace(/\/+$/, '');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuração inválida: ${msg}`);
  }
  const c = parsed.data;
  const appOrigin = stripSlash(c.APP_ORIGIN);
  const extra = c.EXTRA_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean)
    .map((o) => {
      let u: URL;
      try {
        u = new URL(o);
      } catch {
        throw new Error(`Configuração inválida: EXTRA_ORIGINS contém um endereço inválido (${o})`);
      }
      if (u.pathname !== '/' || u.search || u.hash) {
        throw new Error(`Configuração inválida: EXTRA_ORIGINS deve ter só a origem, sem caminho (${o})`);
      }
      return u.origin;
    });
  if (c.NODE_ENV === 'production') {
    if (c.MAIL_TRANSPORT !== 'smtp') throw new Error('Em produção MAIL_TRANSPORT deve ser smtp');
    if (!c.APP_ORIGIN.startsWith('https://')) throw new Error('Em produção APP_ORIGIN deve usar https');
    if (!c.SMTP_HOST) throw new Error('SMTP_HOST é obrigatório em produção');
    if (extra.some((o) => !o.startsWith('https://'))) throw new Error('Em produção EXTRA_ORIGINS deve usar https');
  }
  const cookieSecure = c.APP_ORIGIN.startsWith('https://');
  return {
    ...c,
    APP_ORIGIN: appOrigin,
    allowedOrigins: [appOrigin, ...extra.filter((o) => o !== appOrigin)],
    cookieSecure,
    // Prefixo __Host- exige Secure, Path=/ e ausência de Domain: impede
    // que subdomínios vizinhos sobrescrevam o cookie de sessão.
    cookieName: cookieSecure ? '__Host-mcs' : 'mcs',
  };
}
