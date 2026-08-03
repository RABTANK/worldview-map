// ============================================================
// routes/map.js - 地图结构路由
// 管理 GeoJSON 地图区域（底图图层）
// ============================================================

const express = require('express');
const router = express.Router();
const { map, logs, versions } = require('../db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { validateGeoJSONFeature, validateGeoJSONFeatureUpdate } = require('../middleware/validation');
const { remember } = require('../services/memory');

// 获取全量地图结构 (GeoJSON)
router.get('/structure', (req, res) => {
  res.json({
    success: true,
    data: map.getStructure(),
  });
});

// 获取图层列表
router.get('/layers', (req, res) => {
  const features = map.getFeatures();
  const layers = features.map((f) => ({
    id: f.properties?.id,
    name: f.properties?.name,
    type: f.properties?.type || 'region',
    visible: true,
  }));
  res.json({
    success: true,
    count: layers.length,
    data: layers,
  });
});

// 获取单个区域详情
router.get('/features/:id', (req, res) => {
  const feature = map.getFeatureById(req.params.id);
  if (!feature) {
    return res.status(404).json({
      error: 'NOT_FOUND',
      message: `区域 ID "${req.params.id}" 不存在`,
    });
  }
  res.json({ success: true, data: feature });
});

// 新增地图区域 (Feature)
router.post('/features', authMiddleware, validateGeoJSONFeature, (req, res) => {
  // 提取 context 仅用于日志，不透传到数据层
  const { context, ...featureData } = req.body;
  const id = req.body.properties.id || require('uuid').v4();

  // 重复 ID 检查
  if (map.featureIdExists(id)) {
    return res.status(409).json({
      error: 'CONFLICT',
      message: `区域 ID "${id}" 已存在`,
    });
  }

  const feature = {
    ...featureData,
    properties: {
      ...req.body.properties,
      id: id,
      createdAt: new Date().toISOString(),
    },
  };

  // 修改前拍快照 ("即将执行" 语义)
  versions.createSnapshot(`即将执行: 新增区域 "${feature.properties.name}"`, req.agent.agentName);

  map.addFeature(feature);

  remember({
    agentName: req.agent.agentName,
    action: 'map_update',
    targetType: 'map',
    targetId: feature.properties.id,
    details: { name: feature.properties.name, featureType: feature.geometry.type },
    context: context || `Agent ${req.agent.agentName} 新增了区域 "${feature.properties.name}"`,
  });

  res.status(201).json({
    success: true,
    message: `区域 "${feature.properties.name}" 创建成功`,
    data: feature,
  });
});

// 更新地图区域
router.put('/features/:id', authMiddleware, validateGeoJSONFeatureUpdate, (req, res) => {
  const existing = map.getFeatureById(req.params.id);
  if (!existing) {
    return res.status(404).json({
      error: 'NOT_FOUND',
      message: `区域 ID "${req.params.id}" 不存在`,
    });
  }

  // 提取 context 仅用于日志，不透传到数据层
  const { context, ...updateData } = req.body;

  // 修改前拍快照 ("即将执行" 语义)
  versions.createSnapshot(`即将执行: 更新区域 "${req.params.id}"`, req.agent.agentName);

  const updated = map.updateFeature(req.params.id, updateData);

  remember({
    agentName: req.agent.agentName,
    action: 'map_update',
    targetType: 'map',
    targetId: req.params.id,
    details: { before: existing.properties?.name, after: updated.properties?.name },
    context: context || `Agent ${req.agent.agentName} 更新了区域`,
  });

  res.json({
    success: true,
    message: '区域更新成功',
    data: updated,
  });
});

// 删除地图区域
router.delete('/features/:id', authMiddleware, (req, res) => {
  const existing = map.getFeatureById(req.params.id);
  if (!existing) {
    return res.status(404).json({
      error: 'NOT_FOUND',
      message: `区域 ID "${req.params.id}" 不存在`,
    });
  }

  // 提取 context 仅用于日志，不透传到数据层
  const context = req.body?.context;

  // 修改前拍快照 ("即将执行" 语义)
  versions.createSnapshot(`即将执行: 删除区域 "${existing.properties?.name}"`, req.agent.agentName);

  map.removeFeature(req.params.id);

  remember({
    agentName: req.agent.agentName,
    action: 'map_update',
    targetType: 'map',
    targetId: req.params.id,
    details: { name: existing.properties?.name },
    context: context || `Agent ${req.agent.agentName} 删除了区域 "${existing.properties?.name}"`,
  });

  res.json({
    success: true,
    message: `区域 "${existing.properties?.name}" 已删除`,
  });
});

// 批量替换整个地图结构（高级操作）
router.put('/structure', authMiddleware, adminMiddleware, (req, res) => {
  if (!req.body.type || req.body.type !== 'FeatureCollection') {
    return res.status(422).json({
      error: 'VALIDATION_ERROR',
      message: '需要提供有效的 GeoJSON FeatureCollection',
    });
  }

  // 提取 context 仅用于日志，不透传到数据层
  const { context, ...structureData } = req.body;

  // 修改前拍快照 ("即将执行" 语义)
  versions.createSnapshot(`即将执行: 替换整个地图结构`, req.agent.agentName);

  map.replaceAll(structureData);

  remember({
    agentName: req.agent.agentName,
    action: 'map_update',
    targetType: 'map',
    targetId: 'all',
    details: { featureCount: req.body.features?.length || 0 },
    context: context || `Agent ${req.agent.agentName} 替换了整个地图结构`,
  });

  res.json({
    success: true,
    message: '地图结构已更新',
    data: map.getStructure(),
  });
});

module.exports = router;
