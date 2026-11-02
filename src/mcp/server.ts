import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { hasScope } from '../domain/auth.js';
import { AppError } from '../domain/errors.js';
import type { PlacePatch } from '../domain/world.js';
import { RateLimiter } from '../domain/rate-limit.js';
import type { Actor, Scope } from '../shared/types.js';
import type { Runtime } from '../runtime.js';

export const MCP_TOOL_NAMES = [
  'map_list_children',
  'map_get_region',
  'map_create_region',
  'map_update_region',
  'map_delete_region',
  'map_list_locations',
  'map_get_location',
  'map_upsert_location',
  'map_update_location',
  'map_delete_location',
  'map_list_routes',
  'map_get_route',
  'map_create_route',
  'map_update_route',
  'map_delete_route',
  'map_get_context',
  'map_search',
  'map_list_floors',
  'map_get_floor',
  'map_upsert_floor',
  'map_set_tiles',
  'map_delete_floor',
  'map_create_snapshot',
  'map_list_snapshots',
  'map_rollback_snapshot',
] as const;

const polygonSchema = z.object({
  type: z.literal('Polygon'),
  points: z.array(z.object({ x: z.number(), y: z.number() })).min(3).max(64),
});

const lineStringSchema = z.object({
  type: z.literal('LineString'),
  points: z.array(z.object({ x: z.number(), y: z.number() })).min(2).max(256),
});

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const placeFields = {
  regionId: z.string().optional().describe('地点所属区域'),
  name: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  kind: z.string().optional().describe('小写字母、数字、下划线或连字符，默认 landmark'),
  x: z.number().optional(),
  y: z.number().optional(),
  ignoreConflict: z.boolean().optional().describe('为 true 时允许和附近地点靠得很近'),
};

function placePatch(args: Record<string, unknown>): PlacePatch {
  const patch: PlacePatch = {};
  if (typeof args.regionId === 'string') patch.regionId = args.regionId;
  if (typeof args.name === 'string') patch.name = args.name;
  if (typeof args.description === 'string') patch.description = args.description;
  if (Array.isArray(args.tags)) patch.tags = args.tags.map(String);
  if (typeof args.kind === 'string') patch.kind = args.kind;
  if (typeof args.x === 'number') patch.x = args.x;
  if (typeof args.y === 'number') patch.y = args.y;
  if (typeof args.ignoreConflict === 'boolean') patch.ignoreConflict = args.ignoreConflict;
  return patch;
}

function placeExists(world: Runtime['world'], id: string): boolean {
  try {
    world.getPlace(id);
    return true;
  } catch (error) {
    if (error instanceof AppError && error.status === 404) return false;
    throw error;
  }
}

export function createMcpServer(runtime: Runtime, getActor: () => Actor, limiter: RateLimiter): McpServer {
  const server = new McpServer({ name: 'worldview-map', version: '3.0.0' });
  const world = runtime.world;

  const wrap =
    (scope: Scope, fn: (actor: Actor, args: Record<string, unknown>) => unknown) =>
    async (args: Record<string, unknown>): Promise<ToolResult> => {
      try {
        const actor = getActor();
        if (actor.keyId) {
          const limit = limiter.hit(`mcp:${actor.keyId}`);
          if (!limit.ok) throw new AppError(429, 'RATE_LIMITED', '请求过于频繁');
        }
        if (!hasScope(actor, scope)) throw new AppError(403, 'FORBIDDEN', `权限不足，需要 ${scope}`);
        const data = await fn(actor, args ?? {});
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (error) {
        if (!(error instanceof AppError)) console.error(error);
        const message = error instanceof AppError ? `${error.code}: ${error.message}` : 'INTERNAL: 服务器内部错误';
        return { isError: true, content: [{ type: 'text', text: message }] };
      }
    };

  server.registerTool(
    'map_list_children',
    {
      title: '列出直接子区域',
      description: '只返回某个区域的直接子级，避免跨层重叠。parentId 省略或 null 表示世界根（大陆）。需要 read。无副作用。',
      inputSchema: { parentId: z.string().nullable().optional().describe('父区域 id') },
      annotations: { readOnlyHint: true },
    },
    wrap('read', (_actor, args) => ({ regions: world.listChildren((args.parentId as string | null) ?? null) })),
  );

  server.registerTool(
    'map_get_region',
    {
      title: '读取区域',
      description: '按 id 读取区域。几何坐标在其父区域的局部平面里，y 向下，不是经纬度。需要 read。',
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: true },
    },
    wrap('read', (_actor, args) => world.getRegion(String(args.id))),
  );

  server.registerTool(
    'map_create_region',
    {
      title: '创建区域',
      description:
        '创建大陆、城市、区域、建筑群或建筑。层级必须严格接在上一级下面：continent → city → district → building_group → building。需要 write。',
      inputSchema: {
        id: z.string().optional(),
        parentId: z.string().nullable().optional(),
        level: z.enum(['continent', 'city', 'district', 'building_group', 'building']),
        name: z.string(),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
        geometry: polygonSchema,
        fill: z.string().optional(),
        stroke: z.string().optional(),
        sortOrder: z.number().optional(),
      },
      annotations: { readOnlyHint: false },
    },
    wrap('write', (actor, args) => world.createRegion(args as never, actor)),
  );

  server.registerTool(
    'map_update_region',
    {
      title: '更新区域',
      description: '局部更新区域的名称、描述、标签、几何、颜色或父级。需要 write。不会自动发布，写入后读接口立即可见。',
      inputSchema: {
        id: z.string(),
        parentId: z.string().nullable().optional(),
        level: z.enum(['continent', 'city', 'district', 'building_group', 'building']).optional(),
        name: z.string().optional(),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
        geometry: polygonSchema.optional(),
        fill: z.string().optional(),
        stroke: z.string().optional(),
        sortOrder: z.number().optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    wrap('write', (actor, args) => {
      const { id, ...patch } = args;
      return world.updateRegion(String(id), patch, actor);
    }),
  );

  server.registerTool(
    'map_delete_region',
    {
      title: '删除区域',
      description:
        '危险操作。confirm 必须为 true 才会删除，否则只返回说明、不改数据。存在子区域时还必须 cascade=true。删除前自动做快照。需要 delete。',
      inputSchema: {
        id: z.string(),
        confirm: z.boolean().describe('必须为 true 才执行删除'),
        cascade: z.boolean().optional().describe('为 true 时连同子孙区域一起删除'),
      },
      annotations: { destructiveHint: true, readOnlyHint: false },
    },
    wrap('delete', (actor, args) =>
      world.deleteRegion(
        String(args.id),
        { confirm: Boolean(args.confirm), cascade: Boolean(args.cascade) },
        actor,
      ),
    ),
  );

  server.registerTool(
    'map_list_locations',
    {
      title: '列出地点',
      description: '地点坐标属于所在区域的局部平面。可按区域、名称和包围盒过滤。范围查询必须同时给 minX/minY/maxX/maxY。需要 read。',
      inputSchema: {
        regionId: z.string().optional(),
        q: z.string().optional(),
        minX: z.number().optional(),
        minY: z.number().optional(),
        maxX: z.number().optional(),
        maxY: z.number().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    wrap('read', (_actor, args) => ({ places: world.listPlaces(args as never) })),
  );

  server.registerTool(
    'map_get_location',
    {
      title: '读取地点',
      description: '按 id 读取一个地点。需要 read。',
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: true },
    },
    wrap('read', (_actor, args) => world.getPlace(String(args.id))),
  );

  server.registerTool(
    'map_upsert_location',
    {
      title: '创建或更新地点',
      description:
        '增：不带已有 id 时必须给 regionId、name、x、y。改：id 已存在时只传要改的字段。同一区域里距离过近会 CONFLICT，除非 ignoreConflict=true。需要 write。写入后读接口立即可见。',
      inputSchema: { id: z.string().optional(), ...placeFields },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    wrap('write', (actor, args) => {
      const id = typeof args.id === 'string' ? args.id : undefined;
      const patch = placePatch(args);
      if (id && placeExists(world, id)) {
        if (Object.keys(patch).length === 0) throw new AppError(400, 'VALIDATION', '更新地点至少提供一个字段');
        return world.updatePlace(id, patch, actor);
      }
      if (patch.regionId == null || patch.name == null || patch.x == null || patch.y == null) {
        throw new AppError(400, 'VALIDATION', '新建地点需要 regionId、name、x、y');
      }
      return world.createPlace({ id, regionId: patch.regionId, name: patch.name, description: patch.description, tags: patch.tags, kind: patch.kind, x: patch.x, y: patch.y, ignoreConflict: patch.ignoreConflict }, actor);
    }),
  );

  server.registerTool(
    'map_update_location',
    {
      title: '更新地点',
      description: '按 id 局部更新地点的名称、描述、标签、类型或坐标。未提供的字段保持原值。需要 write。',
      inputSchema: { id: z.string(), ...placeFields },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    wrap('write', (actor, args) => {
      const patch = placePatch(args);
      if (Object.keys(patch).length === 0) throw new AppError(400, 'VALIDATION', '更新地点至少提供一个字段');
      return world.updatePlace(String(args.id), patch, actor);
    }),
  );

  server.registerTool(
    'map_delete_location',
    {
      title: '删除地点',
      description: '危险操作。confirm 必须为 true 才会删除。需要 delete。',
      inputSchema: { id: z.string(), confirm: z.boolean() },
      annotations: { destructiveHint: true, readOnlyHint: false },
    },
    wrap('delete', (actor, args) => {
      world.deletePlace(String(args.id), Boolean(args.confirm), actor);
      return { ok: true };
    }),
  );

  server.registerTool(
    'map_list_routes',
    {
      title: '列出道路',
      description: '列出道路，可按所属区域和名称/类型过滤。路线几何使用所在区域的局部平面坐标。需要 read。',
      inputSchema: { regionId: z.string().optional(), q: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    wrap('read', (_actor, args) => ({ routes: world.listRoutes(args as never) })),
  );

  server.registerTool(
    'map_get_route',
    {
      title: '读取道路',
      description: '按 id 读取道路。需要 read。',
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: true },
    },
    wrap('read', (_actor, args) => world.getRoute(String(args.id))),
  );

  server.registerTool(
    'map_create_route',
    {
      title: '创建道路',
      description: '创建当前区域坐标系下的道路折线。kind 为 road、trail、sea 或 custom；width 使用局部坐标单位；style 可选为十六进制线色覆盖。需要 write。',
      inputSchema: {
        id: z.string().optional(),
        regionId: z.string(),
        name: z.string(),
        kind: z.enum(['road', 'trail', 'sea', 'custom']).optional(),
        geometry: lineStringSchema,
        width: z.number().nullable().optional().describe('1–64 局部坐标单位'),
        style: z.string().nullable().optional().describe('可选 #RGB 或 #RRGGBB 线色覆盖'),
      },
      annotations: { readOnlyHint: false },
    },
    wrap('write', (actor, args) => world.createRoute(args as never, actor)),
  );

  server.registerTool(
    'map_update_route',
    {
      title: '更新道路',
      description: '按 id 局部更新道路名称、类型、所属区域、折线或样式。null 可清除 width/style 覆盖。需要 write。',
      inputSchema: {
        id: z.string(),
        regionId: z.string().optional(),
        name: z.string().optional(),
        kind: z.enum(['road', 'trail', 'sea', 'custom']).optional(),
        geometry: lineStringSchema.optional(),
        width: z.number().nullable().optional(),
        style: z.string().nullable().optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    wrap('write', (actor, args) => {
      const { id, ...patch } = args;
      return world.updateRoute(String(id), patch as never, actor);
    }),
  );

  server.registerTool(
    'map_delete_route',
    {
      title: '删除道路',
      description: '危险操作。confirm 必须为 true 才会删除。删除所属区域时，道路随区域级联清理。需要 delete。',
      inputSchema: { id: z.string(), confirm: z.boolean() },
      annotations: { destructiveHint: true, readOnlyHint: false },
    },
    wrap('delete', (actor, args) => {
      world.deleteRoute(String(args.id), Boolean(args.confirm), actor);
      return { ok: true };
    }),
  );

  server.registerTool(
    'map_get_context',
    {
      title: '下钻上下文',
      description:
        '返回当前区域、面包屑、直接子级、地点、道路，以及建筑的室内楼层摘要。summary 字段给续写用。regionId 省略表示世界根。需要 read。',
      inputSchema: {
        regionId: z.string().nullable().optional(),
        floorId: z.string().nullable().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    wrap('read', (_actor, args) => world.getView((args.regionId as string | null) ?? null, (args.floorId as string | null) ?? null)),
  );

  server.registerTool(
    'map_search',
    {
      title: '搜索',
      description: '按名称、描述或标签搜索区域和地点。需要 read。',
      inputSchema: { query: z.string() },
      annotations: { readOnlyHint: true },
    },
    wrap('read', (_actor, args) => world.search(String(args.query ?? ''))),
  );

  server.registerTool(
    'map_list_floors',
    {
      title: '列出室内楼层',
      description: '只对 level=building 的区域有效。需要 read。',
      inputSchema: { buildingId: z.string() },
      annotations: { readOnlyHint: true },
    },
    wrap('read', (_actor, args) => ({ floors: world.listFloors(String(args.buildingId)) })),
  );

  server.registerTool(
    'map_get_floor',
    {
      title: '读取室内楼层',
      description: '读取一层及其全部 tile。需要 read。',
      inputSchema: { id: z.string() },
      annotations: { readOnlyHint: true },
    },
    wrap('read', (_actor, args) => world.getFloor(String(args.id))),
  );

  server.registerTool(
    'map_upsert_floor',
    {
      title: '创建或更新室内楼层',
      description: '建筑室内平面的一层。width/height 为 1–64 的格子数。已存在 id 则更新。需要 write。',
      inputSchema: {
        id: z.string().optional(),
        buildingId: z.string(),
        floorIndex: z.number(),
        name: z.string(),
        width: z.number(),
        height: z.number(),
      },
      annotations: { readOnlyHint: false },
    },
    wrap('write', (actor, args) =>
      world.upsertFloor(
        {
          id: args.id as string | undefined,
          regionId: String(args.buildingId),
          floorIndex: Number(args.floorIndex),
          name: String(args.name),
          width: Number(args.width),
          height: Number(args.height),
        },
        actor,
      ),
    ),
  );

  server.registerTool(
    'map_set_tiles',
    {
      title: '替换室内 tile',
      description:
        '整层替换。未出现的格子视为空。tileType 为 floor_wood、floor_stone、wall、door、stairs、window、furniture、lamp、rug、water。需要 write。',
      inputSchema: {
        floorId: z.string(),
        tiles: z.array(
          z.object({
            x: z.number(),
            y: z.number(),
            tileType: z.enum(['floor_wood', 'floor_stone', 'wall', 'door', 'stairs', 'window', 'furniture', 'lamp', 'rug', 'water']),
            meta: z.record(z.string(), z.unknown()).optional(),
          }),
        ),
      },
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    wrap('write', (actor, args) => world.setTiles(String(args.floorId), args.tiles as never, actor)),
  );

  server.registerTool(
    'map_delete_floor',
    {
      title: '删除室内楼层',
      description: '危险操作。confirm 必须为 true。会删掉该层全部 tile。需要 delete。',
      inputSchema: { id: z.string(), confirm: z.boolean() },
      annotations: { destructiveHint: true, readOnlyHint: false },
    },
    wrap('delete', (actor, args) => {
      world.deleteFloor(String(args.id), Boolean(args.confirm), actor);
      return { ok: true };
    }),
  );

  server.registerTool(
    'map_create_snapshot',
    {
      title: '创建快照',
      description: '手动保存当前世界载荷（区域、地点、楼层、tile，不含 API Key）。需要 write。快照总数有上限，优先淘汰自动快照。',
      inputSchema: { label: z.string() },
      annotations: { readOnlyHint: false },
    },
    wrap('write', (actor, args) => world.createSnapshot(actor, String(args.label), 'manual')),
  );

  server.registerTool(
    'map_list_snapshots',
    {
      title: '列出快照',
      description: '返回快照元数据，不含大型载荷。需要 read。',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    wrap('read', () => ({ snapshots: world.listSnapshots() })),
  );

  server.registerTool(
    'map_rollback_snapshot',
    {
      title: '回滚快照',
      description: '危险操作。需要 admin，且 confirm 必须为 true。回滚前会先自动备份当前世界。回滚后读接口立即看到旧状态。',
      inputSchema: { id: z.string(), confirm: z.boolean() },
      annotations: { destructiveHint: true, readOnlyHint: false },
    },
    wrap('admin', (actor, args) => world.rollback(String(args.id), Boolean(args.confirm), actor)),
  );

  return server;
}
