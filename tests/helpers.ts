import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/http/app.js';
import { createRuntime, type Runtime } from '../src/runtime.js';
import type { Polygon } from '../src/shared/geom.js';
import type { Scope } from '../src/shared/types.js';

export function square(x = 0, y = 0, size = 100): Polygon {
  return {
    type: 'Polygon',
    points: [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ],
  };
}

export async function testApp(options?: { rateLimitPerMin?: number; snapshotLimit?: number; dbPath?: string }): Promise<{
  app: FastifyInstance;
  runtime: Runtime;
  tokens: Record<'admin' | 'editor' | 'viewer', string>;
}> {
  const runtime = createRuntime({
    dbPath: options?.dbPath ?? ':memory:',
    rateLimitPerMin: options?.rateLimitPerMin ?? 1000,
    snapshotLimit: options?.snapshotLimit ?? 8,
    conflictDistance: 8,
  });
  const tokens = {
    admin: runtime.keys.create({ name: 'admin', scopes: ['read', 'write', 'delete', 'admin'] satisfies Scope[] }).token,
    editor: runtime.keys.create({ name: 'editor', scopes: ['read', 'write'] }).token,
    viewer: runtime.keys.create({ name: 'viewer', scopes: ['read'] }).token,
  };
  const app = await buildApp({ runtime, serveStatic: false });
  await app.ready();
  return { app, runtime, tokens };
}

export function auth(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}
