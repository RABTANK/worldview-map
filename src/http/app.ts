import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import fastifyStatic from '@fastify/static';
import { AppError } from '../domain/errors.js';
import { hasScope } from '../domain/auth.js';
import { RateLimiter } from '../domain/rate-limit.js';
import type { Actor, Scope } from '../shared/types.js';
import type { Runtime } from '../runtime.js';
import { openapi } from './openapi.js';
import {
  createKeySchema,
  createPlaceSchema,
  createRegionSchema,
  floorBodySchema,
  parseBody,
  patchFloorSchema,
  patchPlaceSchema,
  patchRegionSchema,
  rollbackSchema,
  setTilesSchema,
  snapshotSchema,
} from './schemas.js';

const require = createRequire(import.meta.url);
const swaggerDist = path.dirname(require.resolve('swagger-ui-dist/package.json'));
const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor;
  }
}

const DOCS_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>世界观地图 API</title>
  <link rel="stylesheet" href="/docs/assets/swagger-ui.css" />
</head>
<body>
  <div id="swagger"></div>
  <script src="/docs/assets/swagger-ui-bundle.js"></script>
  <script src="/docs/init.js"></script>
</body>
</html>`;

function pathnameOf(url: string): string {
  return url.split('?')[0] ?? url;
}

function isPublic(url: string): boolean {
  const pathname = pathnameOf(url);
  if (pathname === '/health' || pathname === '/api/openapi.json') return true;
  if (pathname === '/docs' || pathname.startsWith('/docs/')) return true;
  return !pathname.startsWith('/api');
}

function requiredScope(method: string, url: string): Scope {
  const pathname = pathnameOf(url);
  if (pathname === '/api/keys' || pathname.startsWith('/api/keys/') || pathname.endsWith('/rollback')) return 'admin';
  if (method === 'DELETE') return 'delete';
  if (method === 'POST' || method === 'PUT' || method === 'PATCH') return 'write';
  return 'read';
}

function queryFlag(value: unknown): boolean {
  return value === true || value === 'true' || value === '1';
}

function num(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export type AppOptions = {
  runtime: Runtime;
  rateLimitPerMin?: number;
  serveStatic?: boolean;
};

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const { world, keys } = options.runtime;
  const limiter = new RateLimiter(options.rateLimitPerMin ?? options.runtime.config.rateLimitPerMin, 60_000);
  const app = Fastify({
    logger: process.env.NODE_ENV === 'test' ? false : { level: process.env.LOG_LEVEL ?? 'info' },
    bodyLimit: 5 * 1024 * 1024,
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.status).send({ error: { code: error.code, message: error.message } });
    }
    request.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send({ error: { code: 'INTERNAL', message: '服务器内部错误' } });
  });

  app.setNotFoundHandler((request, reply) => {
    const pathname = pathnameOf(request.url);
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: `找不到 ${request.method} ${pathname}` } });
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('cache-control', 'no-store');
  });

  app.addHook('preHandler', async (request, reply) => {
    if (isPublic(request.url)) return;
    const header = request.headers.authorization;
    const bearer = typeof header === 'string' && header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
    const alt = request.headers['x-api-key'];
    const token = bearer || (typeof alt === 'string' ? alt.trim() : '');
    const actor = token ? keys.authenticate(token) : null;
    if (!actor || !actor.keyId) {
      const ipLimit = limiter.hit(`ip:${request.ip}`);
      if (!ipLimit.ok) {
        reply.header('retry-after', String(ipLimit.retryAfterSec));
        throw new AppError(429, 'RATE_LIMITED', '请求过于频繁');
      }
      throw new AppError(401, 'UNAUTHORIZED', '缺少或无效的 API Key');
    }
    const limit = limiter.hit(actor.keyId);
    if (!limit.ok) {
      reply.header('retry-after', String(limit.retryAfterSec));
      throw new AppError(429, 'RATE_LIMITED', '请求过于频繁');
    }
    const scope = requiredScope(request.method, request.url);
    if (!hasScope(actor, scope)) {
      throw new AppError(403, 'FORBIDDEN', `权限不足，需要 ${scope}`);
    }
    request.actor = actor;
  });

  await app.register(cors, { origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/] });
  await app.register(helmet, { contentSecurityPolicy: false, crossOriginEmbedderPolicy: false });

  app.get('/health', async () => ({ ok: true, service: 'worldview-map', version: '3.0.0' }));
  app.get('/api/openapi.json', async () => openapi);
  app.get('/docs', async (_request, reply) => reply.type('text/html; charset=utf-8').send(DOCS_HTML));
  app.get('/docs/init.js', async (_request, reply) => {
    reply.type('application/javascript');
    return "window.ui = SwaggerUIBundle({ url: '/api/openapi.json', dom_id: '#swagger' });";
  });

  app.get('/api/me', async (request) => ({
    id: request.actor.keyId,
    name: request.actor.name,
    scopes: request.actor.scopes,
  }));

  app.get('/api/map/view', async (request) => {
    const query = request.query as { regionId?: string; floorId?: string };
    const regionId = query.regionId || null;
    return world.getView(regionId, query.floorId || null);
  });

  app.get('/api/regions', async (request) => {
    const query = request.query as { parentId?: string; all?: string };
    if (queryFlag(query.all)) return { regions: world.listRegions() };
    return { regions: world.listChildren(query.parentId || null) };
  });

  app.post('/api/regions', async (request, reply) => {
    const body = parseBody(createRegionSchema, request.body);
    const region = world.createRegion(body, request.actor);
    return reply.status(201).send(region);
  });

  app.get('/api/regions/:id', async (request) => world.getRegion((request.params as { id: string }).id));

  app.patch('/api/regions/:id', async (request) => {
    const body = parseBody(patchRegionSchema, request.body);
    return world.updateRegion((request.params as { id: string }).id, body, request.actor);
  });

  app.delete('/api/regions/:id', async (request) => {
    const query = request.query as { confirm?: string; cascade?: string };
    return world.deleteRegion(
      (request.params as { id: string }).id,
      { confirm: queryFlag(query.confirm), cascade: queryFlag(query.cascade) },
      request.actor,
    );
  });

  app.get('/api/regions/:id/children', async (request) => ({
    regions: world.listChildren((request.params as { id: string }).id),
  }));

  app.get('/api/regions/:id/context', async (request) => {
    const params = request.params as { id: string };
    const query = request.query as { floorId?: string };
    return world.getView(params.id, query.floorId || null);
  });

  app.get('/api/places', async (request) => {
    const query = request.query as Record<string, string | undefined>;
    const minX = num(query.minX);
    const minY = num(query.minY);
    const maxX = num(query.maxX);
    const maxY = num(query.maxY);
    for (const value of [minX, minY, maxX, maxY]) {
      if (Number.isNaN(value)) throw new AppError(400, 'VALIDATION', '范围坐标必须是数字');
    }
    return {
      places: world.listPlaces({
        regionId: query.regionId || undefined,
        q: query.q,
        minX,
        minY,
        maxX,
        maxY,
      }),
    };
  });

  app.post('/api/places', async (request, reply) => {
    const body = parseBody(createPlaceSchema, request.body);
    return reply.status(201).send(world.createPlace(body, request.actor));
  });

  app.get('/api/places/:id', async (request) => world.getPlace((request.params as { id: string }).id));

  app.patch('/api/places/:id', async (request) => {
    const body = parseBody(patchPlaceSchema, request.body);
    return world.updatePlace((request.params as { id: string }).id, body, request.actor);
  });

  app.delete('/api/places/:id', async (request) => {
    const query = request.query as { confirm?: string };
    world.deletePlace((request.params as { id: string }).id, queryFlag(query.confirm), request.actor);
    return { ok: true };
  });

  app.get('/api/search', async (request) => {
    const query = request.query as { q?: string };
    return world.search(query.q ?? '');
  });

  app.get('/api/buildings/:id/floors', async (request) => ({
    floors: world.listFloors((request.params as { id: string }).id),
  }));

  app.post('/api/buildings/:id/floors', async (request, reply) => {
    const params = request.params as { id: string };
    const body = parseBody(floorBodySchema, request.body);
    return reply.status(201).send(world.createFloor({ ...body, regionId: params.id }, request.actor));
  });

  app.get('/api/floors/:id', async (request) => world.getFloor((request.params as { id: string }).id));

  app.patch('/api/floors/:id', async (request) => {
    const body = parseBody(patchFloorSchema, request.body);
    return world.updateFloor((request.params as { id: string }).id, body, request.actor);
  });

  app.delete('/api/floors/:id', async (request) => {
    const query = request.query as { confirm?: string };
    world.deleteFloor((request.params as { id: string }).id, queryFlag(query.confirm), request.actor);
    return { ok: true };
  });

  app.put('/api/floors/:id/tiles', async (request) => {
    const body = parseBody(setTilesSchema, request.body);
    return world.setTiles((request.params as { id: string }).id, body.tiles, request.actor);
  });

  app.get('/api/snapshots', async () => ({ snapshots: world.listSnapshots() }));

  app.post('/api/snapshots', async (request, reply) => {
    const body = parseBody(snapshotSchema, request.body);
    return reply.status(201).send(world.createSnapshot(request.actor, body.label, 'manual'));
  });

  app.get('/api/snapshots/:id', async (request) => world.getSnapshot((request.params as { id: string }).id));

  app.post('/api/snapshots/:id/rollback', async (request) => {
    const body = parseBody(rollbackSchema, request.body ?? {});
    return world.rollback((request.params as { id: string }).id, body.confirm, request.actor);
  });

  app.get('/api/logs', async (request) => {
    const query = request.query as { limit?: string };
    const limit = query.limit ? Number(query.limit) : 50;
    if (!Number.isFinite(limit)) throw new AppError(400, 'VALIDATION', 'limit 必须是数字');
    return { logs: world.listLogs(limit) };
  });

  app.get('/api/keys', async () => ({ keys: keys.list() }));

  app.post('/api/keys', async (request, reply) => {
    const body = parseBody(createKeySchema, request.body);
    const created = keys.create(body);
    return reply.status(201).send({
      token: created.token,
      key: created.key,
      warning: '明文只返回这一次，数据库只保存哈希。',
    });
  });

  app.delete('/api/keys/:id', async (request) => {
    const query = request.query as { confirm?: string };
    if (!queryFlag(query.confirm)) throw new AppError(400, 'CONFIRMATION_REQUIRED', '吊销密钥需要 confirm=true');
    return keys.revoke((request.params as { id: string }).id);
  });

  if (options.serveStatic !== false) {
    await app.register(fastifyStatic, {
      root: swaggerDist,
      prefix: '/docs/assets/',
      decorateReply: false,
      index: false,
    });
  }

  return app;
}

export async function listen(app: FastifyInstance, runtime: Runtime): Promise<void> {
  const indexFile = path.join(webDist, 'index.html');
  const { existsSync } = await import('node:fs');
  if (existsSync(indexFile)) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: '/',
      decorateReply: false,
      index: 'index.html',
    });
  } else {
    app.get('/', async () => ({
      service: 'worldview-map',
      docs: '/docs',
      health: '/health',
      hint: '前端尚未构建。运行 npm start（会先构建）或 npm run dev。',
    }));
  }
  await app.listen({ port: runtime.config.port, host: runtime.config.host });
}
