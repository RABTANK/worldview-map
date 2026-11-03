import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRuntime } from '../src/runtime.js';
import { openapi } from '../src/http/openapi.js';
import { auth, square, testApp } from './helpers.js';

const closers: Array<{ close: () => void }> = [];

afterEach(async () => {
  while (closers.length) {
    const item = closers.pop();
    item?.close();
  }
});

describe('HTTP API', () => {
  it('serves OpenAPI and structured errors without stacks', async () => {
    const ctx = await testApp();
    closers.push({ close: () => ctx.app.close() });
    const spec = await ctx.app.inject({ method: 'GET', url: '/api/openapi.json' });
    expect(spec.statusCode).toBe(200);
    const body = spec.json();
    for (const pathName of ['/health', '/api/regions', '/api/places', '/api/map/view', '/api/floors/{id}/tiles', '/api/snapshots/{id}/rollback', '/api/keys']) {
      expect(body.paths[pathName], pathName).toBeTruthy();
    }
    expect(body.components.schemas.Error).toBeTruthy();
    expect(openapi.paths['/api/regions']).toBeTruthy();

    const missing = await ctx.app.inject({ method: 'POST', url: '/api/regions', payload: { name: 'x' } });
    expect(missing.statusCode).toBe(401);
    expect(missing.json().error.code).toBe('UNAUTHORIZED');
    expect(JSON.stringify(missing.json())).not.toContain('node_modules');

    const denied = await ctx.app.inject({
      method: 'POST',
      url: '/api/regions',
      headers: auth(ctx.tokens.viewer),
      payload: { level: 'continent', name: '不能写', geometry: square() },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error).toEqual({ code: 'FORBIDDEN', message: expect.stringContaining('write') });
  });

  it('lets a human edit show up on the next read, and blocks rollback without admin', async () => {
    const ctx = await testApp();
    closers.push({ close: () => ctx.app.close() });
    const created = await ctx.app.inject({
      method: 'POST',
      url: '/api/regions',
      headers: auth(ctx.tokens.editor),
      payload: { id: 'continent_http', level: 'continent', name: '旧名', description: '雾', tags: ['北'], geometry: square(0, 0, 300) },
    });
    expect(created.statusCode).toBe(201);

    const patched = await ctx.app.inject({
      method: 'PATCH',
      url: '/api/regions/continent_http',
      headers: auth(ctx.tokens.editor),
      payload: { name: '新名', description: '人刚改的' },
    });
    expect(patched.statusCode).toBe(200);

    const read = await ctx.app.inject({
      method: 'GET',
      url: '/api/regions/continent_http',
      headers: auth(ctx.tokens.viewer),
    });
    expect(read.json()).toMatchObject({ name: '新名', description: '人刚改的' });

    const snap = await ctx.app.inject({
      method: 'POST',
      url: '/api/snapshots',
      headers: auth(ctx.tokens.editor),
      payload: { label: '人工快照' },
    });
    expect(snap.statusCode).toBe(201);
    const rollbackDenied = await ctx.app.inject({
      method: 'POST',
      url: `/api/snapshots/${snap.json().id}/rollback`,
      headers: auth(ctx.tokens.editor),
      payload: { confirm: true },
    });
    expect(rollbackDenied.statusCode).toBe(403);

    await ctx.app.inject({
      method: 'PATCH',
      url: '/api/regions/continent_http',
      headers: auth(ctx.tokens.editor),
      payload: { name: '被回滚的名字' },
    });
    const rollback = await ctx.app.inject({
      method: 'POST',
      url: `/api/snapshots/${snap.json().id}/rollback`,
      headers: auth(ctx.tokens.admin),
      payload: { confirm: true },
    });
    expect(rollback.statusCode).toBe(200);
    const after = await ctx.app.inject({
      method: 'GET',
      url: '/api/map/view?regionId=continent_http',
      headers: auth(ctx.tokens.viewer),
    });
    expect(after.json().region.name).toBe('新名');
  });

  it('rate limits authenticated writes and never returns a raw key from the list', async () => {
    const ctx = await testApp({ rateLimitPerMin: 2 });
    closers.push({ close: () => ctx.app.close() });
    const headers = auth(ctx.tokens.admin);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/me', headers })).statusCode).toBe(200);
    expect((await ctx.app.inject({ method: 'GET', url: '/api/me', headers })).statusCode).toBe(200);
    const limited = await ctx.app.inject({ method: 'GET', url: '/api/me', headers });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('RATE_LIMITED');
    expect(limited.headers['retry-after']).toBeTruthy();

    const created = await ctx.runtime.keys.create({ name: 'once', scopes: ['read'] });
    const list = ctx.runtime.keys.list();
    expect(JSON.stringify(list).includes(created.token)).toBe(false);
  });
});

describe('shared sqlite', () => {
  it('shows an edit from a second connection without restart', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worldview-'));
    const dbPath = path.join(dir, 'world.sqlite');
    const first = createRuntime({ dbPath });
    const editor = first.keys.create({ name: 'editor', scopes: ['read', 'write'] });
    const actor = first.keys.authenticate(editor.token)!;
    first.world.createRegion({ id: 'c', level: 'continent', name: '原名', geometry: square() }, actor);
    first.world.updateRegion('c', { name: '人改过' }, actor);

    const second = createRuntime({ dbPath });
    expect(second.world.getRegion('c').name).toBe('人改过');
    second.world.updateRegion('c', { description: 'Agent 补的' }, actor);
    expect(first.world.getRegion('c').description).toBe('Agent 补的');
    first.sqlite.close();
    second.sqlite.close();
  });
});
