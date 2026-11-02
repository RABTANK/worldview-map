# MCP 与 HTTP

MCP 工具和 HTTP 路由都调用 `WorldService` / `KeyService`，没有第二套写入实现。本地启动：

```bash
WORLDVIEW_API_KEY='wm_...' npm run mcp
```

传输是 stdio。数据库路径与 HTTP 相同（`WORLDVIEW_DB` 或 `data/worldview.sqlite`）。

种子里的 `editor` 钥匙含 `read`、`write`、`delete`，可以完成区域、地点、道路、室内楼层的增删改查。`viewer` 只能查。回滚额外要求 `admin`。

区域 `geometry` 使用 `Polygon`，允许 3–64 个点；道路 `geometry` 使用 `LineString`，允许 2–256 个点。二者都使用所属父区域或区域的局部平面坐标。

危险工具在描述里要求 `confirm: true`。不传或传 `false` 时返回 `isError`，且不改数据。

| MCP 工具 | 权限 | HTTP |
| --- | --- | --- |
| map_list_children | read | `GET /api/regions?parentId=` |
| map_get_region | read | `GET /api/regions/{id}` |
| map_create_region | write | `POST /api/regions` |
| map_update_region | write | `PATCH /api/regions/{id}` |
| map_delete_region | delete，confirm，有子级时 cascade | `DELETE /api/regions/{id}?confirm=true&cascade=true` |
| map_list_locations | read | `GET /api/places` |
| map_get_location | read | `GET /api/places/{id}` |
| map_upsert_location | write | `POST /api/places`；id 已存在时等同局部更新 |
| map_update_location | write | `PATCH /api/places/{id}` |
| map_delete_location | delete，confirm | `DELETE /api/places/{id}?confirm=true` |
| map_list_routes | read | `GET /api/routes?regionId=&q=` |
| map_get_route | read | `GET /api/routes/{id}` |
| map_create_route | write | `POST /api/routes` |
| map_update_route | write | `PATCH /api/routes/{id}` |
| map_delete_route | delete，confirm | `DELETE /api/routes/{id}?confirm=true` |
| map_get_context | read | `GET /api/map/view` 或 `GET /api/regions/{id}/context` |
| map_search | read | `GET /api/search?q=` |
| map_list_floors | read | `GET /api/buildings/{id}/floors` |
| map_get_floor | read | `GET /api/floors/{id}` |
| map_upsert_floor | write | `POST /api/buildings/{id}/floors` 或 `PATCH /api/floors/{id}` |
| map_set_tiles | write | `PUT /api/floors/{id}/tiles` |
| map_delete_floor | delete，confirm | `DELETE /api/floors/{id}?confirm=true` |
| map_create_snapshot | write | `POST /api/snapshots` |
| map_list_snapshots | read | `GET /api/snapshots` |
| map_rollback_snapshot | admin，confirm | `POST /api/snapshots/{id}/rollback` |

`map_get_context` 的 `summary` 用中文说明当前层有哪些直接子级、地点和道路，并提醒坐标不是经纬度。Agent 续写时应先取上下文，再只改这一层。删除区域会一并清理该区域及子区域的道路。

OpenAPI 源文件是 `src/http/openapi.ts`，运行时在 `/api/openapi.json`，浏览页是 `/docs`。
