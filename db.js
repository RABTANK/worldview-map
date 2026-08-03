// ============================================================
// db.js - JSON 文件存储引擎 (v2)
// 修复清单:
//   1. 引导初始化: 自动创建 data 目录 + 默认 api-keys.json
//   2. 原子写入: 临时文件 + 重命名 + 备份
//   3. 区分文件不存在 vs 文件损坏 (后者让进程崩溃)
//   4. 持久化失败抛异常, 不再静默吞掉
//   5. UUID 替代自增 ID, 避免 rollback 后 ID 撞车
//   6. 快照独立文件存储, 版本索引只留元数据
//   7. 快照数量封顶, 防止 O(N^2) 增长
//   8. 日志存储差异而非完整对象
//   9. 统计使用 Map 避免原型污染
// ============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const config = require('./config');

const DATA_DIR = config.dataDir;
const SNAPSHOT_DIR = config.snapshotDir;

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
  versions: null,  // 只存元数据, 不含 snapshot 数据
  logs: null,
  apiKeys: null,
};

// ============================================================
// 引导初始化: 创建目录 + 默认密钥文件
// ============================================================
function bootstrap() {
  // 1. 创建 data 目录
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log('[DB] 创建 data 目录');
  }
  // 2. 创建 snapshots 子目录
  if (!fs.existsSync(SNAPSHOT_DIR)) {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  }
  // 3. 如果 api-keys.json 不存在, 写入默认密钥
  if (!fs.existsSync(FILES.apiKeys)) {
    const defaultKeys = [
      {
        key: config.defaultAdminKey,
        keyHash: sha256(config.defaultAdminKey),
        agentName: '管理员Agent',
        role: 'admin',
        permissions: ['read', 'write', 'delete', 'admin'],
        createdAt: new Date().toISOString(),
      },
      {
        key: config.defaultWriterKey,
        keyHash: sha256(config.defaultWriterKey),
        agentName: '写作Agent',
        role: 'writer',
        permissions: ['read', 'write'],
        createdAt: new Date().toISOString(),
      },
      {
        key: config.defaultRpaKey,
        keyHash: sha256(config.defaultRpaKey),
        agentName: 'RPA-Agent',
        role: 'rpa',
        permissions: ['read', 'write', 'delete'],
        createdAt: new Date().toISOString(),
      },
      {
        key: config.defaultViewerKey,
        keyHash: sha256(config.defaultViewerKey),
        agentName: '前端浏览器',
        role: 'viewer',
        permissions: ['read'],
        createdAt: new Date().toISOString(),
      },
    ];
    atomicWrite(FILES.apiKeys, defaultKeys);
    console.log('[DB] 创建默认 api-keys.json (含 admin/writer/rpa/viewer 四个密钥)');
  }
}

// ============================================================
// SHA-256 哈希 + 恒定时间比较
// ============================================================
function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf-8').digest('hex');
}

function timingSafeEqualHex(a, b) {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ============================================================
// 原子写入: 写临时文件 → 重命名 (同卷原子操作)
// 同时保留一份上一版备份
// ============================================================
function atomicWrite(filePath, data) {
  const tmpPath = filePath + '.tmp';
  const backupPath = filePath + '.bak';
  const json = JSON.stringify(data, null, 2);

  fs.writeFileSync(tmpPath, json, 'utf-8');

  // 保留备份 (如果原文件存在)
  if (fs.existsSync(filePath)) {
    try {
      fs.copyFileSync(filePath, backupPath);
    } catch (e) {
      console.warn(`[DB] 备份失败 (非致命): ${backupPath}`, e.message);
    }
  }

  // 原子重命名
  fs.renameSync(tmpPath, filePath);
}

// ============================================================
// 读取文件: 区分 "文件不存在" (正常) vs "文件损坏" (致命)
//   - 文件不存在: 返回 null (首次启动)
//   - 解析失败: 尝试读取 .bak 备份; 备份也坏则抛异常让进程崩溃
// ============================================================
function loadFile(filePath) {
  // 文件不存在 → 正常, 返回 null
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[DB] 文件损坏: ${filePath}`, err.message);
    // 尝试备份
    const backupPath = filePath + '.bak';
    if (fs.existsSync(backupPath)) {
      console.warn(`[DB] 尝试从备份恢复: ${backupPath}`);
      try {
        const raw = fs.readFileSync(backupPath, 'utf-8');
        const data = JSON.parse(raw);
        console.warn(`[DB] 从备份恢复成功, 正在修复主文件`);
        atomicWrite(filePath, data);
        return data;
      } catch (bakErr) {
        throw new Error(
          `数据文件损坏且备份不可用: ${filePath}\n` +
          `错误: ${err.message}\n` +
          `备份错误: ${bakErr.message}\n` +
          `请手动检查 ${backupPath} 或删除 data 目录重新初始化。`
        );
      }
    }
    throw new Error(
      `数据文件损坏且无备份: ${filePath}\n` +
      `错误: ${err.message}\n` +
      `请手动检查或删除 data 目录重新初始化。`
    );
  }
}

// ============================================================
// 持久化: 失败时抛异常, 不再静默吞掉
// ============================================================
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
    atomicWrite(filePath, cache[collection]);
  }
}

function nowISO() {
  return new Date().toISOString();
}

// ============================================================
// 快照独立文件存储
// ============================================================
function getSnapshotFilePath(versionNum) {
  return path.join(SNAPSHOT_DIR, `v${versionNum}.json`);
}

function saveSnapshotFile(versionNum, snapshotData) {
  atomicWrite(getSnapshotFilePath(versionNum), snapshotData);
}

function loadSnapshotFile(versionNum) {
  return loadFile(getSnapshotFilePath(versionNum));
}

function deleteSnapshotFile(versionNum) {
  const fp = getSnapshotFilePath(versionNum);
  if (fs.existsSync(fp)) {
    fs.unlinkSync(fp);
  }
}

// ============================================================
// 初始化
// ============================================================
function initCache() {
  bootstrap();

  cache.locations = loadFile(FILES.locations) || [];
  cache.map = loadFile(FILES.map) || { type: 'FeatureCollection', features: [] };
  cache.versions = loadFile(FILES.versions) || [];
  cache.logs = loadFile(FILES.logs) || [];
  cache.apiKeys = loadFile(FILES.apiKeys) || [];

  // 兼容旧版密钥文件: 为没有 keyHash 的条目补充哈希
  let keysChanged = false;
  for (const k of cache.apiKeys) {
    if (!k.keyHash && k.key) {
      k.keyHash = sha256(k.key);
      keysChanged = true;
    }
  }
  // 补充 admin 权限标识 (旧文件可能没有)
  for (const k of cache.apiKeys) {
    if (k.role === 'admin' && !k.permissions.includes('admin')) {
      k.permissions.push('admin');
      keysChanged = true;
    }
  }
  if (keysChanged) {
    persist('apiKeys');
  }

  console.log(
    `[DB] 数据加载完成 | 地点: ${cache.locations.length} | 区域: ${cache.map.features?.length || 0} | 版本: ${cache.versions.length} | 日志: ${cache.logs.length}`
  );
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
    // 钳制坐标顺序 (允许 x1>x2)
    const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
    return cache.locations.filter((l) => {
      const [x, y] = l.coordinates;
      return x >= minX && x <= maxX && y >= minY && y <= maxY;
    });
  },

  create(data, agentName) {
    const loc = {
      id: uuidv4(),
      name: data.name,
      coordinates: data.coordinates,
      type: data.type || 'landmark',
      description: data.description || '',
      history: data.history || [],
      relatedCharacters: data.relatedCharacters || [],
      imageUrl: data.imageUrl || '',
      tags: data.tags || [],
      regionId: data.regionId || null,
      parentId: data.parentId || null,
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
      'relatedCharacters', 'imageUrl', 'tags', 'regionId', 'parentId'
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

  checkConflict(coordinates, excludeId = null, threshold = config.coordConflictThreshold) {
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

  featureIdExists(id) {
    return (cache.map.features || []).some((f) => f.properties?.id === id);
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

    // 白名单: 只允许更新这些字段, 防止覆盖 ID 和内部字段
    const existing = cache.map.features[idx];
    const updated = { ...existing };

    // 只更新 geometry 和允许的 properties
    if (updates.geometry) {
      updated.geometry = updates.geometry;
    }
    if (updates.properties) {
      const allowedProps = [
        'name', 'color', 'borderColor', 'type', 'description',
        'history', 'tags', 'relatedCharacters', 'coordinates',
        'districtCenter', 'parentRegion', 'level', 'locationType',
        'tileMap',
      ];
      updated.properties = { ...existing.properties };
      for (const key of allowedProps) {
        if (updates.properties[key] !== undefined) {
          updated.properties[key] = updates.properties[key];
        }
      }
      // ID 不可修改
      updated.properties.id = existing.properties.id;
      // createdAt 不可修改
      if (!updated.properties.createdAt) {
        updated.properties.createdAt = existing.properties.createdAt;
      }
      updated.properties.updatedAt = nowISO();
    }

    cache.map.features[idx] = updated;
    persist('map');
    return updated;
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
// 关键修复:
//   1. 快照在修改前拍 (createSnapshot 捕获当前状态)
//   2. 快照数据存独立文件, 版本索引只留元数据
//   3. 快照数量封顶, 超出时删除最旧的非里程碑快照
//   4. rollback 不重置 ID 计数器 (已改用 UUID)
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

  /**
   * 创建快照 - 捕获"当前"状态
   * 应在执行修改操作之前调用
   */
  createSnapshot(description, agentName, isMilestone = false) {
    const latest = this.getLatest();
    const newVersion = {
      version: (latest?.version || 0) + 1,
      description: description || `版本快照 - ${nowISO()}`,
      createdAt: nowISO(),
      createdBy: agentName || 'system',
      isMilestone: isMilestone,
      locationCount: cache.locations.length,
      featureCount: cache.map.features?.length || 0,
    };

    // 快照数据存独立文件
    const snapshotData = {
      locations: JSON.parse(JSON.stringify(cache.locations)),
      geojson: JSON.parse(JSON.stringify(cache.map)),
    };
    saveSnapshotFile(newVersion.version, snapshotData);

    cache.versions.push(newVersion);

    // 快照数量封顶: 保留所有里程碑 + 最近 N 个非里程碑
    this.enforceSnapshotLimit();

    persist('versions');
    return newVersion;
  },

  /**
   * 快照数量限制
   * 保留: 所有 isMilestone=true 的 + 最近 maxSnapshotCount 个非里程碑
   */
  enforceSnapshotLimit() {
    const milestones = cache.versions.filter((v) => v.isMilestone);
    const nonMilestones = cache.versions
      .filter((v) => !v.isMilestone)
      .sort((a, b) => b.version - a.version);

    const keepNonMilestones = nonMilestones.slice(0, config.maxSnapshotCount);
    const removeNonMilestones = nonMilestones.slice(config.maxSnapshotCount);

    // 删除溢出快照的独立文件
    for (const v of removeNonMilestones) {
      deleteSnapshotFile(v.version);
    }

    cache.versions = [...milestones, ...keepNonMilestones].sort((a, b) => a.version - b.version);
  },

  /**
   * 获取快照数据 (从独立文件加载)
   */
  getSnapshotData(versionNum) {
    return loadSnapshotFile(versionNum);
  },

  rollback(versionNum) {
    const target = this.getById(versionNum);
    if (!target) return null;

    const snapshotData = this.getSnapshotData(versionNum);
    if (!snapshotData) {
      throw new Error(`版本 ${versionNum} 的快照数据文件缺失`);
    }

    // 恢复快照 (UUID 不会撞车, 无需重置计数器)
    cache.locations = JSON.parse(JSON.stringify(snapshotData.locations));
    cache.map = JSON.parse(JSON.stringify(snapshotData.geojson));
    persist('locations');
    persist('map');
    return target;
  },
};

// ============================================================
// 操作日志
// 修复: details 只存差异/摘要, 不存完整对象
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
    if (filter.limit !== undefined) {
      const limit = parseInt(filter.limit, 10);
      if (!isNaN(limit) && limit >= 0) {
        result = result.slice(0, limit);
      }
    }
    return result;
  },

  add(entry) {
    const log = {
      id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      agentName: entry.agentName || 'unknown',
      action: entry.action,
      targetType: entry.targetType || 'location',
      targetId: entry.targetId || null,
      // details 只存摘要信息, 不存完整前后对象
      details: this._sanitizeDetails(entry.details || {}),
      context: typeof entry.context === 'string' ? entry.context.slice(0, 500) : '',
      timestamp: nowISO(),
    };
    cache.logs.push(log);
    // 保留最近 N 条
    if (cache.logs.length > config.logMaxEntries) {
      cache.logs = cache.logs.slice(-config.logMaxEntries);
    }
    persist('logs');
    return log;
  },

  /**
   * 清理 details: 确保只存可序列化的基本类型, 不存完整对象
   */
  _sanitizeDetails(details) {
    const safe = {};
    for (const [key, value] of Object.entries(details)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        safe[key] = value;
      } else if (Array.isArray(value)) {
        // 数组: 只存长度和前3项的名称
        safe[key] = value.length;
      } else if (typeof value === 'object' && value !== null) {
        // 对象: 只存可序列化的摘要字段
        const summary = {};
        for (const [k, v] of Object.entries(value)) {
          if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
            summary[k] = v;
          }
        }
        safe[key] = summary;
      }
    }
    return safe;
  },
};

// ============================================================
// API Key 操作
// 修复: 哈希比较 (恒定时间), 支持 admin 权限
// ============================================================

const apiKeys = {
  /**
   * 验证 key: 使用恒定时间比较哈希值
   */
  validate(key) {
    if (!key || typeof key !== 'string') return null;
    const keyHash = sha256(key);
    for (const k of cache.apiKeys) {
      const storedHash = k.keyHash || (k.key ? sha256(k.key) : null);
      if (storedHash && timingSafeEqualHex(keyHash, storedHash)) {
        return k;
      }
    }
    return null;
  },

  getAll() {
    // 不返回 key 明文和 hash
    return cache.apiKeys.map((k) => ({
      agentName: k.agentName,
      role: k.role,
      permissions: k.permissions,
      createdAt: k.createdAt,
    }));
  },

  hasPermission(keyInfo, permission) {
    return keyInfo && keyInfo.permissions && keyInfo.permissions.includes(permission);
  },
};

// ============================================================
// 初始化 (在模块加载时执行)
// ============================================================

initCache();

module.exports = {
  locations,
  map,
  versions,
  logs,
  apiKeys,
};
