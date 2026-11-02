import { describe, expect, it } from 'vitest';
import { hashKey } from '../src/domain/auth.js';
import { createRuntime } from '../src/runtime.js';
import type { Actor } from '../src/shared/types.js';
import { square } from './helpers.js';

const actor: Actor = { keyId: null, name: 'test', scopes: ['read', 'write', 'delete', 'admin'] };

describe('world model', () => {
  it('migrates an empty database and enforces the hierarchy', () => {
    const runtime = createRuntime({ dbPath: ':memory:' });
    const continent = runtime.world.createRegion(
      { id: 'c1', level: 'continent', name: '霜歌大陆', geometry: square(0, 0, 400), parentId: null },
      actor,
    );
    expect(continent.level).toBe('continent');
    expect(() =>
      runtime.world.createRegion({ level: 'city', name: '无父之城', geometry: square(), parentId: null }, actor),
    ).toThrow(/必须属于/);
    const city = runtime.world.createRegion(
      { id: 'city1', parentId: 'c1', level: 'city', name: '银港', geometry: square(10, 10, 200) },
      actor,
    );
    expect(() =>
      runtime.world.createRegion({ parentId: city.id, level: 'building', name: '跳级塔', geometry: square() }, actor),
    ).toThrow(/父级必须是/);
    const tables = runtime.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
    expect(tables.map((row) => row.name)).toEqual(expect.arrayContaining(['regions', 'places', 'indoor_floors', 'indoor_tiles', 'api_keys', 'snapshots', 'audit_logs']));
    runtime.sqlite.close();
  });

  it('rejects close places unless conflict is ignored, and keeps hashes only', () => {
    const runtime = createRuntime({ dbPath: ':memory:', conflictDistance: 8 });
    runtime.world.createRegion({ id: 'c1', level: 'continent', name: '大陆', geometry: square(0, 0, 300) }, actor);
    runtime.world.createPlace({ id: 'p1', regionId: 'c1', name: '井', x: 10, y: 10 }, actor);
    expect(() => runtime.world.createPlace({ regionId: 'c1', name: '另一口井', x: 12, y: 12 }, actor)).toThrow(/距离过近/);
    const forced = runtime.world.createPlace({ regionId: 'c1', name: '贴着的标记', x: 12, y: 12, ignoreConflict: true }, actor);
    expect(forced.name).toBe('贴着的标记');

    const created = runtime.keys.create({ name: 'writer', scopes: ['read', 'write'] });
    const row = runtime.sqlite.prepare('SELECT key_hash, key_prefix, name, scopes FROM api_keys WHERE id = ?').get(created.key.id) as {
      key_hash: string;
      key_prefix: string;
      name: string;
      scopes: string;
    };
    expect(row.key_hash).toBe(hashKey(created.token));
    expect(JSON.stringify(row).includes(created.token)).toBe(false);
    expect(row.key_prefix.length).toBeLessThan(created.token.length);
    runtime.sqlite.close();
  });

  it('rolls a snapshot back, including indoor tiles', () => {
    const runtime = createRuntime({ dbPath: ':memory:', snapshotLimit: 5 });
    runtime.world.createRegion({ id: 'c', level: 'continent', name: '大陆', geometry: square(0, 0, 200) }, actor);
    runtime.world.createRegion({ id: 'city', parentId: 'c', level: 'city', name: '城', geometry: square() }, actor);
    runtime.world.createRegion({ id: 'd', parentId: 'city', level: 'district', name: '区', geometry: square() }, actor);
    runtime.world.createRegion({ id: 'g', parentId: 'd', level: 'building_group', name: '群', geometry: square() }, actor);
    runtime.world.createRegion({ id: 'b', parentId: 'g', level: 'building', name: '旧灯塔', geometry: square() }, actor);
    const floor = runtime.world.createFloor({ regionId: 'b', floorIndex: 0, name: '门厅', width: 4, height: 4 }, actor);
    runtime.world.setTiles(floor.id, [{ x: 1, y: 1, tileType: 'lamp' }], actor);
    const snap = runtime.world.createSnapshot(actor, '改名前', 'manual');
    runtime.world.updateRegion('b', { name: '新灯塔' }, actor);
    runtime.world.setTiles(floor.id, [{ x: 0, y: 0, tileType: 'wall' }], actor);
    expect(runtime.world.getRegion('b').name).toBe('新灯塔');

    const viewer: Actor = { keyId: 'v', name: 'viewer', scopes: ['read'] };
    expect(() => runtime.world.rollback(snap.id, true, viewer)).toThrow(/admin/);
    expect(() => runtime.world.rollback(snap.id, false, actor)).toThrow(/confirm/);
    runtime.world.rollback(snap.id, true, actor);
    expect(runtime.world.getRegion('b').name).toBe('旧灯塔');
    const restored = runtime.world.getFloor(floor.id);
    expect(restored.tiles).toEqual([expect.objectContaining({ x: 1, y: 1, tileType: 'lamp' })]);
    expect(() => runtime.world.deleteRegion('c', { confirm: false, cascade: true }, actor)).toThrow(/confirm/);
    runtime.sqlite.close();
  });

  it('requires confirmation and cascade before deleting a subtree', () => {
    const runtime = createRuntime({ dbPath: ':memory:' });
    runtime.world.createRegion({ id: 'c', level: 'continent', name: '大陆', geometry: square(0, 0, 100) }, actor);
    runtime.world.createRegion({ id: 'city', parentId: 'c', level: 'city', name: '城', geometry: square() }, actor);
    expect(() => runtime.world.deleteRegion('c', { confirm: true, cascade: false }, actor)).toThrow(/cascade/);
    runtime.world.deleteRegion('c', { confirm: true, cascade: true }, actor);
    expect(runtime.world.listRegions()).toHaveLength(0);
    const snapshots = runtime.world.listSnapshots();
    expect(snapshots.some((item) => item.reason === 'auto:before_delete')).toBe(true);
    runtime.sqlite.close();
  });
});
