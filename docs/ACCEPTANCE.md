# 第一期验收清单

先按 README 完成 `npm install`、`npm run seed`、`npm start`。种子世界是「折光海纪」：两块大陆，银港能下到「灯塔区 → 潮声坊 → 旧灯塔」，旧灯塔有门厅和灯室两层 tile。

自动化覆盖在 `npm test`（层级、冲突、哈希、回滚、HTTP 错误形状、限流、双连接可见性、MCP 真实调用、种子数据、依赖里没有 ECharts/Leaflet/MapLibre）。下面是人工主路径。

## 下钻

- [ ] 打开地图，粘贴 `editor` 钥匙，世界根能看到霜歌大陆和翠幕群岛
- [ ] 双击或侧栏进入：霜歌大陆 → 银港 → 灯塔区 → 潮声坊 → 旧灯塔
- [ ] 旧灯塔切换到室内格子，能看到墙、门、楼梯、灯
- [ ] 面包屑或「返回上级」回到潮声坊，此时只看到建筑多边形，不再叠室内格子
- [ ] 滚轮缩放、拖动空白平移，点选命中的是当前层的区域而不是更深层

## Agent 增删改

- [ ] `GET /api/map/view` 与 MCP `map_get_context` 都能读到种子
- [ ] MCP `map_upsert_location` 或 `POST /api/places` 能新增地点
- [ ] `map_update_region` / `PATCH` 能改名称
- [ ] `map_set_tiles` 或 `PUT /api/floors/{id}/tiles` 能改旧灯塔某一格
- [ ] 删除不带 `confirm=true` 会被拒绝，数据不变；带 confirm（区域还有子级时再加 cascade）才会删

## 人改立刻可见

- [ ] 网页改一个区域名称并保存
- [ ] 不重启服务，马上用另一把 read 钥匙 `GET /api/regions/{id}`，名称已是新的
- [ ] 用 API 或 MCP 再改描述，浏览器点「刷新」（或重新聚焦页面）后看到新描述
- [ ] 没有第二份草稿库或发布按钮

## 快照与回滚

- [ ] editor 钥匙可以 `POST /api/snapshots`
- [ ] editor 钥匙回滚得到 403
- [ ] admin 钥匙 `POST /api/snapshots/{id}/rollback`，body `{ "confirm": true }` 之后，读接口回到快照内容
- [ ] 回滚前自动多了一条 `auto:before_rollback` 快照

## 钥匙

- [ ] 数据库文件里搜不到完整的 `wm_...` 明文，只有哈希
- [ ] viewer 钥匙 `POST /api/regions` 得到 403
