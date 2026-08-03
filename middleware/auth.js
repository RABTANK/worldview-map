// ============================================================
// middleware/auth.js - API Key 鉴权中间件
// 为不同 Agent 分配独立 API Key，记录操作日志，防止误操作
// ============================================================

const { apiKeys } = require('../db');

/**
 * 鉴权中间件
 * GET 请求使用 viewer-key 公开访问
 * POST/PUT/DELETE 需要有效的 API Key 及对应权限
 */
function authMiddleware(req, res, next) {
  // GET 请求允许公开访问（前端浏览流）
  if (req.method === 'GET') {
    req.agent = { agentName: 'anonymous', role: 'viewer', permissions: ['read'] };
    return next();
  }

  // 写操作需要 API Key
  const apiKey = req.headers['x-api-key'] || req.headers['X-API-Key'];

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

module.exports = { authMiddleware };
