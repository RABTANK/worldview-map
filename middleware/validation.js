// ============================================================
// middleware/validation.js - 数据校验中间件 (v2)
// 修复清单:
//   1. description 类型校验 (数字没有 length, 绕过检查)
//   2. history 必须为数组 (对象会导致前端遍历崩溃)
//   3. tags 必须为数组 (字符串导致筛选异常)
//   4. imageUrl 协议校验 (防存储型 XSS)
//   5. GeoJSON 严格校验: 坐标类型/范围/环闭合/点数上限
//   6. relatedCharacters 必须为数组
// ============================================================

const config = require('../config');

const VALID_TYPES = [
  'city', 'village', 'fortress', 'port', 'ruins',
  'tower', 'forge', 'landmark', 'dungeon', 'camp', 'shrine', 'other'
];

const COORD_MIN = config.coordMin;
const COORD_MAX = config.coordMax;

// ---- 工具函数 ----

function isString(v) { return typeof v === 'string'; }
function isNumber(v) { return typeof v === 'number' && !isNaN(v) && isFinite(v); }
function isArray(v) { return Array.isArray(v); }
function isObject(v) { return typeof v === 'object' && v !== null && !isArray(v); }

function validateStringArray(arr, maxLen, errors, fieldName) {
  if (!isArray(arr)) {
    errors.push(`${fieldName} 必须为数组`);
    return;
  }
  if (arr.length > maxLen) {
    errors.push(`${fieldName} 最多 ${maxLen} 项`);
  }
  for (const item of arr) {
    if (!isString(item)) {
      errors.push(`${fieldName} 中的每一项必须为字符串`);
      break;
    }
  }
}

function validateImageUrl(url, errors) {
  if (!url) return;
  if (!isString(url)) {
    errors.push('imageUrl 必须为字符串');
    return;
  }
  if (url.length > 2000) {
    errors.push('imageUrl 长度不能超过 2000');
    return;
  }
  // 只允许 http/https/data:image 协议
  const allowed = /^https?:\/\/|^data:image\//;
  if (!allowed.test(url)) {
    errors.push('imageUrl 必须以 http://, https:// 或 data:image 开头');
  }
}

function validateCoordinates(coords, errors, fieldName = 'coordinates') {
  if (!isArray(coords) || coords.length !== 2) {
    errors.push(`${fieldName} 格式为 [x, y]`);
    return;
  }
  const [x, y] = coords;
  if (!isNumber(x) || !isNumber(y)) {
    errors.push(`${fieldName} 中的 x 和 y 必须为有限数字`);
    return;
  }
  if (x < COORD_MIN || x > COORD_MAX) {
    errors.push(`${fieldName} 的 x 必须在 ${COORD_MIN}-${COORD_MAX} 范围内`);
  }
  if (y < COORD_MIN || y > COORD_MAX) {
    errors.push(`${fieldName} 的 y 必须在 ${COORD_MIN}-${COORD_MAX} 范围内`);
  }
}

/**
 * 校验 history 数组
 * 每项应为 { time: string, event: string }
 */
function validateHistory(history, errors) {
  if (history === undefined) return;
  if (!isArray(history)) {
    errors.push('history 必须为数组');
    return;
  }
  if (history.length > 100) {
    errors.push('history 最多 100 项');
  }
  for (const item of history) {
    if (!isObject(item)) {
      errors.push('history 中的每一项必须为对象');
      break;
    }
    if (item.time !== undefined && !isString(item.time)) {
      errors.push('history[].time 必须为字符串');
      break;
    }
    if (item.event !== undefined && !isString(item.event)) {
      errors.push('history[].event 必须为字符串');
      break;
    }
  }
}

/**
 * 校验 description (关键: 数字没有 length, 需要先检查类型)
 */
function validateDescription(desc, errors) {
  if (desc === undefined) return;
  if (!isString(desc)) {
    errors.push('description 必须为字符串');
    return;
  }
  if (desc.length > config.maxDescriptionLength) {
    errors.push(`description 长度不能超过 ${config.maxDescriptionLength} 个字符`);
  }
}

// ---- GeoJSON 校验 ----

function validateGeoJSONCoordinates(coords, errors, path = 'coordinates') {
  if (!isArray(coords)) {
    errors.push(`${path} 必须为数组`);
    return;
  }

  // Polygon: coordinates 是环的数组
  for (let i = 0; i < coords.length; i++) {
    const ring = coords[i];
    if (!isArray(ring)) {
      errors.push(`${path}[${i}] 必须为数组`);
      return;
    }
    if (ring.length < 4) {
      errors.push(`${path}[${i}] 至少需要 4 个点 (闭合环)`);
      return;
    }
    if (ring.length > config.maxPolygonPoints) {
      errors.push(`${path}[${i}] 点数不能超过 ${config.maxPolygonPoints}`);
      return;
    }
    // 检查每个点
    for (let j = 0; j < ring.length; j++) {
      const pt = ring[j];
      if (!isArray(pt) || pt.length < 2) {
        errors.push(`${path}[${i}][${j}] 必须为 [x, y] 格式`);
        return;
      }
      if (!isNumber(pt[0]) || !isNumber(pt[1])) {
        errors.push(`${path}[${i}][${j}] 的坐标必须为数字`);
        return;
      }
      if (pt[0] < COORD_MIN || pt[0] > COORD_MAX || pt[1] < COORD_MIN || pt[1] > COORD_MAX) {
        errors.push(`${path}[${i}][${j}] 坐标超出 ${COORD_MIN}-${COORD_MAX} 范围`);
        return;
      }
    }
    // 检查环是否闭合 (首尾点相同)
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      errors.push(`${path}[${i}] 环未闭合 (首尾点必须相同)`);
    }
  }
}

// ============================================================
// 地点校验
// ============================================================

function validateLocationCreate(req, res, next) {
  const { name, coordinates, type } = req.body;
  const errors = [];

  // name
  if (!isString(name) || name.trim().length === 0) {
    errors.push('name 为必填项，且为非空字符串');
  } else if (name.length > config.maxNameLength) {
    errors.push(`name 长度不能超过 ${config.maxNameLength} 个字符`);
  }

  // coordinates
  if (coordinates === undefined) {
    errors.push('coordinates 为必填项');
  } else {
    validateCoordinates(coordinates, errors);
  }

  // type
  if (type !== undefined && !VALID_TYPES.includes(type)) {
    errors.push(`type 必须为以下值之一: ${VALID_TYPES.join(', ')}`);
  }

  // description (关键: 先检查类型, 数字没有 length)
  validateDescription(req.body.description, errors);

  // history
  validateHistory(req.body.history, errors);

  // tags
  if (req.body.tags !== undefined) {
    validateStringArray(req.body.tags, 50, errors, 'tags');
  }

  // relatedCharacters
  if (req.body.relatedCharacters !== undefined) {
    validateStringArray(req.body.relatedCharacters, 50, errors, 'relatedCharacters');
  }

  // imageUrl
  if (req.body.imageUrl !== undefined) {
    validateImageUrl(req.body.imageUrl, errors);
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

function validateLocationUpdate(req, res, next) {
  const errors = [];

  if (req.body.name !== undefined) {
    if (!isString(req.body.name) || req.body.name.trim().length === 0) {
      errors.push('name 必须为非空字符串');
    } else if (req.body.name.length > config.maxNameLength) {
      errors.push(`name 长度不能超过 ${config.maxNameLength} 个字符`);
    }
  }

  if (req.body.coordinates !== undefined) {
    validateCoordinates(req.body.coordinates, errors);
  }

  if (req.body.type !== undefined && !VALID_TYPES.includes(req.body.type)) {
    errors.push(`type 必须为以下值之一: ${VALID_TYPES.join(', ')}`);
  }

  validateDescription(req.body.description, errors);
  validateHistory(req.body.history, errors);

  if (req.body.tags !== undefined) {
    validateStringArray(req.body.tags, 50, errors, 'tags');
  }
  if (req.body.relatedCharacters !== undefined) {
    validateStringArray(req.body.relatedCharacters, 50, errors, 'relatedCharacters');
  }
  if (req.body.imageUrl !== undefined) {
    validateImageUrl(req.body.imageUrl, errors);
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

// ============================================================
// GeoJSON Feature 校验
// ============================================================

function validateGeoJSONFeature(req, res, next) {
  const { type, properties, geometry } = req.body;
  const errors = [];

  if (!isString(type) || type !== 'Feature') {
    errors.push('type 必须为 "Feature"');
  }

  if (!isObject(properties)) {
    errors.push('properties 必须为对象');
  } else {
    if (!isString(properties.name) || properties.name.trim().length === 0) {
      errors.push('properties.name 为必填项且为非空字符串');
    } else if (properties.name.length > config.maxNameLength) {
      errors.push(`properties.name 长度不能超过 ${config.maxNameLength}`);
    }

    // 校验 properties 中的可选字段
    if (properties.coordinates !== undefined) {
      validateCoordinates(properties.coordinates, errors, 'properties.coordinates');
    }
    if (properties.districtCenter !== undefined) {
      validateCoordinates(properties.districtCenter, errors, 'properties.districtCenter');
    }
    if (properties.description !== undefined) {
      validateDescription(properties.description, errors);
    }
    if (properties.tags !== undefined) {
      validateStringArray(properties.tags, 50, errors, 'properties.tags');
    }
    if (properties.level !== undefined) {
      if (!isNumber(properties.level) || properties.level < 1 || properties.level > 10) {
        errors.push('properties.level 必须为 1-10 的数字');
      }
    }
  }

  if (!isObject(geometry)) {
    errors.push('geometry 必须为对象');
  } else {
    if (!isString(geometry.type) || geometry.type !== 'Polygon') {
      errors.push('geometry.type 必须为 "Polygon"');
    }
    if (geometry.coordinates === undefined) {
      errors.push('geometry.coordinates 为必填项');
    } else {
      validateGeoJSONCoordinates(geometry.coordinates, errors, 'geometry.coordinates');
    }
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

/**
 * 校验 GeoJSON Feature 更新 (部分字段可选, 但结构必须正确)
 */
function validateGeoJSONFeatureUpdate(req, res, next) {
  const errors = [];

  if (req.body.properties !== undefined) {
    if (!isObject(req.body.properties)) {
      errors.push('properties 必须为对象');
    } else {
      if (req.body.properties.name !== undefined) {
        if (!isString(req.body.properties.name) || req.body.properties.name.trim().length === 0) {
          errors.push('properties.name 必须为非空字符串');
        } else if (req.body.properties.name.length > config.maxNameLength) {
          errors.push(`properties.name 长度不能超过 ${config.maxNameLength}`);
        }
      }
      if (req.body.properties.coordinates !== undefined) {
        validateCoordinates(req.body.properties.coordinates, errors, 'properties.coordinates');
      }
      if (req.body.properties.districtCenter !== undefined) {
        validateCoordinates(req.body.properties.districtCenter, errors, 'properties.districtCenter');
      }
      if (req.body.properties.description !== undefined) {
        validateDescription(req.body.properties.description, errors);
      }
      if (req.body.properties.tags !== undefined) {
        validateStringArray(req.body.properties.tags, 50, errors, 'properties.tags');
      }
      if (req.body.properties.level !== undefined) {
        if (!isNumber(req.body.properties.level) || req.body.properties.level < 1 || req.body.properties.level > 10) {
          errors.push('properties.level 必须为 1-10 的数字');
        }
      }
    }
  }

  if (req.body.geometry !== undefined) {
    if (!isObject(req.body.geometry)) {
      errors.push('geometry 必须为对象');
    } else {
      if (req.body.geometry.type !== undefined && (!isString(req.body.geometry.type) || req.body.geometry.type !== 'Polygon')) {
        errors.push('geometry.type 必须为 "Polygon"');
      }
      if (req.body.geometry.coordinates !== undefined) {
        validateGeoJSONCoordinates(req.body.geometry.coordinates, errors, 'geometry.coordinates');
      }
    }
  }

  if (errors.length > 0) {
    return res.status(422).json({
      error: 'VALIDATION_ERROR',
      message: 'GeoJSON 更新校验失败',
      details: errors,
    });
  }

  next();
}

module.exports = {
  validateLocationCreate,
  validateLocationUpdate,
  validateGeoJSONFeature,
  validateGeoJSONFeatureUpdate,
  VALID_TYPES,
};
