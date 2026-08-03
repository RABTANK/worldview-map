# 交互式世界观地图系统

Agent 友好的动态世界观构建平台，将地图从"静态图片"升级为"动态数据库"。

## 快速开始

```bash
# 安装依赖
npm install

# 启动服务
npm start
```

服务启动后：
- 前端地图：http://localhost:3000
- API 总览：http://localhost:3000/api
- 健康检查：http://localhost:3000/api/health

## 系统架构

```
worldview-map/
├── server.js              # 主服务器入口
├── db.js                  # JSON 文件存储引擎
├── package.json           # 依赖配置
├── middleware/
│   ├── auth.js            # API Key 鉴权
│   └── validation.js      # 数据校验
├── routes/
│   ├── locations.js       # 地点 CRUD
│   ├── map.js             # 地图结构管理
│   ├── versions.js        # 版本控制
│   └── logs.js            # 操作日志
├── services/
│   └── memory.js          # Agent 记忆服务 (Zep 接口预留)
├── data/
│   ├── map.geojson.json   # 地图 GeoJSON (初始为空)
│   ├── locations.json     # 地点数据 (初始为空)
│   ├── versions.json      # 版本快照
│   ├── logs.json          # 操作日志
│   └── api-keys.json      # API Key 配置
└── public/
    ├── index.html         # 前端页面
    ├── css/style.css      # 暗黑奇幻风格样式
    └── js/
        ├── api-client.js   # API 客户端
        ├── map-renderer.js # ECharts 地图渲染引擎
        └── app.js          # 应用主逻辑
```

## API Key

| Agent | API Key | 权限 |
|-------|---------|------|
| 写作 Agent | `writer-agent-key-001` | 读写删 |
| RPA Agent | `rpa-agent-key-001` | 读写删 |
| 前端浏览器 | `viewer-key-001` | 只读 |

写操作需在请求头携带 `X-API-Key`。

## API 接口

### 地点接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/locations` | 获取全量地点列表 (支持 ?type= &tag=) |
| GET | `/api/locations/range?x1=&y1=&x2=&y2=` | 获取指定范围内的地点 |
| GET | `/api/locations/:id` | 获取地点详情 |
| POST | `/api/locations` | 新增地点 (需 API Key, 含冲突检测) |
| PUT | `/api/locations/:id` | 更新地点 (需 API Key) |
| DELETE | `/api/locations/:id` | 删除地点 (需 API Key) |

### 地图结构接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/map/structure` | 获取 GeoJSON 结构 |
| GET | `/api/map/layers` | 获取图层列表 |
| POST | `/api/map/features` | 新增区域 (需 API Key) |
| PUT | `/api/map/features/:id` | 更新区域 (需 API Key) |
| DELETE | `/api/map/features/:id` | 删除区域 (需 API Key) |
| PUT | `/api/map/structure` | 批量替换地图结构 (需 API Key) |

### 版本控制接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/versions` | 获取版本列表 |
| POST | `/api/versions/:version/rollback` | 回滚到指定版本 (需 API Key) |
| POST | `/api/versions/snapshot` | 手动创建快照 (需 API Key) |

### 日志与记忆接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/logs` | 获取操作日志 |
| GET | `/api/logs/timeline` | 世界观演变时间线 |
| GET | `/api/memory/summary` | 世界观演变摘要 |
| GET | `/api/memory/timeline` | Agent 记忆时间线 |

## 坐标系统

所有地点坐标基于统一的相对坐标系（0-1000 平面坐标）：
- x 轴向右递增 (0-1000)
- y 轴向上递增 (0-1000)
- 新增地点时自动检测坐标冲突（间距 < 15 单位）

## 调用示例

### 新增地点

```bash
curl -X POST http://localhost:3000/api/locations \
  -H "Content-Type: application/json" \
  -H "X-API-Key: writer-agent-key-001" \
  -d '{
    "name": "迷雾森林",
    "coordinates": [780, 450],
    "type": "landmark",
    "description": "一片常年被浓雾笼罩的神秘森林",
    "tags": ["神秘", "危险"],
    "context": "用户描述了该区域的氛围"
  }'
```

### 新增区域

```bash
curl -X POST http://localhost:3000/api/map/features \
  -H "Content-Type: application/json" \
  -H "X-API-Key: writer-agent-key-001" \
  -d '{
    "type": "Feature",
    "properties": {
      "name": "翠绿平原",
      "id": "verdant_plains",
      "color": "rgba(30, 70, 50, 0.35)"
    },
    "geometry": {
      "type": "Polygon",
      "coordinates": [[[300,320],[700,320],[720,550],[700,680],[350,680],[330,520],[340,420]]]
    }
  }'
```

### 查询地点

```bash
curl http://localhost:3000/api/locations?type=city
```

## 技术栈

- 后端：Node.js + Express
- 前端：ECharts 5.5 + 原生 JavaScript
- 存储：JSON 文件 (可平滑替换为 SQLite/PostgreSQL)
- 记忆库：Zep 接口预留 (当前为本地存储)

## 地点类型

| 类型 | 标识 | 颜色 |
|------|------|------|
| city | 城市 | #ffd700 |
| village | 村庄 | #7cfc00 |
| fortress | 要塞 | #ff4500 |
| port | 港口 | #1e90ff |
| ruins | 遗迹 | #9370db |
| tower | 塔楼 | #00ced1 |
| forge | 熔炉 | #ff8c00 |
| landmark | 地标 | #ffffff |
| dungeon | 地下城 | #8b0000 |
| camp | 营地 | #deb887 |
| shrine | 神殿 | #c0c0c0 |
| other | 其他 | #a9a9a9 |
