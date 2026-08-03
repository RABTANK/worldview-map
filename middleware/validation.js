// ============================================================
// middleware/validation.js - 数据校验中间件
// 坐标范围校验、必填字段校验、类型校验
// ============================================================

const VALID_TYPES = [
  'city', 'village', 'fortress', 'port', 'ruins',
  'tower', 'forge', 'landmark', 'dungeon', 'camp', 'shrine', 'other'
];

const COORD_MIN = 0;
const COORD_MAX = 1000;

/**
 * 校验地点创建数据
 */
function validateLocationCreate(req, res, next) {
  const { name, coordinates, type } = req.body;
  const errors = [];

  // 必填字段
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    errors.push('name 为必填项，且为非空字符串');
  }
  if (name && name.length > 100) {
    errors.push('name 长度不能超过 100 个字符');
  }

  // 坐标校验
  if (!coordinates || !Array.isArray(coordinates) || coordinates.length !== 2) {
    errors.push('coordinates 为必填项，格式为 [x, y]');
  } else {
    const [x, y] = coordinates;
    if (typeof x !== 'number' || typeof y !== 'number') {
      errors.push('coordinates 中的 x 和 y 必须为数字');
    } else {
      if (x < COORD_MIN || x > COORD_MAX) {
        errors.push(`坐标 x 必须在 ${COORD_MIN}-${COORD_MAX} 范围内`);
      }
      if (y < COORD_MIN || y > COORD_MAX) {
        errors.push(`坐标 y 必须在 ${COORD_MIN}-${COORD_MAX} 范围内`);
      }
    }
  }

  // 类型校验
  if (type && !VALID_TYPES.includes(type)) {
    errors.push(`type 必须为以下值之一: ${VALID_TYPES.join(', ')}`);
  }

  // 描述长度
  if (req.body.description && req.body.description.length > 5000) {
    errors.push('description 长度不能超过 5000 个字符');
  }

  if (errors.length > 0) {
    return res.status(422).json({
      error: 'VALIDATION_ERROR',
      message: '数据校验失败',
      details: errors,
    });
  }

  next();
}

/**
 * 校验地点更新数据（部分字段可选）
 */
function validateLocationUpdate(req, res, next) {
  const { coordinates, type, name } = req.body;
  const errors = [];

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      errors.push('name 必须为非空字符串');
    }
    if (name.length > 100) {
      errors.push('name 长度不能超过 100 个字符');
    }
  }

  if (coordinates !== undefined) {
    if (!Array.isArray(coordinates) || coordinates.length !== 2) {
      errors.push('coordinates 格式为 [x, y]');
    } else {
      const [x, y] = coordinates;
      if (typeof x !== 'number' || typeof y !== 'number') {
        errors.push('coordinates 中的 x 和 y 必须为数字');
      } else {
        if (x < COORD_MIN || x > COORD_MAX) errors.push(`坐标 x 必须在 ${COORD_MIN}-${COORD_MAX} 范围内`);
        if (y < COORD_MIN || y > COORD_MAX) errors.push(`坐标 y 必须在 ${COORD_MIN}-${COORD_MAX} 范围内`);
      }
    }
  }

  if (type !== undefined && !VALID_TYPES.includes(type)) {
    errors.push(`type 必须为以下值之一: ${VALID_TYPES.join(', ')}`);
  }

  if (req.body.description !== undefined && req.body.description.length > 5000) {
    errors.push('description 长度不能超过 5000 个字符');
  }

  if (errors.length > 0) {
    return res.status(422).json({
      error: 'VALIDATION_ERROR',
      message: '数据校验失败',
      details: errors,
    });
  }

  next();
}

/**
 * 校验 GeoJSON Feature 数据
 */
function validateGeoJSONFeature(req, res, next) {
  const { type, properties, geometry } = req.body;
  const errors = [];

  if (!type || type !== 'Feature') {
    errors.push('type 必须为 "Feature"');
  }
  if (!properties || !properties.name) {
    errors.push('properties.name 为必填项');
  }
  if (!geometry || !geometry.type || !geometry.coordinates) {
    errors.push('geometry 必须包含 type 和 coordinates');
  }

  if (errors.length > 0) {
    return res.status(422).json({
      error: 'VALIDATION_ERROR',
      message: 'GeoJSON 校验失败',
      details: errors,
    });
  }

  next();
}

module.exports = {
  validateLocationCreate,
  validateLocationUpdate,
  validateGeoJSONFeature,
  VALID_TYPES,
};
