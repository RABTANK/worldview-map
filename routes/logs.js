// ============================================================
// routes/logs.js - 操作日志路由
// 记录 Agent 的所有地图操作，形成世界观演变时间线
// ============================================================

const express = require('express');
const router = express.Router();
const { logs } = require('../db');
const { authMiddleware } = require('../middleware/auth');

// 获取操作日志（支持按 Agent / 操作类型筛选）
router.get('/', (req, res) => {
  const { agentName, action, limit } = req.query;
  const filter = {};
  if (agentName) filter.agentName = agentName;
  if (action) filter.action = action;
  if (limit) filter.limit = parseInt(limit, 10);

  const result = logs.getAll(filter);
  res.json({
    success: true,
    count: result.length,
    data: result,
  });
});

// 获取世界观演变时间线（格式化输出）
router.get('/timeline', (req, res) => {
  const allLogs = logs.getAll({});
  const timeline = allLogs.map((log) => {
    const actionMap = {
      create: '创建',
      update: '更新',
      delete: '删除',
      rollback: '回滚',
      map_update: '地图变更',
      snapshot: '快照',
    };
    return {
      timestamp: log.timestamp,
      agent: log.agentName,
      action: actionMap[log.action] || log.action,
      target: log.targetId,
      description: log.context,
      details: log.details,
    };
  });
  res.json({
    success: true,
    count: timeline.length,
    data: timeline,
  });
});

module.exports = router;
