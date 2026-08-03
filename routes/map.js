// ============================================================
// routes/map.js - 地图结构路由
// 管理 GeoJSON 地图区域（底图图层）
// ============================================================

const express = require('express');
const router = express.Router();
const { map, logs, versions } = require('../db');
const { authMiddleware } = require('../middleware/auth');
const { validateGeoJSONFeature } = require('../middleware/validation');

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
  const feature = {
    ...req.body,
    properties: {
      ...req.body.properties,
      id: req.body.properties.id || `region_${Date.now()}`,
      createdAt: new Date().toISOString(),
    },
  };
  map.addFeature(feature);

  logs.add({
    agentName: req.agent.agentName,
    action: 'map_update',
    targetType: 'map',
    targetId: feature.properties.id,
    details: { name: feature.properties.name, featureType: feature.geometry.type },
    context: req.body.context || `Agent ${req.agent.agentName} 新增了区域 "${feature.properties.name}"`,
  });

  res.status(201).json({
    success: true,
    message: `区域 "${feature.properties.name}" 创建成功`,
    data: feature,
  });
});

// 更新地图区域
router.put('/features/:id', authMiddleware, (req, res) => {
  const existing = map.getFeatureById(req.params.id);
  if (!existing) {
    return res.status(404).json({
      error: 'NOT_FOUND',
      message: `区域 ID "${req.params.id}" 不存在`,
    });
  }

  const updated = map.updateFeature(req.params.id, req.body);

  logs.add({
    agentName: req.agent.agentName,
    action: 'map_update',
    targetType: 'map',
    targetId: req.params.id,
    details: { before: existing.properties?.name, after: updated.properties?.name },
    context: req.body.context || `Agent ${req.agent.agentName} 更新了区域`,
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

  map.removeFeature(req.params.id);

  logs.add({
    agentName: req.agent.agentName,
    action: 'map_update',
    targetType: 'map',
    targetId: req.params.id,
    details: { name: existing.properties?.name },
    context: req.body?.context || `Agent ${req.agent.agentName} 删除了区域 "${existing.properties?.name}"`,
  });

  res.json({
    success: true,
    message: `区域 "${existing.properties?.name}" 已删除`,
  });
});

// 批量替换整个地图结构（高级操作）
router.put('/structure', authMiddleware, (req, res) => {
  if (!req.body.type || req.body.type !== 'FeatureCollection') {
    return res.status(422).json({
      error: 'VALIDATION_ERROR',
      message: '需要提供有效的 GeoJSON FeatureCollection',
    });
  }

  map.replaceAll(req.body);

  logs.add({
    agentName: req.agent.agentName,
    action: 'map_update',
    targetType: 'map',
    targetId: 'all',
    details: { featureCount: req.body.features?.length || 0 },
    context: req.body.context || `Agent ${req.agent.agentName} 替换了整个地图结构`,
  });

  versions.createSnapshot('替换地图结构', req.agent.agentName);

  res.json({
    success: true,
    message: '地图结构已更新',
    data: map.getStructure(),
  });
});

module.exports = router;
