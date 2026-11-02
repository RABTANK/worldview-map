# 鉴权

HTTP 与 MCP 的写操作、以及全部 `/api/*` 读操作都要 API Key。`/health`、`/docs`、`/api/openapi.json` 和前端静态文件公开。

请求头二选一：

```
Authorization: Bearer wm_...
X-API-Key: wm_...
```

## 明文只出现一次

创建钥匙时生成 `wm_` 加 32 字节随机串。库里保存的是 SHA-256 十六进制哈希，以及前 11 个字符作为前缀，方便辨认。列表、日志、错误响应都不含明文。丢了就再创建一把，不能从哈希还原。

```bash
npm run seed                 # 库里还没有钥匙时打印 viewer / editor / admin
npm run key:create -- editor read,write
npm run seed -- --reset-keys # 吊销后重发
```

网页把钥匙放在 **sessionStorage**，不写进仓库，也不提交到服务器日志。

MCP 从环境变量读取，不要写进命令历史以外的文件：

```bash
WORLDVIEW_API_KEY='wm_...' npm run mcp
```

## 权限

`admin` 隐含 read、write、delete。其余权限**不**互相包含：只会写的钥匙如果没有 read，就不能读。

| scope | 能做什么 |
| --- | --- |
| read | GET `/api/*` |
| write | 创建和更新区域、地点、楼层、tile、手动快照 |
| delete | 删除区域、地点、楼层。删除都要 `confirm=true`；删区域且有子级时还要 `cascade=true` |
| admin | 创建/列出/吊销钥匙，回滚快照 |

种子钥匙：

| 名称 | scopes | 给谁 |
| --- | --- | --- |
| viewer | read | 只看 |
| editor | read, write | 人网页校正、写作 Agent |
| admin | read, write, delete, admin | 回滚和发钥匙 |

无钥匙或钥匙无效：`401 UNAUTHORIZED`。钥匙有效但权限不够：`403 FORBIDDEN`。回滚在服务层再查一次 admin，不靠路由漏放。

## 限流和错误

每个进程内、每把钥匙每分钟默认 120 次（`RATE_LIMIT_PER_MIN`）。超限返回 `429 RATE_LIMITED`，带 `Retry-After`。无效钥匙按 IP 单独计数。HTTP 进程和 MCP 进程各有自己的内存计数器。

错误体只有：

```json
{ "error": { "code": "VALIDATION", "message": "..." } }
```

`code` 为 `VALIDATION`、`UNAUTHORIZED`、`FORBIDDEN`、`NOT_FOUND`、`CONFLICT`、`CONFIRMATION_REQUIRED`、`RATE_LIMITED`、`INTERNAL`。内部异常记在服务端日志，响应里不带堆栈。

Helmet 打开常见安全头（`nosniff`、frame 限制等）。为了 Swagger UI 的内联样式，没有启用严格 CSP。
