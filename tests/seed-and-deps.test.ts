import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRuntime } from '../src/runtime.js';

describe('seed and dependency boundaries', () => {
  it('does not depend on map or chart libraries', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const names = [...Object.keys(pkg.dependencies), ...Object.keys(pkg.devDependencies)];
    for (const banned of ['echarts', 'echarts-gl', 'leaflet', 'maplibre-gl', 'mapbox-gl']) {
      expect(names).not.toContain(banned);
    }
  });

  it('seeds a multi-level world with an indoor building', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'worldview-seed-'));
    const dbPath = path.join(dir, 'world.sqlite');
    const output = execFileSync('npx', ['tsx', 'src/seed.ts'], {
      cwd: process.cwd(),
      env: { ...process.env, WORLDVIEW_DB: dbPath },
      encoding: 'utf8',
    });
    expect(output).toContain('折光海纪');
    expect(output).toContain('wm_');
    expect(output).not.toContain('writer-agent-key');

    const runtime = createRuntime({ dbPath });
    const lighthouse = runtime.world.getRegion('building_old_lighthouse');
    expect(lighthouse.level).toBe('building');
    const crumbs = runtime.world.getView(lighthouse.id).breadcrumb.map((item) => item.name);
    expect(crumbs).toEqual(['霜歌大陆', '银港', '灯塔区', '潮声坊', '旧灯塔']);
    const floors = runtime.world.listFloors(lighthouse.id);
    expect(floors.map((floor) => floor.name)).toEqual(['门厅', '灯室']);
    expect(runtime.world.getFloor(floors[1].id).tiles.some((tile) => tile.tileType === 'lamp')).toBe(true);
    const root = runtime.world.getView(null);
    expect(root.children.map((region) => region.name).sort()).toEqual(['翠幕群岛', '霜歌大陆']);
    expect(root.children).toHaveLength(2);
    runtime.sqlite.close();
  });
});
