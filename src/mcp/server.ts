import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { hasScope } from '../domain/auth.js';
import { AppError } from '../domain/errors.js';
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
  'map_upsert_location',
  'map_delete_location',
  'map_get_context',
  'map_search',
  'map_list_floors',
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

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

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
    'map_upsert_location',
    {
      title: '创建或更新地点',
      description:
        '提供已存在的 id 则更新，否则创建。同一区域里距离小于阈值会返回 CONFLICT，除非 ignoreConflict=true。需要 write。',
      inputSchema: {
        id: z.string().optional(),
        regionId: z.string(),
        name: z.string(),
        description: z.string().optional(),
        tags: z.array(z.string()).optional(),
        kind: z.string().optional(),
        x: z.number(),
        y: z.number(),
        ignoreConflict: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    wrap('write', (actor, args) => world.upsertPlace(args as never, actor)),
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
    'map_get_context',
    {
      title: '下钻上下文',
      description:
        '返回当前区域、面包屑、直接子级、地点，以及建筑的室内楼层摘要。summary 字段给续写用。regionId 省略表示世界根。需要 read。',
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
