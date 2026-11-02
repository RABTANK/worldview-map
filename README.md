# 世界观地图 v3

虚构奇幻 / 小说设定的层级地图。Agent 通过 HTTP 或 MCP 造图、改图；人在网页上查看，并做轻量校正。两边写的是同一个 SQLite，没有单独的发布步骤。

旧实现（ECharts + JSON 文件）在 git 分支 **`old`**。本分支是全新 TypeScript 重建，**不迁移、不兼容旧 JSON**。

## 从零启动

需要 Node.js 22 或更高版本。在仓库根目录：

```bash
npm install
npm run seed
npm start
```

`npm start` 会先构建前端，再启动服务。

- 地图：http://127.0.0.1:3780
- OpenAPI：http://127.0.0.1:3780/docs
- 健康检查：http://127.0.0.1:3780/health

第一次 `npm run seed` 会在终端打印三把 API Key。**明文只出现这一次**，数据库里只有 SHA-256 哈希。`editor` 可以查、增、改、删（网页校正和 MCP 都用它）；`admin` 才能回滚和签发钥匙。

开发时热更新：

```bash
npm run seed
npm run dev
```

API 在 3780，Vite 在 http://127.0.0.1:5173 ，并把 `/api` 代理过去。

MCP（stdio，与 HTTP 打开同一个数据库文件）：

```bash
WORLDVIEW_API_KEY='刚才打印的 wm_...' npm run mcp
```

再发一把钥匙：

```bash
npm run key:create -- writer read,write
npm run seed -- --reset-keys   # 吊销现有钥匙并重新打印
```

数据库默认在 `data/worldview.sqlite`（已 gitignore）。可用环境变量 `PORT`、`WORLDVIEW_DB`、`RATE_LIMIT_PER_MIN`、`SNAPSHOT_LIMIT`、`PLACE_CONFLICT_DISTANCE` 覆盖。

## 架构

```
src/shared        坐标、层级、tile 类型（前后端共用）
src/db            Drizzle schema + SQL 迁移
src/domain        区域 / 地点 / 室内 / 快照 / API Key
src/http          Fastify 路由，只做校验和鉴权
src/mcp           MCP 工具，调用同一套 WorldService
web               Vite + WebGL2 画布
```

迁移用 **Drizzle ORM + drizzle-kit**，SQL 在 `drizzle/0000_init.sql`。运行时用 `better-sqlite3`，文件库开启 WAL，所以 HTTP 进程和 MCP 进程可以同时开着。

不使用 ECharts、Leaflet、MapLibre。底图不是真实地理。

## 层级与坐标

`continent → city → district → building_group → building`

每一层的多边形和地点都写在**该层自己的局部平面**里，y 向下，常用范围大约 0–1000，不是经纬度。画布只画当前区域的直接子级和直接地点，避免上下层叠在一起抢点击。进入建筑后改画室内格子，退出回到建筑群。

人在网页上可以改名称、描述、标签和地点坐标，也可以拖动地点，或按住 Shift 拖动区域做整体平移。第一期不做逐顶点编辑。

## 文档

- [领域模型](docs/DOMAIN.md)
- [鉴权](docs/AUTH.md)
- [MCP 与 OpenAPI 对照](docs/MCP.md)
- [验收清单](docs/ACCEPTANCE.md)

## 测试

```bash
npm test
npm run typecheck
```
