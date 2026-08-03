// ============================================================
// routes/versions.js - 版本控制路由
// 支持版本列表、详情查看、回滚到历史版本
// ============================================================

const express = require('express');
const router = express.Router();
const { versions, logs } = require('../db');
const { authMiddleware } = require('../middleware/auth');

// 获取版本列表
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
      locationCount: v.snapshot?.locations?.length || 0,
      featureCount: v.snapshot?.geojson?.features?.length || 0,
    })),
  });
});

// 获取特定版本详情（含快照）
router.get('/:version', (req, res) => {
  const ver = versions.getById(parseInt(req.params.version, 10));
  if (!ver) {
    return res.status(404).json({
      error: 'NOT_FOUND',
      message: `版本 ${req.params.version} 不存在`,
    });
  }
  res.json({ success: true, data: ver });
});

// 回滚到指定版本
router.post('/:version/rollback', authMiddleware, (req, res) => {
  const versionNum = parseInt(req.params.version, 10);
  const target = versions.getById(versionNum);
  if (!target) {
    return res.status(404).json({
      error: 'NOT_FOUND',
      message: `版本 ${versionNum} 不存在`,
    });
  }

  const restored = versions.rollback(versionNum);

  logs.add({
    agentName: req.agent.agentName,
    action: 'rollback',
    targetType: 'version',
    targetId: String(versionNum),
    details: {
      description: target.description,
      restoredLocations: target.snapshot?.locations?.length || 0,
      restoredFeatures: target.snapshot?.geojson?.features?.length || 0,
    },
    context: req.body?.context || `Agent ${req.agent.agentName} 回滚到版本 ${versionNum}`,
  });

  // 回滚后创建新版本快照标记
  versions.createSnapshot(`从版本 ${versionNum} 回滚`, req.agent.agentName);

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
  const snapshot = versions.createSnapshot(
    req.body.description || '手动快照',
    req.agent.agentName
  );

  logs.add({
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
