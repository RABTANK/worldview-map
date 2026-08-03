// ============================================================
// routes/logs.js - 操作日志路由
// 记录 Agent 的所有地图操作，形成世界观演变时间线
// ============================================================

const express = require('express');
const router = express.Router();
const { logs } = require('../db');
const { authMiddleware } = require('../middleware/auth');

// 未指定 limit 时的默认返回条数，防止一次性返回全部日志
const DEFAULT_LIMIT = 200;

/**
 * 应用分页限制（钳制逻辑）
 * - limit 未指定: 使用默认值 DEFAULT_LIMIT
 * - limit 为 NaN 或负数: 忽略限制，返回全部
 * - limit 为 0: 返回空数组
 * - limit 为正数: 钳制到实际结果长度
 *
 * @param {Array} result - 已排序/筛选后的结果集
 * @param {*} limitRaw - 原始 limit 查询参数
 * @returns {Array} 经过钳制后的结果
 */
function applyLimit(result, limitRaw) {
  // 未指定 limit: 使用默认值，并钳制到实际结果长度
  if (limitRaw === undefined || limitRaw === null || limitRaw === '') {
    return result.slice(0, Math.min(DEFAULT_LIMIT, result.length));
  }

  const limit = parseInt(limitRaw, 10);

  // NaN 或负数: 忽略限制，返回全部
  if (isNaN(limit) || limit < 0) {
    return result;
  }

  // 0: 返回空数组
  if (limit === 0) {
    return [];
  }

  // 正数: 钳制到实际结果长度
  return result.slice(0, Math.min(limit, result.length));
}

// 获取操作日志（支持按 Agent / 操作类型筛选）
router.get('/', (req, res) => {
  const { agentName, action, limit } = req.query;
  const filter = {};
  if (agentName) filter.agentName = agentName;
  if (action) filter.action = action;

  // 只把筛选条件传给 db，limit 的钳制逻辑统一在路由层处理
  const result = logs.getAll(filter);
  const data = applyLimit(result, limit);

  res.json({
    success: true,
    count: data.length,
    data,
  });
});

// 获取世界观演变时间线（格式化输出）
router.get('/timeline', (req, res) => {
  const { limit } = req.query;
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

  // 时间线同样尊重 limit 参数，使用相同的钳制逻辑
  const data = applyLimit(timeline, limit);

  res.json({
    success: true,
    count: data.length,
    data,
  });
});

module.exports = router;
