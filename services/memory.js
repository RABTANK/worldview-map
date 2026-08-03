// ============================================================
// services/memory.js - Agent 记忆服务
// 提供与 Zep 记忆库的集成接口，记录世界观演变历史
// 当前实现为本地存储，可平滑切换到 Zep 远程服务
// ============================================================

const { logs, versions } = require('../db');

/**
 * 记录 Agent 操作到记忆库
 * @param {Object} entry - 操作记录
 * @param {string} entry.agentName - Agent 名称
 * @param {string} entry.action - 操作类型
 * @param {string} entry.targetType - 目标类型
 * @param {string} entry.targetId - 目标 ID
 * @param {Object} entry.details - 操作详情
 * @param {string} entry.context - 操作上下文/原因
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
  if (limit) filter.limit = limit;

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
 * @returns {Object} 摘要
 */
function getWorldviewSummary() {
  const allLogs = logs.getAll({});
  const allVersions = versions.getAll();

  const stats = {
    totalOperations: allLogs.length,
    totalVersions: allVersions.length,
    byAction: {},
    byAgent: {},
    latestVersion: allVersions[0]?.version || 0,
    latestOperation: allLogs[0]?.timestamp || null,
  };

  for (const log of allLogs) {
    stats.byAction[log.action] = (stats.byAction[log.action] || 0) + 1;
    stats.byAgent[log.agentName] = (stats.byAgent[log.agentName] || 0) + 1;
  }

  return stats;
}

module.exports = { remember, recall, getWorldviewSummary };
