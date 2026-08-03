// ============================================================
// server.js - 交互式世界观地图系统 · 主服务器
// 三层架构：前端展示层 → 后端服务层 → 数据存储层
// ============================================================

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0'; // 监听所有网络接口，便于局域网/远程访问

// ---- 中间件 ----
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---- API 路由 ----
app.use('/api/locations', require('./routes/locations'));
app.use('/api/map', require('./routes/map'));
app.use('/api/versions', require('./routes/versions'));
app.use('/api/logs', require('./routes/logs'));

// ---- Agent 记忆接口 ----
const memory = require('./services/memory');

// 获取世界观演变摘要
app.get('/api/memory/summary', (req, res) => {
  res.json({ success: true, data: memory.getWorldviewSummary() });
});

// 检索 Agent 记忆时间线
app.get('/api/memory/timeline', (req, res) => {
  const { agent, limit } = req.query;
  const data = memory.recall(agent, limit ? parseInt(limit, 10) : 50);
  res.json({ success: true, count: data.length, data });
});

// ---- 系统接口 ----
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), service: 'worldview-map' });
});

// API 总览
app.get('/api', (req, res) => {
  res.json({
    name: '交互式世界观地图系统 API',
    version: '1.0.0',
    description: 'Agent 友好的动态世界观构建平台',
    endpoints: {
      locations: {
        'GET /api/locations': '获取全量地点列表 (支持 ?type= &tag= 筛选)',
        'GET /api/locations/range?x1=&y1=&x2=&y2=': '获取指定坐标范围内的地点',
        'GET /api/locations/:id': '获取特定地点详情',
        'POST /api/locations': '新增地点 (需 API Key, 含冲突检测)',
        'PUT /api/locations/:id': '更新地点详情 (需 API Key)',
        'DELETE /api/locations/:id': '删除地点 (需 API Key)',
      },
      map: {
        'GET /api/map/structure': '获取地图 GeoJSON 结构',
        'GET /api/map/layers': '获取图层列表',
        'GET /api/map/features/:id': '获取单个区域详情',
        'POST /api/map/features': '新增地图区域 (需 API Key)',
        'PUT /api/map/features/:id': '更新地图区域 (需 API Key)',
        'DELETE /api/map/features/:id': '删除地图区域 (需 API Key)',
        'PUT /api/map/structure': '批量替换地图结构 (需 API Key)',
      },
      versions: {
        'GET /api/versions': '获取版本列表',
        'GET /api/versions/:version': '获取版本详情 (含快照)',
        'POST /api/versions/:version/rollback': '回滚到指定版本 (需 API Key)',
        'POST /api/versions/snapshot': '手动创建版本快照 (需 API Key)',
      },
      logs: {
        'GET /api/logs': '获取操作日志 (支持 ?agentName= &action= &limit=)',
        'GET /api/logs/timeline': '获取世界观演变时间线',
      },
      memory: {
        'GET /api/memory/summary': '世界观演变摘要',
        'GET /api/memory/timeline': 'Agent 记忆时间线 (支持 ?agent= &limit=)',
      },
    },
    auth: '写操作需在请求头携带 X-API-Key',
    coordinateSystem: '统一相对坐标系 (0-1000 平面坐标)',
  });
});

// ---- 全局错误处理 ----
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({
    error: 'INTERNAL_ERROR',
    message: '服务器内部错误',
    detail: err.message,
  });
});

// ---- 启动服务 ----
app.listen(PORT, HOST, () => {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║    交互式世界观地图系统 · 服务已启动              ║');
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  监听地址:  ${HOST}:${PORT}                      ║`);
  console.log(`║  本机访问:  http://localhost:${PORT}                ║`);
  console.log(`║  局域网:    http://<本机IP>:${PORT}                ║`);
  console.log(`║  API 总览:  http://localhost:${PORT}/api            ║`);
  console.log(`║  健康检查:  http://localhost:${PORT}/api/health     ║`);
  console.log('╚══════════════════════════════════════════════════╝');
});
