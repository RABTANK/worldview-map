// ============================================================
// api-client.js - API 客户端
// 封装所有与后端 RESTful API 的交互
// ============================================================

class APIClient {
  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
  }

  async request(method, path, body = null, apiKey = null) {
    const url = `${this.baseUrl}${path}`;
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['X-API-Key'] = apiKey;

    const options = { method, headers };
    if (body && method !== 'GET') {
      options.body = JSON.stringify(body);
    }

    try {
      const res = await fetch(url, options);
      const data = await res.json();
      if (!res.ok) {
        const err = new Error(data.message || `HTTP ${res.status}`);
        err.status = res.status;
        err.code = data.error;
        err.details = data.details;
        err.conflictWith = data.conflictWith;
        throw err;
      }
      return data;
    } catch (err) {
      if (err.status) throw err;
      console.error(`[API] ${method} ${path} 网络错误:`, err.message);
      throw new Error(`网络请求失败: ${err.message}`);
    }
  }

  // ---- 地点接口 ----
  getLocations(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.request('GET', `/api/locations${qs ? '?' + qs : ''}`);
  }

  getLocation(id) {
    return this.request('GET', `/api/locations/${id}`);
  }

  getLocationsInRange(x1, y1, x2, y2) {
    return this.request('GET', `/api/locations/range?x1=${x1}&y1=${y1}&x2=${x2}&y2=${y2}`);
  }

  createLocation(data, apiKey) {
    return this.request('POST', '/api/locations', data, apiKey);
  }

  updateLocation(id, data, apiKey) {
    return this.request('PUT', `/api/locations/${id}`, data, apiKey);
  }

  deleteLocation(id, apiKey, context = '') {
    return this.request('DELETE', `/api/locations/${id}`, context ? { context } : null, apiKey);
  }

  // ---- 地图结构接口 ----
  getMapStructure() {
    return this.request('GET', '/api/map/structure');
  }

  getLayers() {
    return this.request('GET', '/api/map/layers');
  }

  addFeature(data, apiKey) {
    return this.request('POST', '/api/map/features', data, apiKey);
  }

  updateFeature(id, data, apiKey) {
    return this.request('PUT', `/api/map/features/${id}`, data, apiKey);
  }

  deleteFeature(id, apiKey, context = '') {
    return this.request('DELETE', `/api/map/features/${id}`, context ? { context } : null, apiKey);
  }

  replaceMapStructure(data, apiKey) {
    return this.request('PUT', '/api/map/structure', data, apiKey);
  }

  // ---- 版本控制接口 ----
  getVersions() {
    return this.request('GET', '/api/versions');
  }

  getVersion(version) {
    return this.request('GET', `/api/versions/${version}`);
  }

  rollback(version, apiKey, context = '') {
    return this.request('POST', `/api/versions/${version}/rollback`, context ? { context } : {}, apiKey);
  }

  createSnapshot(description, apiKey) {
    return this.request('POST', '/api/versions/snapshot', { description }, apiKey);
  }

  // ---- 日志接口 ----
  getLogs(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this.request('GET', `/api/logs${qs ? '?' + qs : ''}`);
  }

  getTimeline() {
    return this.request('GET', '/api/logs/timeline');
  }

  // ---- 记忆接口 ----
  getMemorySummary() {
    return this.request('GET', '/api/memory/summary');
  }

  getMemoryTimeline(agent = null, limit = 50) {
    const params = { limit };
    if (agent) params.agent = agent;
    const qs = new URLSearchParams(params).toString();
    return this.request('GET', `/api/memory/timeline?${qs}`);
  }

  // ---- 系统接口 ----
  health() {
    return this.request('GET', '/api/health');
  }

  getApiInfo() {
    return this.request('GET', '/api');
  }
}

// 全局 API 客户端实例
const api = new APIClient();

// ---- 地点类型配置 ----
const TYPE_CONFIG = {
  city:     { icon: '\u{1F3F0}', color: '#ffd700', label: '城市' },
  village:  { icon: '\u{1F3E0}', color: '#7cfc00', label: '村庄' },
  fortress: { icon: '\u{1F6E1}', color: '#ff4500', label: '要塞' },
  port:     { icon: '\u{2693}',  color: '#1e90ff', label: '港口' },
  ruins:    { icon: '\u{1F3DB}', color: '#9370db', label: '遗迹' },
  tower:    { icon: '\u{1F5FC}', color: '#00ced1', label: '塔楼' },
  forge:    { icon: '\u{1F525}', color: '#ff8c00', label: '熔炉' },
  landmark: { icon: '\u{1F4CD}', color: '#ffffff', label: '地标' },
  dungeon:  { icon: '\u{1F480}', color: '#8b0000', label: '地下城' },
  camp:     { icon: '\u{26FA}',  color: '#deb887', label: '营地' },
  shrine:   { icon: '\u{26E9}',  color: '#c0c0c0', label: '神殿' },
  other:    { icon: '\u{2753}',  color: '#a9a9a9', label: '其他' },
};

// ---- API Key 管理 ----
// 安全修复: 前端不再硬编码写权限密钥
// 读接口默认免鉴权, 写操作需用户手动输入 API Key
const API_KEYS = {
  viewer: null, // 读接口免 Key, 设为 null
  writer: null, // 用户手动输入, 不预置
  rpa: null,
  admin: null,
};

// 从 localStorage 读取用户保存的 API Key (仅本机浏览器)
function getStoredApiKey() {
  try {
    return localStorage.getItem('worldview_api_key') || null;
  } catch (e) {
    return null;
  }
}

function setStoredApiKey(key) {
  try {
    if (key) {
      localStorage.setItem('worldview_api_key', key);
    } else {
      localStorage.removeItem('worldview_api_key');
    }
  } catch (e) {
    // localStorage 不可用时静默
  }
}
