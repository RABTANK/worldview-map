// ============================================================
// config.js - 集中配置模块
// 所有可配置项通过环境变量覆盖，避免硬编码散落各处
// ============================================================

const path = require('path');

module.exports = {
  // ---- 服务 ----
  port: parseInt(process.env.PORT, 10) || 3000,
  host: process.env.HOST || '0.0.0.0',

  // ---- 数据 ----
  dataDir: path.join(__dirname, 'data'),
  snapshotDir: path.join(__dirname, 'data', 'snapshots'),
  coordConflictThreshold: parseFloat(process.env.COORD_CONFLICT_THRESHOLD) || 15,
  logMaxEntries: parseInt(process.env.LOG_MAX_ENTRIES, 10) || 1000,
  maxSnapshotCount: parseInt(process.env.MAX_SNAPSHOTS, 10) || 50,

  // ---- 请求 ----
  bodyLimit: process.env.BODY_LIMIT || '10mb',
  rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000, // 15分钟
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,

  // ---- 鉴权 ----
  // 读接口是否需要鉴权 (默认 false = 公开读取，设为 true 则所有接口均需 Key)
  requireReadAuth: process.env.REQUIRE_READ_AUTH === 'true',
  // 默认 API Key (仅在 api-keys.json 不存在时写入)
  defaultWriterKey: process.env.DEFAULT_WRITER_KEY || 'writer-agent-key-001',
  defaultRpaKey: process.env.DEFAULT_RPA_KEY || 'rpa-agent-key-001',
  defaultViewerKey: process.env.DEFAULT_VIEWER_KEY || 'viewer-key-001',
  defaultAdminKey: process.env.DEFAULT_ADMIN_KEY || 'admin-agent-key-001',

  // ---- CORS ----
  corsOrigin: process.env.CORS_ORIGIN || '*',

  // ---- 校验 ----
  coordMin: 0,
  coordMax: 1000,
  maxNameLength: 100,
  maxDescriptionLength: 5000,
  maxPolygonPoints: 500,
};
