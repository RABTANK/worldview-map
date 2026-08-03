// ============================================================
// routes/locations.js - 地点 CRUD 路由
// 提供查询、创建、更新、删除地点的 RESTful API
// ============================================================

const express = require('express');
const router = express.Router();
const { locations, logs, versions } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { validateLocationCreate, validateLocationUpdate } = require('../middleware/validation');

// ============================================================
// 查询接口（公开读取）
// ============================================================

// 获取全量地点列表（支持按 type / tag 筛选）
router.get('/', (req, res) => {
  const { type, tag } = req.query;
  const result = locations.getAll({ type, tag });
  res.json({
    success: true,
    count: result.length,
    data: result,
  });
});

// 获取指定坐标范围内的地点
router.get('/range', (req, res) => {
  const { x1, y1, x2, y2 } = req.query;
  if ([x1, y1, x2, y2].some((v) => v === undefined)) {
    return res.status(400).json({
      error: 'BAD_REQUEST',
      message: '需要提供 x1, y1, x2, y2 参数',
    });
  }
  const result = locations.getByRange(
    parseFloat(x1), parseFloat(y1),
    parseFloat(x2), parseFloat(y2)
  );
  res.json({
    success: true,
    count: result.length,
    data: result,
  });
});

// 获取特定地点详情
router.get('/:id', (req, res) => {
  const loc = locations.getById(req.params.id);
  if (!loc) {
    return res.status(404).json({
      error: 'NOT_FOUND',
      message: `地点 ID "${req.params.id}" 不存在`,
    });
  }
  res.json({ success: true, data: loc });
});

// ============================================================
// 写入接口（需 API Key 鉴权）
// ============================================================

// 新增地点（含冲突检测）
router.post('/', authMiddleware, validateLocationCreate, (req, res) => {
  const { coordinates, name } = req.body;

  // 冲突检测：坐标重叠检查
  const conflict = locations.checkConflict(coordinates);
  if (conflict) {
    return res.status(409).json({
      error: 'COORDINATE_CONFLICT',
      message: `坐标 [${coordinates}] 与现有地点 "${conflict.name}" (ID: ${conflict.id}) 过近，请重新选择位置`,
      conflictWith: { id: conflict.id, name: conflict.name, coordinates: conflict.coordinates },
    });
  }

  const loc = locations.create(req.body, req.agent.agentName);

  // 记录操作日志
  logs.add({
    agentName: req.agent.agentName,
    action: 'create',
    targetType: 'location',
    targetId: loc.id,
    details: { name: loc.name, coordinates: loc.coordinates, type: loc.type },
    context: req.body.context || `Agent ${req.agent.agentName} 创建了地点 "${loc.name}"`,
  });

  // 自动创建版本快照
  versions.createSnapshot(`新增地点: ${loc.name}`, req.agent.agentName);

  res.status(201).json({
    success: true,
    message: `地点 "${loc.name}" 创建成功`,
    data: loc,
  });
});

// 更新地点详情
router.put('/:id', authMiddleware, validateLocationUpdate, (req, res) => {
  const existing = locations.getById(req.params.id);
  if (!existing) {
    return res.status(404).json({
      error: 'NOT_FOUND',
      message: `地点 ID "${req.params.id}" 不存在`,
    });
  }

  // 如果更新了坐标，需要重新检测冲突
  if (req.body.coordinates) {
    const conflict = locations.checkConflict(req.body.coordinates, req.params.id);
    if (conflict) {
      return res.status(409).json({
        error: 'COORDINATE_CONFLICT',
        message: `新坐标与现有地点 "${conflict.name}" (ID: ${conflict.id}) 过近`,
        conflictWith: { id: conflict.id, name: conflict.name, coordinates: conflict.coordinates },
      });
    }
  }

  const updated = locations.update(req.params.id, req.body, req.agent.agentName);

  logs.add({
    agentName: req.agent.agentName,
    action: 'update',
    targetType: 'location',
    targetId: updated.id,
    details: { before: existing, after: updated },
    context: req.body.context || `Agent ${req.agent.agentName} 更新了地点 "${updated.name}"`,
  });

  res.json({
    success: true,
    message: `地点 "${updated.name}" 更新成功`,
    data: updated,
  });
});

// 删除地点
router.delete('/:id', authMiddleware, (req, res) => {
  const existing = locations.getById(req.params.id);
  if (!existing) {
    return res.status(404).json({
      error: 'NOT_FOUND',
      message: `地点 ID "${req.params.id}" 不存在`,
    });
  }

  locations.delete(req.params.id);

  logs.add({
    agentName: req.agent.agentName,
    action: 'delete',
    targetType: 'location',
    targetId: req.params.id,
    details: { name: existing.name, coordinates: existing.coordinates },
    context: req.body?.context || `Agent ${req.agent.agentName} 删除了地点 "${existing.name}"`,
  });

  versions.createSnapshot(`删除地点: ${existing.name}`, req.agent.agentName);

  res.json({
    success: true,
    message: `地点 "${existing.name}" 已删除`,
  });
});

module.exports = router;
