// ============================================================
// db.js - JSON 文件存储引擎
// 作为数据存储层，提供地图、地点、版本、日志的 CRUD 操作
// 可平滑替换为 SQLite / PostgreSQL
// ============================================================

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

// ---- 文件路径映射 ----
const FILES = {
  locations: path.join(DATA_DIR, 'locations.json'),
  map: path.join(DATA_DIR, 'map.geojson.json'),
  versions: path.join(DATA_DIR, 'versions.json'),
  logs: path.join(DATA_DIR, 'logs.json'),
  apiKeys: path.join(DATA_DIR, 'api-keys.json'),
};

// ---- 内存缓存 ----
const cache = {
  locations: null,
  map: null,
  versions: null,
  logs: null,
  apiKeys: null,
};

// ---- 自增 ID 计数器 ----
let locationIdCounter = 0;

// ============================================================
// 内部工具函数
// ============================================================

function loadFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[DB] 读取文件失败: ${filePath}`, err.message);
    return null;
  }
}

function saveFile(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error(`[DB] 写入文件失败: ${filePath}`, err.message);
    return false;
  }
}

function initCache() {
  cache.locations = loadFile(FILES.locations) || [];
  cache.map = loadFile(FILES.map) || { type: 'FeatureCollection', features: [] };
  cache.versions = loadFile(FILES.versions) || [];
  cache.logs = loadFile(FILES.logs) || [];
  cache.apiKeys = loadFile(FILES.apiKeys) || [];

  // 计算自增 ID 起始值
  locationIdCounter = cache.locations.reduce((max, loc) => {
    const numId = parseInt(loc.id, 10);
    return isNaN(numId) ? max : Math.max(max, numId);
  }, 0);

  console.log(`[DB] 数据加载完成 | 地点: ${cache.locations.length} | 区域: ${cache.map.features?.length || 0} | 版本: ${cache.versions.length} | 日志: ${cache.logs.length}`);
}

function persist(collection) {
  const mapping = {
    locations: FILES.locations,
    map: FILES.map,
    versions: FILES.versions,
    logs: FILES.logs,
    apiKeys: FILES.apiKeys,
  };
  const filePath = mapping[collection];
  if (filePath && cache[collection] !== null) {
    saveFile(filePath, cache[collection]);
  }
}

function generateLocationId() {
  locationIdCounter += 1;
  return String(locationIdCounter);
}

function nowISO() {
  return new Date().toISOString();
}

// ============================================================
// 地点 (Locations) 操作
// ============================================================

const locations = {
  getAll(filter = {}) {
    let result = [...cache.locations];
    if (filter.type) {
      result = result.filter((l) => l.type === filter.type);
    }
    if (filter.tag) {
      result = result.filter((l) => l.tags && l.tags.includes(filter.tag));
    }
    return result;
  },

  getById(id) {
    return cache.locations.find((l) => l.id === id) || null;
  },

  getByRange(x1, y1, x2, y2) {
    return cache.locations.filter((l) => {
      const [x, y] = l.coordinates;
      return x >= x1 && x <= x2 && y >= y1 && y <= y2;
    });
  },

  create(data, agentName) {
    const loc = {
      id: generateLocationId(),
      name: data.name,
      coordinates: data.coordinates, // [x, y] in 0-1000
      type: data.type || 'landmark',
      description: data.description || '',
      history: data.history || [],
      relatedCharacters: data.relatedCharacters || [],
      imageUrl: data.imageUrl || '',
      tags: data.tags || [],
      regionId: data.regionId || null,
      createdAt: nowISO(),
      updatedAt: nowISO(),
      createdBy: agentName || 'unknown',
      version: 1,
    };
    cache.locations.push(loc);
    persist('locations');
    return loc;
  },

  update(id, updates, agentName) {
    const idx = cache.locations.findIndex((l) => l.id === id);
    if (idx === -1) return null;

    const allowed = [
      'name', 'coordinates', 'type', 'description', 'history',
      'relatedCharacters', 'imageUrl', 'tags', 'regionId'
    ];
    const updated = { ...cache.locations[idx] };
    for (const key of allowed) {
      if (updates[key] !== undefined) {
        updated[key] = updates[key];
      }
    }
    updated.updatedAt = nowISO();
    updated.version = (cache.locations[idx].version || 1) + 1;
    updated.modifiedBy = agentName || 'unknown';
    cache.locations[idx] = updated;
    persist('locations');
    return updated;
  },

  delete(id) {
    const idx = cache.locations.findIndex((l) => l.id === id);
    if (idx === -1) return false;
    cache.locations.splice(idx, 1);
    persist('locations');
    return true;
  },

  // 冲突检测：检查坐标是否与现有地点过近
  checkConflict(coordinates, excludeId = null, threshold = 15) {
    const [x, y] = coordinates;
    return cache.locations.find((l) => {
      if (l.id === excludeId) return false;
      const [lx, ly] = l.coordinates;
      const dist = Math.sqrt((x - lx) ** 2 + (y - ly) ** 2);
      return dist < threshold;
    });
  },
};

// ============================================================
// 地图 (GeoJSON) 操作
// ============================================================

const map = {
  getStructure() {
    return cache.map;
  },

  getFeatures() {
    return cache.map.features || [];
  },

  getFeatureById(id) {
    return (cache.map.features || []).find((f) => f.properties?.id === id) || null;
  },

  addFeature(feature) {
    if (!cache.map.features) cache.map.features = [];
    cache.map.features.push(feature);
    persist('map');
    return feature;
  },

  updateFeature(id, updates) {
    const idx = (cache.map.features || []).findIndex((f) => f.properties?.id === id);
    if (idx === -1) return null;
    cache.map.features[idx] = {
      ...cache.map.features[idx],
      ...updates,
      properties: {
        ...cache.map.features[idx].properties,
        ...(updates.properties || {}),
      },
    };
    persist('map');
    return cache.map.features[idx];
  },

  removeFeature(id) {
    const idx = (cache.map.features || []).findIndex((f) => f.properties?.id === id);
    if (idx === -1) return false;
    cache.map.features.splice(idx, 1);
    persist('map');
    return true;
  },

  replaceAll(newGeoJSON) {
    cache.map = newGeoJSON;
    persist('map');
    return cache.map;
  },
};

// ============================================================
// 版本控制操作
// ============================================================

const versions = {
  getAll() {
    return [...cache.versions].sort((a, b) => b.version - a.version);
  },

  getLatest() {
    if (cache.versions.length === 0) return null;
    return cache.versions.reduce((max, v) => (v.version > max.version ? v : max));
  },

  getById(versionNum) {
    return cache.versions.find((v) => v.version === versionNum) || null;
  },

  createSnapshot(description, agentName) {
    const latest = this.getLatest();
    const newVersion = {
      version: (latest?.version || 0) + 1,
      description: description || `版本快照 - ${nowISO()}`,
      createdAt: nowISO(),
      createdBy: agentName || 'system',
      snapshot: {
        locations: JSON.parse(JSON.stringify(cache.locations)),
        geojson: JSON.parse(JSON.stringify(cache.map)),
      },
    };
    cache.versions.push(newVersion);
    persist('versions');
    return newVersion;
  },

  rollback(versionNum) {
    const target = this.getById(versionNum);
    if (!target) return null;
    // 恢复快照
    cache.locations = JSON.parse(JSON.stringify(target.snapshot.locations));
    cache.map = JSON.parse(JSON.stringify(target.snapshot.geojson));
    persist('locations');
    persist('map');
    // 重新计算 ID 计数器
    locationIdCounter = cache.locations.reduce((max, loc) => {
      const numId = parseInt(loc.id, 10);
      return isNaN(numId) ? max : Math.max(max, numId);
    }, 0);
    return target;
  },
};

// ============================================================
// 操作日志
// ============================================================

const logs = {
  getAll(filter = {}) {
    let result = [...cache.logs].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    if (filter.agentName) {
      result = result.filter((l) => l.agentName === filter.agentName);
    }
    if (filter.action) {
      result = result.filter((l) => l.action === filter.action);
    }
    if (filter.limit) {
      result = result.slice(0, filter.limit);
    }
    return result;
  },

  add(entry) {
    const log = {
      id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      agentName: entry.agentName || 'unknown',
      action: entry.action, // create | update | delete | rollback | map_update
      targetType: entry.targetType || 'location', // location | map | version
      targetId: entry.targetId || null,
      details: entry.details || {},
      context: entry.context || '', // Agent 操作上下文（原因、意图）
      timestamp: nowISO(),
    };
    cache.logs.push(log);
    // 保留最近 1000 条
    if (cache.logs.length > 1000) {
      cache.logs = cache.logs.slice(-1000);
    }
    persist('logs');
    return log;
  },
};

// ============================================================
// API Key 操作
// ============================================================

const apiKeys = {
  validate(key) {
    return cache.apiKeys.find((k) => k.key === key) || null;
  },

  getAll() {
    return cache.apiKeys;
  },

  hasPermission(keyInfo, permission) {
    return keyInfo && keyInfo.permissions && keyInfo.permissions.includes(permission);
  },
};

// ============================================================
// 初始化
// ============================================================

initCache();

module.exports = {
  locations,
  map,
  versions,
  logs,
  apiKeys,
};
