// ============================================================
// routes/versions.js - 版本控制路由
// 支持版本列表、详情查看、回滚到历史版本
// ============================================================

const express = require('express');
const router = express.Router();
const { versions } = require('../db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { remember } = require('../services/memory');

// 获取版本列表
// 注意: 快照数据现已独立存储，版本对象只保留元数据，
// 因此直接读取 v.locationCount / v.featureCount，不再访问 v.snapshot。
router.get('/', (req, res) => {
  const all = versions.getAll();
  res.json({
    success: true,
    count: all.length,
    data: all.map((v) => ({
      version: v.version,
      description: v.description,
      createdAt: v.createdAt,
      createdBy: v.createdBy,
      isMilestone: v.isMilestone,
      locationCount: v.locationCount || 0,
      featureCount: v.featureCount || 0,
    })),
  });
});

// 获取特定版本详情（含快照）
// 快照数据存储在独立文件中，需要单独加载并合并到版本元数据响应里。
router.get('/:version', (req, res) => {
  const versionNum = parseInt(req.params.version, 10);
  const ver = versions.getById(versionNum);
  if (!ver) {
    return res.status(404).json({
      error: 'NOT_FOUND',
      message: `版本 ${req.params.version} 不存在`,
    });
  }

  // 从独立文件加载快照数据并合并到版本元数据中
  const snapshotData = versions.getSnapshotData(versionNum);
  const data = { ...ver, snapshot: snapshotData };

  res.json({ success: true, data });
});

// 回滚到指定版本
// 需要管理员权限 (adminMiddleware 在 authMiddleware 之后执行)
router.post('/:version/rollback', authMiddleware, adminMiddleware, (req, res) => {
  const versionNum = parseInt(req.params.version, 10);
  const target = versions.getById(versionNum);
  if (!target) {
    return res.status(404).json({
      error: 'NOT_FOUND',
      message: `版本 ${versionNum} 不存在`,
    });
  }

  // 回滚可能因快照数据文件缺失而失败，需要捕获异常
  let restored;
  try {
    restored = versions.rollback(versionNum);
  } catch (err) {
    return res.status(500).json({
      error: 'ROLLBACK_FAILED',
      message: `回滚失败：${err.message}`,
    });
  }

  remember({
    agentName: req.agent.agentName,
    action: 'rollback',
    targetType: 'version',
    targetId: String(versionNum),
    details: {
      description: target.description,
      restoredLocations: target.locationCount || 0,
      restoredFeatures: target.featureCount || 0,
    },
    context: req.body?.context || `Agent ${req.agent.agentName} 回滚到版本 ${versionNum}`,
  });

  // 回滚后创建新的里程碑快照，记录回滚后的状态
  versions.createSnapshot(
    `从版本 ${versionNum} 回滚后的状态`,
    req.agent.agentName,
    true
  );

  res.json({
    success: true,
    message: `已回滚到版本 ${versionNum}`,
    data: {
      version: versionNum,
      description: target.description,
      restoredAt: new Date().toISOString(),
    },
  });
});

// 手动创建版本快照
router.post('/snapshot', authMiddleware, (req, res) => {
  // 第三个参数 true 标记为里程碑快照
  const snapshot = versions.createSnapshot(
    req.body.description || '手动快照',
    req.agent.agentName,
    true
  );

  remember({
    agentName: req.agent.agentName,
    action: 'snapshot',
    targetType: 'version',
    targetId: String(snapshot.version),
    details: { description: snapshot.description },
    context: `Agent ${req.agent.agentName} 创建了版本快照`,
  });

  res.status(201).json({
    success: true,
    message: `版本快照 v${snapshot.version} 创建成功`,
    data: {
      version: snapshot.version,
      description: snapshot.description,
      createdAt: snapshot.createdAt,
    },
  });
});

module.exports = router;
