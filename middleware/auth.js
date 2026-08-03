// ============================================================
// middleware/auth.js - API Key 鉴权中间件 (v2)
// 修复清单:
//   1. 移除死代码 (大写 header 分支, Node headers 永远小写)
//   2. 读接口可配置鉴权 (REQUIRE_READ_AUTH)
//   3. 管理员权限 (admin): 回滚 + 整图替换需要
//   4. 密钥验证走 db.js 的恒定时间哈希比较
// ============================================================

const { apiKeys } = require('../db');
const config = require('../config');

/**
 * 鉴权中间件
 * GET 请求默认公开 (可通过 REQUIRE_READ_AUTH=true 关闭)
 * POST/PUT/DELETE 需要有效的 API Key 及对应权限
 * 回滚和整图替换需要 admin 权限
 */
function authMiddleware(req, res, next) {
  // GET 请求: 根据配置决定是否需要鉴权
  if (req.method === 'GET') {
    if (!config.requireReadAuth) {
      req.agent = { agentName: 'anonymous', role: 'viewer', permissions: ['read'] };
      return next();
    }
    // 需要鉴权时, 继续往下走验证 Key
  }

  // 写操作需要 API Key (Node 请求头键名一律小写, 不需要大写兜底)
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: '缺少 API Key，请在请求头中提供 X-API-Key',
    });
  }

  const keyInfo = apiKeys.validate(apiKey);
  if (!keyInfo) {
    return res.status(401).json({
      error: 'INVALID_API_KEY',
      message: 'API Key 无效',
    });
  }

  // 权限映射
  const methodToPermission = {
    POST: 'write',
    PUT: 'write',
    DELETE: 'delete',
    PATCH: 'write',
    GET: 'read',
  };

  const requiredPermission = methodToPermission[req.method];
  if (requiredPermission && !apiKeys.hasPermission(keyInfo, requiredPermission)) {
    return res.status(403).json({
      error: 'FORBIDDEN',
      message: `Agent "${keyInfo.agentName}" 没有 ${requiredPermission} 权限`,
    });
  }

  req.agent = keyInfo;
  next();
}

/**
 * 管理员权限中间件
 * 用于回滚版本、整图替换等毁灭级操作
 */
function adminMiddleware(req, res, next) {
  if (!req.agent || !apiKeys.hasPermission(req.agent, 'admin')) {
    return res.status(403).json({
      error: 'FORBIDDEN',
      message: '此操作需要管理员权限 (admin)',
    });
  }
  next();
}

module.exports = { authMiddleware, adminMiddleware };
