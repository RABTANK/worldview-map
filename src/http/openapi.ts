export const openapi = {
  openapi: '3.0.3',
  info: {
    title: '世界观地图 API',
    version: '3.0.0',
    description:
      '虚构世界观地图的 HTTP 契约。人前端与 MCP 共用同一套领域服务和 SQLite。坐标是局部平面坐标（y 向下），不是经纬度。写操作需要 API Key。',
  },
  servers: [{ url: 'http://localhost:3780', description: '本地' }],
  tags: [
    { name: 'meta' },
    { name: 'map' },
    { name: 'regions' },
    { name: 'places' },
    { name: 'indoor' },
    { name: 'snapshots' },
    { name: 'auth' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', description: '创建 Key 时一次性返回的明文，格式 wm_...' },
      apiKeyHeader: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: {
                type: 'string',
                enum: ['VALIDATION', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'CONFIRMATION_REQUIRED', 'RATE_LIMITED', 'INTERNAL'],
              },
              message: { type: 'string' },
            },
          },
        },
      },
      Polygon: {
        type: 'object',
        required: ['type', 'points'],
        properties: {
          type: { type: 'string', enum: ['Polygon'] },
          points: {
            type: 'array',
            minItems: 3,
            items: {
              type: 'object',
              required: ['x', 'y'],
              properties: { x: { type: 'number' }, y: { type: 'number' } },
            },
          },
        },
      },
      Region: {
        type: 'object',
        required: ['id', 'parentId', 'level', 'name', 'description', 'tags', 'geometry', 'fill', 'stroke', 'sortOrder', 'createdAt', 'updatedAt'],
        properties: {
          id: { type: 'string' },
          parentId: { type: 'string', nullable: true },
          level: { type: 'string', enum: ['continent', 'city', 'district', 'building_group', 'building'] },
          name: { type: 'string' },
          description: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          geometry: { $ref: '#/components/schemas/Polygon' },
          fill: { type: 'string' },
          stroke: { type: 'string' },
          sortOrder: { type: 'integer' },
          createdAt: { type: 'string' },
          updatedAt: { type: 'string' },
        },
      },
      Place: {
        type: 'object',
        required: ['id', 'regionId', 'name', 'x', 'y'],
        properties: {
          id: { type: 'string' },
          regionId: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          kind: { type: 'string' },
          x: { type: 'number' },
          y: { type: 'number' },
          createdAt: { type: 'string' },
          updatedAt: { type: 'string' },
        },
      },
    },
  },
  security: [{ bearerAuth: [] }, { apiKeyHeader: [] }],
  paths: {
    '/health': {
      get: {
        tags: ['meta'],
        security: [],
        summary: '健康检查',
        responses: { '200': { description: '服务可用' } },
      },
    },
    '/api/openapi.json': {
      get: { tags: ['meta'], security: [], summary: 'OpenAPI 文档', responses: { '200': { description: '本文件' } } },
    },
    '/api/me': {
      get: {
        tags: ['auth'],
        summary: '当前 API Key 身份',
        responses: {
          '200': { description: '不含密钥明文' },
          '401': { description: '未认证', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/map/view': {
      get: {
        tags: ['map'],
        summary: '当前视图：只含活跃区域的直接子级、地点，建筑则含室内楼层',
        parameters: [
          { name: 'regionId', in: 'query', schema: { type: 'string' } },
          { name: 'floorId', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: '视图' } },
      },
    },
    '/api/regions': {
      get: {
        tags: ['regions'],
        summary: '按父级列出直接子区域；all=true 时列出全部',
        parameters: [
          { name: 'parentId', in: 'query', schema: { type: 'string' } },
          { name: 'all', in: 'query', schema: { type: 'boolean' } },
        ],
        responses: { '200': { description: '区域列表' } },
      },
      post: {
        tags: ['regions'],
        summary: '创建区域',
        responses: {
          '201': { description: '已创建' },
          '400': { description: '校验失败', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/regions/{id}': {
      get: { tags: ['regions'], summary: '读取区域', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: '区域' } } },
      patch: { tags: ['regions'], summary: '更新区域', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: '已更新' } } },
      delete: {
        tags: ['regions'],
        summary: '删除区域。confirm=true 才会执行；有子区域时还要 cascade=true。删除前自动快照。',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'confirm', in: 'query', schema: { type: 'boolean' } },
          { name: 'cascade', in: 'query', schema: { type: 'boolean' } },
        ],
        responses: { '200': { description: '已删除' } },
      },
    },
    '/api/regions/{id}/children': {
      get: { tags: ['regions'], summary: '直接子区域', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: '子区域' } } },
    },
    '/api/regions/{id}/context': {
      get: { tags: ['regions'], summary: '下钻上下文与给 Agent 的摘要', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }, { name: 'floorId', in: 'query', schema: { type: 'string' } }], responses: { '200': { description: '上下文' } } },
    },
    '/api/places': {
      get: {
        tags: ['places'],
        summary: '地点列表，支持区域过滤、名称过滤和范围查询',
        parameters: [
          { name: 'regionId', in: 'query', schema: { type: 'string' } },
          { name: 'q', in: 'query', schema: { type: 'string' } },
          { name: 'minX', in: 'query', schema: { type: 'number' } },
          { name: 'minY', in: 'query', schema: { type: 'number' } },
          { name: 'maxX', in: 'query', schema: { type: 'number' } },
          { name: 'maxY', in: 'query', schema: { type: 'number' } },
        ],
        responses: { '200': { description: '地点' } },
      },
      post: { tags: ['places'], summary: '创建地点。过近时返回 CONFLICT，除非 ignoreConflict', responses: { '201': { description: '已创建' } } },
    },
    '/api/places/{id}': {
      get: { tags: ['places'], summary: '读取地点', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: '地点' } } },
      patch: { tags: ['places'], summary: '更新地点', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: '已更新' } } },
      delete: {
        tags: ['places'],
        summary: '删除地点，需要 confirm=true',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'confirm', in: 'query', schema: { type: 'boolean' } },
        ],
        responses: { '200': { description: '已删除' } },
      },
    },
    '/api/search': {
      get: {
        tags: ['map'],
        summary: '按名称、描述、标签搜索区域和地点',
        parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: '搜索结果' } },
      },
    },
    '/api/buildings/{id}/floors': {
      get: { tags: ['indoor'], summary: '建筑的室内楼层', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: '楼层' } } },
      post: { tags: ['indoor'], summary: '创建楼层', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '201': { description: '已创建' } } },
    },
    '/api/floors/{id}': {
      get: { tags: ['indoor'], summary: '楼层及其 tile', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: '楼层' } } },
      patch: { tags: ['indoor'], summary: '更新楼层', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: '已更新' } } },
      delete: {
        tags: ['indoor'],
        summary: '删除楼层，需要 confirm=true',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'confirm', in: 'query', schema: { type: 'boolean' } },
        ],
        responses: { '200': { description: '已删除' } },
      },
    },
    '/api/floors/{id}/tiles': {
      put: {
        tags: ['indoor'],
        summary: '整层替换 tile。未包含的格子视为空。',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: '更新后的楼层' } },
      },
    },
    '/api/snapshots': {
      get: { tags: ['snapshots'], summary: '快照列表（不含载荷）', responses: { '200': { description: '列表' } } },
      post: { tags: ['snapshots'], summary: '手动快照', responses: { '201': { description: '已创建' } } },
    },
    '/api/snapshots/{id}': {
      get: { tags: ['snapshots'], summary: '快照详情，含世界载荷', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: '快照' } } },
    },
    '/api/snapshots/{id}/rollback': {
      post: {
        tags: ['snapshots'],
        summary: '回滚到快照。需要 admin，且 confirm=true。回滚前会自动再做一个备份快照。',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: '已回滚' },
          '403': { description: '权限不足', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/logs': {
      get: {
        tags: ['meta'],
        summary: '操作日志',
        parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer' } }],
        responses: { '200': { description: '日志' } },
      },
    },
    '/api/keys': {
      get: { tags: ['auth'], summary: '列出 API Key 的公开字段。需要 admin。不明文。', responses: { '200': { description: '列表' } } },
      post: { tags: ['auth'], summary: '创建 API Key。响应里的 token 只出现这一次。需要 admin。', responses: { '201': { description: '明文只此一次' } } },
    },
    '/api/keys/{id}': {
      delete: {
        tags: ['auth'],
        summary: '吊销 API Key。需要 admin 与 confirm=true。',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'confirm', in: 'query', schema: { type: 'boolean' } },
        ],
        responses: { '200': { description: '已吊销' } },
      },
    },
  },
} as const;
