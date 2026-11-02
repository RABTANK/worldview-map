# 领域模型

坐标都是局部平面，y 向下为正。区域的 `geometry` 表达在**父区域**的坐标系里；地点的 `x/y` 表达在**它所挂的那个区域**的坐标系里。看「银港」时，画的是银港的子区和银港自己的地点，不是银港在大陆上的那个多边形。

层级只能逐级嵌套，不能跳级：

| level | 中文 | 父级 |
| --- | --- | --- |
| continent | 大陆 | 无 |
| city | 城市 | continent |
| district | 区域 | city |
| building_group | 建筑群 | district |
| building | 建筑 | building_group |

## regions

| 字段 | 含义 |
| --- | --- |
| id | 服务端生成的 UUID，或调用方提供的 `[A-Za-z0-9_-]{1,80}` |
| parent_id | 父区域，大陆为空 |
| level | 上表之一 |
| name / description / tags | 名称 1–80，描述最长 4000，标签最多 12 个、每个 24 字 |
| geometry | JSON Polygon，3–64 个点，坐标约在 ±100000 内 |
| fill / stroke | `#RGB` 或 `#RRGGBB` |
| sort_order | 同层排序 |

删除区域会同时删掉它自己的地点和室内楼层。若还有子区域，必须 `cascade=true`，并且 `confirm=true`。删除前自动做快照。

## places

挂在某个区域上。`kind` 是 1–32 位的 `a-z0-9_-`，默认 `landmark`。同一区域里两点距离小于 `PLACE_CONFLICT_DISTANCE`（默认 8）会返回 `CONFLICT`，除非 `ignoreConflict=true`。范围查询必须同时给 `minX/minY/maxX/maxY`。

## indoor_floors / indoor_tiles

只有 `building` 能有楼层。`width/height` 为 1–64。`floor_index` 在同一建筑内唯一，允许 -20 到 200。

tile 整层替换。请求里没出现的格子就是空的。类型：

`floor_wood` `floor_stone` `wall` `door` `stairs` `window` `furniture` `lamp` `rug` `water`

同一层同一 `(x,y)` 不能重复。

## snapshots

载荷是当时的区域、地点、楼层、tile，**不含 API Key，也不含操作日志**。`reason` 为 `manual`，或 `auto:before_delete`、`auto:before_rollback`。

默认策略：

- 手动快照：`POST /api/snapshots` 或 MCP `map_create_snapshot`（write）
- 自动快照：删除区域之前、回滚之前
- 普通改名、改地点、改 tile **不会**自动快照
- 总数上限默认 30（`SNAPSHOT_LIMIT`）。超出时先删最旧的自动快照，再删最旧的手动快照，刚创建的那条保留

回滚会先自动备份当前世界，再整库替换世界表。需要 `admin` 和 `confirm=true`。回滚后下一次读取就是恢复后的状态。

## audit_logs

每次写操作记一条：谁、做了什么、对象、可选的快照 id。不记录密钥明文。

## api_keys

见 [AUTH.md](AUTH.md)。

## 迁移

Schema 在 `src/db/schema.ts`，由 Drizzle Kit 生成，SQL 在 `drizzle/0000_init.sql`。语句顺序调整过：`regions` 必须先于引用它的 `places` 和 `indoor_floors`，否则 SQLite 在开启外键时无法建表。启动、seed、测试都会自动执行迁移。
