// ============================================================
// services/memory.js - Agent 记忆服务 (v2)
// 修复清单:
//   1. 所有写路由统一通过 remember() 记录日志 (单一收口)
//   2. 统计使用 Map 避免原型污染 (constructor 问题)
//   3. recall 限制条数校验
// ============================================================

const { logs, versions } = require('../db');

/**
 * 记录 Agent 操作到记忆库 (唯一日志写入收口)
 * 所有路由应调用此函数而非直接 logs.add()
 * @param {Object} entry - 操作记录
 * @returns {Object} 记忆记录
 */
function remember(entry) {
  const log = logs.add(entry);

  // TODO: 集成 Zep 记忆库
  // 当 Zep 服务可用时，将操作上下文同步写入 Zep
  // 示例:
  // if (process.env.ZEP_API_URL) {
  //   await zepClient.memory.addMemory({
  //     sessionId: entry.agentName,
  //     memory: entry.context,
  //     metadata: { action: entry.action, target: entry.targetId }
  //   });
  // }

  return log;
}

/**
 * 检索 Agent 的记忆时间线
 * @param {string} agentName - Agent 名称（可选，不传则返回全部）
 * @param {number} limit - 返回条数限制
 * @returns {Array} 时间线
 */
function recall(agentName, limit = 50) {
  const filter = {};
  if (agentName) filter.agentName = agentName;
  // 钳制 limit
  const parsedLimit = parseInt(limit, 10);
  if (!isNaN(parsedLimit) && parsedLimit >= 0) {
    filter.limit = parsedLimit;
  }

  return logs.getAll(filter).map((log) => ({
    id: log.id,
    timestamp: log.timestamp,
    agent: log.agentName,
    action: log.action,
    target: `${log.targetType}:${log.targetId}`,
    context: log.context,
    details: log.details,
  }));
}

/**
 * 获取世界观演变摘要
 * 返回各类操作的统计信息
 * 关键修复: 使用 Map 避免原型污染 (如 action 名为 "constructor")
 * @returns {Object} 摘要
 */
function getWorldviewSummary() {
  const allLogs = logs.getAll({});
  const allVersions = versions.getAll();

  // 使用 Map 避免原型链上的属性被误访问
  const byAction = new Map();
  const byAgent = new Map();

  for (const log of allLogs) {
    byAction.set(log.action, (byAction.get(log.action) || 0) + 1);
    byAgent.set(log.agentName, (byAgent.get(log.agentName) || 0) + 1);
  }

  return {
    totalOperations: allLogs.length,
    totalVersions: allVersions.length,
    byAction: Object.fromEntries(byAction),
    byAgent: Object.fromEntries(byAgent),
    latestVersion: allVersions[0]?.version || 0,
    latestOperation: allLogs[0]?.timestamp || null,
  };
}

module.exports = { remember, recall, getWorldviewSummary };
