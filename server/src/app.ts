import { existsSync } from 'node:fs';
import path from 'node:path';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import type { Db } from './lib/db.js';
import { HttpError } from './lib/errors.js';
import { createMailer, type Mailer } from './lib/mail.js';
import { defaultFetcher, type Fetcher } from './lib/maps.js';
import { loadSession } from './lib/session.js';
import { authRoutes } from './routes/auth.js';
import { congregationRoutes } from './routes/congregations.js';
import { fieldRoutes } from './routes/field.js';
import { adminRoutes } from './routes/admin.js';
import { globalRoutes } from './routes/global.js';

export interface Deps {
  cfg: Config;
  db: Db;
  mailer: Mailer;
  fetcher: Fetcher;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: Deps;
  }
}

// Campos que nunca devem aparecer em logs.
const REDACT = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  'body.password',
  'body.token',
  'body.code',
];

export async function buildApp(cfg: Config, db: Db, opts: { mailer?: Mailer; fetcher?: Fetcher; logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: cfg.TRUST_PROXY,
    bodyLimit: 64 * 1024,
    logger:
      opts.logger === false
        ? false
        : {
            level: cfg.LOG_LEVEL,
            redact: { paths: REDACT, censor: '[omitido]' },
            serializers: {
              // Registra só método e rota, sem query string (tokens podem vir na URL).
              req: (r) => ({ method: r.method, url: String(r.url).split('?')[0] }),
            },
          },
  });

  app.decorate('deps', {
    cfg,
    db,
    mailer: opts.mailer ?? createMailer(cfg),
    fetcher: opts.fetcher ?? defaultFetcher,
  });
  app.decorateRequest('user', null);

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // Leaflet aplica estilos inline em marcadores
        imgSrc: ["'self'", 'data:', ...tileHosts(cfg.TILE_URL)],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: cfg.cookieSecure ? [] : null,
      },
    },
    hsts: cfg.cookieSecure ? { maxAge: 31536000, includeSubDomains: false } : false,
    crossOriginEmbedderPolicy: false,
    // O servidor de mapas do OpenStreetMap bloqueia (403) requisições sem Referer.
    // Envia só a origem (https://dominio), nunca o caminho da página.
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });

  // Proteção CSRF: toda requisição que altera dados precisa vir da própria origem.
  app.addHook('onRequest', async (req) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
    if (!req.url.startsWith('/api/')) return;
    const origin = req.headers.origin;
    if (origin !== cfg.APP_ORIGIN) {
      throw new HttpError(403, 'BAD_ORIGIN', 'Origem da requisição não permitida.');
    }
  });

  app.addHook('preHandler', async (req) => {
    if (req.url.startsWith('/api/')) req.user = await loadSession(db, cfg, req);
  });

  app.addHook('onSend', async (req, reply) => {
    if (req.url.startsWith('/api/')) reply.header('cache-control', 'no-store');
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.status).send({ error: err.code, message: err.message });
    }
    const e = err as { statusCode?: number; code?: string; message: string };
    if (e.code === '23505') {
      return reply.status(409).send({ error: 'DUPLICATE', message: 'Já existe um registro com esse número.' });
    }
    if (e.code === '23514' || e.code === '22P02') {
      return reply.status(400).send({ error: 'VALIDATION', message: 'Dados inválidos.' });
    }
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      return reply.status(e.statusCode).send({ error: 'BAD_REQUEST', message: 'Requisição inválida.' });
    }
    req.log.error({ err: { message: e.message, code: e.code } }, 'erro interno');
    return reply.status(500).send({ error: 'INTERNAL', message: 'Erro interno. Tente novamente.' });
  });

  app.get('/api/health', async () => {
    await db.query('SELECT 1');
    return { ok: true };
  });

  app.get('/api/config', async () => ({
    termsVersion: cfg.TERMS_VERSION,
    privacyVersion: cfg.PRIVACY_VERSION,
    tileUrl: cfg.TILE_URL,
    tileAttribution: cfg.TILE_ATTRIBUTION,
    contactEmail: cfg.CONTACT_EMAIL,
  }));

  // Digital Asset Links para o aplicativo Android (TWA).
  app.get('/.well-known/assetlinks.json', async (_req, reply) => {
    if (!cfg.ANDROID_PACKAGE || !cfg.ANDROID_CERT_SHA256) return reply.status(404).send([]);
    return [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: cfg.ANDROID_PACKAGE,
          sha256_cert_fingerprints: cfg.ANDROID_CERT_SHA256.split(',').map((s) => s.trim()),
        },
      },
    ];
  });

  await app.register(authRoutes, { prefix: '/api' });
  await app.register(congregationRoutes, { prefix: '/api' });
  await app.register(fieldRoutes, { prefix: '/api' });
  await app.register(adminRoutes, { prefix: '/api' });
  await app.register(globalRoutes, { prefix: '/api' });

  app.all('/api/*', async (_req, reply) => reply.status(404).send({ error: 'NOT_FOUND', message: 'Não encontrado.' }));

  // Interface web (SPA) servida pelo mesmo processo: web e Android usam a mesma origem.
  const staticDir = cfg.STATIC_DIR ? path.resolve(cfg.STATIC_DIR) : null;
  if (staticDir && existsSync(staticDir)) {
    await app.register(fastifyStatic, {
      root: staticDir,
      wildcard: true,
      setHeaders(res, filePath) {
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.header('cache-control', 'public, max-age=31536000, immutable');
        } else {
          res.header('cache-control', 'no-cache');
        }
      },
    });
    app.setNotFoundHandler((req, reply) => {
      // Rotas da SPA recebem index.html; arquivos inexistentes (.js, .png…) recebem 404.
      const pathOnly = req.url.split('?')[0];
      if (req.method === 'GET' && !pathOnly.startsWith('/api/') && !/\.[a-z0-9]{2,5}$/i.test(pathOnly)) {
        return reply.header('cache-control', 'no-cache').sendFile('index.html');
      }
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Não encontrado.' });
    });
  }

  return app;
}

function tileHosts(tileUrl: string): string[] {
  try {
    const u = new URL(tileUrl.replace(/\{s\}/g, 'a').replace(/\{[a-z]\}/g, '0'));
    return [`${u.protocol}//${u.host}`];
  } catch {
    return [];
  }
}
