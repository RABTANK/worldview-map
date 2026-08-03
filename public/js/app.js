// ============================================================
// app.js - 应用主逻辑
// 数据加载、事件处理、UI 交互、自动刷新
// ============================================================

// ---- 全局状态 ----
let renderer = null;
const state = {
  geoJSON: null,
  locations: [],
  versions: [],
  logs: [],
  layers: { regions: true, markers: true, labels: true, grid: false, roads: true },
  typeFilter: new Set(),
  autoRefresh: true,
  refreshInterval: null,
  REFRESH_INTERVAL_MS: 5000,
  selectedVersion: null,
  lastUpdate: null,
  // 数据指纹 - 用于判断数据是否真的变了，避免无意义的重渲染
  // 关键修复: 自动刷新(5s 轮询)若数据没变，绝不能再 setOption，
  // 否则会触发"回弹"问题。
  _dataFingerprint: '',
};

// ============================================================
// 初始化
// ============================================================
async function init() {
  renderer = new MapRenderer('map-container');
  renderer.init();
  window.__renderer = renderer; // 暴露用于调试

  // 初始化瓦片渲染器 (建筑平面图)
  const tileRenderer = new TileRenderer('map-container');
  tileRenderer.init();
  tileRenderer.on('tileClick', handleTileClick);
  tileRenderer.on('zoomChange', updateZoomDisplay);
  renderer.setTileRenderer(tileRenderer);
  window.__tileRenderer = tileRenderer;

  // 注册回调
  renderer.on('locationClick', handleLocationClick);
  renderer.on('regionClick', handleRegionClick);
  renderer.on('coordinateChange', updateCoordDisplay);
  renderer.on('zoomChange', updateZoomDisplay);
  renderer.on('levelChange', handleLevelChange);
  renderer.on('enterBuilding', handleEnterBuilding);
  renderer.on('exitBuilding', handleExitBuilding);

  setupEventListeners();
  setupTypeFilters();

  // 检查服务器健康状态
  try {
    await api.health();
    updateServerStatus(true);
  } catch {
    updateServerStatus(false);
  }

  await loadAllData();

  if (state.autoRefresh) startAutoRefresh();
}

// ============================================================
// 数据加载
// 关键修复：添加数据指纹对比，避免 auto-refresh 无意义 setOption
// ============================================================
function _computeFingerprint(geoJSON, locations) {
  // 简单稳定的指纹: 计数 + version 时间戳
  // 实际项目里可以用 hash，这里追求稳定性 > 速度
  try {
    const fc = (geoJSON?.features || []).length;
    const lc = (locations || []).length;
    // 取最近修改时间戳: 假设后端按时间排序
    const features = (geoJSON?.features || []).map(f => ({
      id: f.properties?.id,
      v: f.properties?.version || 0,
    }));
    const locs = (locations || []).map(l => ({
      id: l.id,
      v: l.version || 0,
    }));
    return JSON.stringify({ fc, lc, features, locs });
  } catch (e) {
    return Math.random().toString();
  }
}

async function loadAllData(force = false) {
  try {
    // 加载前记录旧指纹
    const oldFingerprint = state._dataFingerprint;

    await Promise.all([
      loadMapStructure(),
      loadLocations(),
      loadLogs(),
      loadVersions(),
    ]);

    // 计算新指纹
    const newFingerprint = _computeFingerprint(state.geoJSON, state.locations);
    const dataChanged = newFingerprint !== oldFingerprint;

    // 关键: 仅在数据实际变化或强制刷新时才更新地图
    if (dataChanged || force) {
      updateUI();
    }

    // 更新指纹
    state._dataFingerprint = newFingerprint;
    state.lastUpdate = new Date();
    updateLastUpdate();
  } catch (err) {
    console.error('[App] 数据加载失败:', err.message);
  }
}

async function loadMapStructure() {
  try {
    const res = await api.getMapStructure();
    state.geoJSON = res.data;
  } catch (err) {
    console.error('[App] 加载地图结构失败:', err.message);
    state.geoJSON = { type: 'FeatureCollection', features: [] };
  }
}

async function loadLocations() {
  try {
    const res = await api.getLocations();
    state.locations = res.data || [];
  } catch (err) {
    console.error('[App] 加载地点失败:', err.message);
    state.locations = [];
  }
}

async function loadLogs() {
  try {
    const res = await api.getLogs({ limit: 50 });
    state.logs = res.data || [];
    renderLogs();
  } catch (err) {
    console.error('[App] 加载日志失败:', err.message);
    state.logs = [];
  }
}

async function loadVersions() {
  try {
    const res = await api.getVersions();
    state.versions = res.data || [];
    renderVersionSelect();
  } catch (err) {
    console.error('[App] 加载版本失败:', err.message);
    state.versions = [];
  }
}

// ============================================================
// UI 更新
// ============================================================
function updateUI() {
  renderer.updateData(state.geoJSON, state.locations);

  // 更新统计
  const locCount = state.locations.length;
  const regionCount = (state.geoJSON?.features || []).filter(
    (f) => f.properties?.name !== '__boundary__'
  ).length;

  document.getElementById('location-count').textContent = locCount;
  document.getElementById('region-count').textContent = regionCount;

  // 空状态
  showEmptyState(locCount === 0 && regionCount === 0);
}

function showEmptyState(show) {
  const el = document.getElementById('empty-state');
  if (show) {
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

function updateCoordDisplay(x, y) {
  document.getElementById('coord-display').textContent = `坐标: (${x}, ${y})`;
}

function updateZoomDisplay(zoom) {
  document.getElementById('zoom-display').textContent = `缩放: ${zoom}%`;
}

function updateLastUpdate() {
  const el = document.getElementById('last-update');
  if (state.lastUpdate) {
    const time = state.lastUpdate.toLocaleTimeString('zh-CN');
    el.textContent = `最后更新: ${time}`;
  }
}

function updateServerStatus(online) {
  const el = document.getElementById('server-status');
  if (online) {
    el.className = 'status-dot status-online';
    el.innerHTML = '\u25CF 在线';
  } else {
    el.className = 'status-dot status-offline';
    el.innerHTML = '\u25CF 离线';
  }
}

// ============================================================
// 事件监听
// ============================================================
function setupEventListeners() {
  // 刷新按钮
  document.getElementById('refresh-btn').addEventListener('click', async () => {
    await loadAllData();
  });

  // 自动刷新
  document.getElementById('auto-refresh-toggle').addEventListener('click', toggleAutoRefresh);

  // API 文档
  document.getElementById('api-panel-btn').addEventListener('click', showAPIModal);
  document.getElementById('empty-api-btn').addEventListener('click', showAPIModal);

  // 返回上级
  document.getElementById('back-btn').addEventListener('click', () => {
    renderer.goBack();
  });

  // 图层控制
  ['regions', 'markers', 'labels', 'grid', 'roads'].forEach((layer) => {
    const cb = document.getElementById(`layer-${layer}`);
    cb.addEventListener('change', (e) => {
      state.layers[layer] = e.target.checked;
      renderer.setLayer(layer, e.target.checked);
    });
  });

  // 道路种子控制
  document.getElementById('road-seed-apply').addEventListener('click', () => {
    const seed = parseInt(document.getElementById('road-seed-input').value, 10) || 42;
    renderer.setRoadSeed(seed);
  });
  document.getElementById('road-seed-random').addEventListener('click', () => {
    const seed = Math.floor(Math.random() * 999999);
    document.getElementById('road-seed-input').value = seed;
    renderer.setRoadSeed(seed);
  });

  // 搜索
  const searchInput = document.getElementById('search-input');
  let searchTimer = null;
  searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => handleSearch(e.target.value), 200);
  });

  // 日志刷新
  document.getElementById('log-refresh').addEventListener('click', loadLogs);

  // 版本选择
  document.getElementById('version-select').addEventListener('change', (e) => {
    state.selectedVersion = e.target.value;
    document.getElementById('rollback-btn').disabled = !e.target.value;
  });

  // 回滚
  document.getElementById('rollback-btn').addEventListener('click', handleRollback);

  // 弹窗关闭
  document.querySelectorAll('.modal-close').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target;
      if (target) document.getElementById(target).classList.add('hidden');
    });
  });

  // 点击遮罩关闭
  document.querySelectorAll('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.add('hidden');
    });
  });

  // ESC 关闭弹窗
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay').forEach((m) => m.classList.add('hidden'));
    }
  });
}

// ============================================================
// 类型筛选
// ============================================================
function setupTypeFilters() {
  const container = document.getElementById('type-filters');
  container.innerHTML = '';

  Object.entries(TYPE_CONFIG).forEach(([type, config]) => {
    const chip = document.createElement('div');
    chip.className = 'type-chip';
    chip.dataset.type = type;
    chip.innerHTML = `${config.icon} ${config.label}`;
    chip.addEventListener('click', () => handleTypeFilter(type, chip));
    container.appendChild(chip);
  });
}

function handleTypeFilter(type, chip) {
  if (state.typeFilter.has(type)) {
    state.typeFilter.delete(type);
    chip.classList.remove('active');
  } else {
    state.typeFilter.add(type);
    chip.classList.add('active');
  }
  renderer.setTypeFilter(Array.from(state.typeFilter));
}

// ============================================================
// 搜索（同时搜索地点和区域）
// ============================================================
function handleSearch(keyword) {
  renderer.search(keyword);

  if (!keyword) {
    renderSearchResults([], []);
    return;
  }

  const kw = keyword.toLowerCase();

  // 搜索地点
  const locResults = state.locations.filter((l) =>
    l.name.toLowerCase().includes(kw)
  );

  // 搜索区域（从 GeoJSON features）
  const regionResults = [];
  const features = (state.geoJSON?.features || []).filter(
    (f) => f.properties?.name !== '__boundary__'
  );
  for (const f of features) {
    if (f.properties.name.toLowerCase().includes(kw)) {
      regionResults.push({
        name: f.properties.name,
        id: f.properties.id,
        coordinates: f.properties.coordinates || f.properties.districtCenter,
        isRegion: true,
        tags: f.properties.tags || [],
      });
    }
  }

  renderSearchResults(locResults, regionResults);
}

function renderSearchResults(locResults, regionResults) {
  const container = document.getElementById('search-results');
  if (!container) return;

  // 兼容旧调用方式
  if (!Array.isArray(regionResults)) {
    regionResults = [];
  }
  if (!locResults) locResults = [];

  if (locResults.length === 0 && regionResults.length === 0) {
    container.innerHTML = '';
    return;
  }

  let html = '';

  // 区域结果
  for (const reg of regionResults) {
    html += `<div class="search-result-item" data-type="region" data-id="${reg.id}">
      <span class="type-icon">\u{1F5FA}</span>
      <span class="name">${reg.name}</span>
      <span class="coords">区域</span>
    </div>`;
  }

  // 地点结果
  for (const loc of locResults) {
    const tc = TYPE_CONFIG[loc.type] || TYPE_CONFIG.other;
    html += `<div class="search-result-item" data-type="location" data-id="${loc.id}">
      <span class="type-icon">${tc.icon}</span>
      <span class="name">${loc.name}</span>
      <span class="coords">[${loc.coordinates[0]}, ${loc.coordinates[1]}]</span>
    </div>`;
  }

  container.innerHTML = html;

  container.querySelectorAll('.search-result-item').forEach((item) => {
    item.addEventListener('click', () => {
      if (item.dataset.type === 'region') {
        // 点击区域搜索结果 → 展开到对应级别
        const features = (state.geoJSON?.features || []).filter(
          (f) => f.properties?.name !== '__boundary__'
        );
        const f = features.find((ft) => ft.properties.id === item.dataset.id);
        if (f) {
          renderer.focusOnRegion(f.properties.id);
          handleRegionClick({
            name: f.properties.name,
            id: f.properties.id,
            type: f.properties.locationType || 'district',
            description: f.properties.description || '',
            history: f.properties.history || [],
            tags: f.properties.tags || [],
            relatedCharacters: f.properties.relatedCharacters || [],
            coordinates: f.properties.coordinates || f.properties.districtCenter,
            level: f.properties.level ?? 1,
            isRegion: true,
          });
        }
      } else {
        // 点击地点搜索结果 → 展开到地点所在城区
        const loc = state.locations.find((l) => l.id === item.dataset.id);
        if (loc) {
          renderer.focusOnLocation(loc);
          handleLocationClick({
            id: loc.id, name: loc.name, type: loc.type, value: loc.coordinates,
          });
        }
      }
    });
  });
}

// ============================================================
// 地点详情弹窗
// ============================================================
async function handleLocationClick(data) {
  try {
    const res = await api.getLocation(data.id);
    showDetailModal(res.data);
  } catch (err) {
    console.error('[App] 加载地点详情失败:', err.message);
  }
}

// ============================================================
// 区域点击：渲染器已处理钻入和缩放，这里只显示 Toast
// ============================================================
function handleRegionClick(detail) {
  const node = renderer.regionTree[detail.id];
  const childCount = node ? node.children.length : 0;
  const subLocs = state.locations.filter((l) => l.parentId === detail.id);
  const levelName = LEVEL_CONFIG[detail.level]?.name || '区域';

  let msg;
  if (childCount > 0) {
    msg = `已进入「${detail.name}」(${levelName})，共有 ${childCount} 个子级`;
  } else if (subLocs.length > 0) {
    msg = `已进入「${detail.name}」(${levelName})，区域内有 ${subLocs.length} 个地点`;
  } else {
    msg = `已进入「${detail.name}」(${levelName})`;
  }

  showToast(msg, () => {
    showDetailModal({ ...detail, isRegion: true });
  });
}

// ============================================================
// 建筑模式: 进入/退出建筑瓦片视图
// ============================================================
function handleEnterBuilding(info) {
  const { buildingId, buildingName, detail, floors } = info;

  // 显示楼层切换器
  const switcher = document.getElementById('floor-switcher');
  const btnContainer = document.getElementById('floor-buttons');
  if (switcher && btnContainer) {
    btnContainer.innerHTML = '';
    floors.forEach((f) => {
      const btn = document.createElement('button');
      btn.className = 'floor-btn';
      btn.textContent = f;
      btn.dataset.floor = f;
      btn.addEventListener('click', () => {
        renderer.switchFloor(f);
        document.querySelectorAll('.floor-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
      });
      btnContainer.appendChild(btn);
    });
    // 默认激活第一层
    const firstBtn = btnContainer.querySelector('.floor-btn');
    if (firstBtn) firstBtn.classList.add('active');
    switcher.style.display = 'flex';
  }

  showToast(`已进入建筑「${buildingName}」平面图`, () => {
    showDetailModal({ ...detail, isRegion: true });
  });
}

function handleExitBuilding() {
  const switcher = document.getElementById('floor-switcher');
  if (switcher) switcher.style.display = 'none';
}

// ============================================================
// 瓦片点击: 显示瓦片信息
// ============================================================
function handleTileClick(info) {
  const { x, y, tile, tileName, label, floor, building } = info;
  const msg = label
    ? `${building} ${floor} - ${label} (${tileName})`
    : `${building} ${floor} - 坐标(${x},${y}) ${tileName}`;
  showToast(msg);
}

// ============================================================
// 级别变化：更新面包屑导航（支持任意深度 + 建筑模式）
// ============================================================
function handleLevelChange(info) {
  const breadcrumb = document.getElementById('breadcrumb');
  if (!breadcrumb) return;

  const { path, pathNames, depth, tileMode, floors, currentFloor } = info;

  // 构建面包屑 HTML
  let html = '';
  for (let i = 0; i < pathNames.length; i++) {
    const isLast = i === pathNames.length - 1;
    if (isLast) {
      html += `<span class="breadcrumb-item active">${pathNames[i]}</span>`;
    } else {
      html += `<span class="breadcrumb-item" data-path-index="${i}">${pathNames[i]}</span>`;
      html += `<span class="breadcrumb-sep">/</span>`;
    }
  }

  // 建筑模式: 添加楼层标记
  if (tileMode && currentFloor) {
    html += `<span class="breadcrumb-sep">/</span>`;
    html += `<span class="breadcrumb-item active floor-badge">${currentFloor}</span>`;
  }

  breadcrumb.innerHTML = html;

  // 面包屑点击 → 跳转到对应层级
  breadcrumb.querySelectorAll('.breadcrumb-item:not(.active):not(.floor-badge)').forEach((item) => {
    item.style.cursor = 'pointer';
    item.addEventListener('click', () => {
      const idx = parseInt(item.dataset.pathIndex, 10);
      renderer.jumpToPath(idx);
    });
  });

  // 显示/隐藏返回按钮
  const backBtn = document.getElementById('back-btn');
  if (backBtn) {
    backBtn.style.display = depth > 0 ? 'flex' : 'none';
  }

  // 建筑模式: 更新楼层按钮激活状态
  if (tileMode && currentFloor) {
    document.querySelectorAll('.floor-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.floor === currentFloor);
    });
  }
}

// ============================================================
// Toast 通知（短暂提示，不遮挡地图）
// ============================================================
let _toastTimer = null;
function showToast(message, onClick) {
  let toast = document.getElementById('map-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'map-toast';
    toast.style.cssText = `
      position: fixed; top: 70px; left: 50%; transform: translateX(-50%);
      background: rgba(15, 21, 37, 0.95); border: 1px solid rgba(0, 212, 255, 0.4);
      border-radius: 8px; padding: 10px 20px; color: #e0e6ed; font-size: 13px;
      z-index: 9999; cursor: pointer; transition: opacity 0.3s, transform 0.3s;
      box-shadow: 0 4px 20px rgba(0, 212, 255, 0.15); max-width: 80vw;
      backdrop-filter: blur(8px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    `;
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.style.opacity = '1';
  toast.style.transform = 'translateX(-50%) translateY(0)';
  toast.onclick = onClick || null;

  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(-10px)';
  }, 3500);
}

function showDetailModal(loc) {
  const tc = TYPE_CONFIG[loc.type] || TYPE_CONFIG.other;
  const body = document.getElementById('detail-body');

  // 区域标记
  const regionBadge = loc.isRegion
    ? '<span class="detail-type" style="background:rgba(0,212,255,0.15);color:#00d4ff;margin-left:8px">区域</span>'
    : '';

  let html = `
    <div class="detail-header">
      <div class="detail-icon">${tc.icon}</div>
      <div class="detail-title">
        <div class="detail-name">${loc.name}${regionBadge}</div>
        <span class="detail-type" style="background:${tc.color}22;color:${tc.color}">
          ${tc.label}
        </span>
      </div>
      ${loc.coordinates ? `<div class="detail-coords">[${loc.coordinates[0]}, ${loc.coordinates[1]}]</div>` : ''}
    </div>
  `;

  if (loc.description) {
    html += `
      <div class="detail-section">
        <div class="detail-section-title">描述</div>
        <div class="detail-description">${loc.description}</div>
      </div>
    `;
  }

  if (loc.history && loc.history.length > 0) {
    html += `
      <div class="detail-section">
        <div class="detail-section-title">历史事件</div>
        <ul class="detail-history">
          ${loc.history.map((h) => `
            <li class="detail-history-item">
              ${h.time ? `<div class="detail-history-time">${h.time}</div>` : ''}
              ${h.event || h.description || h}
            </li>
          `).join('')}
        </ul>
      </div>
    `;
  }

  if (loc.relatedCharacters && loc.relatedCharacters.length > 0) {
    html += `
      <div class="detail-section">
        <div class="detail-section-title">关联人物</div>
        <div class="detail-characters">
          ${loc.relatedCharacters.map((c) => `<span class="character-tag">${c}</span>`).join('')}
        </div>
      </div>
    `;
  }

  if (loc.tags && loc.tags.length > 0) {
    html += `
      <div class="detail-section">
        <div class="detail-section-title">标签</div>
        <div class="detail-tags">
          ${loc.tags.map((t) => `<span class="tag">${t}</span>`).join('')}
        </div>
      </div>
    `;
  }

  if (loc.imageUrl) {
    html += `
      <div class="detail-section">
        <div class="detail-section-title">图片</div>
        <img src="${loc.imageUrl}" alt="${loc.name}" style="width:100%;border-radius:4px;">
      </div>
    `;
  }

  html += `
    <div class="detail-meta">
      <span>创建者: ${loc.createdBy || '未知'}</span>
      <span>创建于: ${loc.createdAt ? new Date(loc.createdAt).toLocaleString('zh-CN') : '未知'}</span>
      <span>版本: v${loc.version || 1}</span>
    </div>
  `;

  body.innerHTML = html;
  document.getElementById('detail-modal').classList.remove('hidden');
}

// ============================================================
// API 文档弹窗
// ============================================================
function showAPIModal() {
  const body = document.getElementById('api-body');

  let html = `
    <h2 style="font-family:var(--font-display);color:var(--accent);margin-bottom:16px">
      API 接口文档
    </h2>

    <div class="api-key-info">
      <div style="font-weight:600;margin-bottom:8px;color:var(--gold)">API Key 列表</div>
      <div class="api-key-row">
        <span>写作 Agent:</span>
        <span class="api-key-value">writer-agent-key-001</span>
        <span style="color:var(--text-muted)">(读写删)</span>
      </div>
      <div class="api-key-row">
        <span>RPA Agent:</span>
        <span class="api-key-value">rpa-agent-key-001</span>
        <span style="color:var(--text-muted)">(读写删)</span>
      </div>
      <div class="api-key-row">
        <span>前端浏览器:</span>
        <span class="api-key-value">viewer-key-001</span>
        <span style="color:var(--text-muted)">(只读)</span>
      </div>
    </div>

    <div class="api-section">
      <h3>地点接口</h3>
      <div class="api-endpoint">
        <span class="api-method GET">GET</span>
        <div><div class="api-path">/api/locations</div><div class="api-desc">获取全量地点列表 (支持 ?type= &tag= 筛选)</div></div>
      </div>
      <div class="api-endpoint">
        <span class="api-method GET">GET</span>
        <div><div class="api-path">/api/locations/range?x1=0&y1=0&x2=500&y2=500</div><div class="api-desc">获取指定坐标范围内的地点</div></div>
      </div>
      <div class="api-endpoint">
        <span class="api-method GET">GET</span>
        <div><div class="api-path">/api/locations/:id</div><div class="api-desc">获取特定地点详情</div></div>
      </div>
      <div class="api-endpoint">
        <span class="api-method POST">POST</span>
        <div><div class="api-path">/api/locations</div><div class="api-desc">新增地点 (需 API Key, 含冲突检测)</div></div>
      </div>
      <div class="api-endpoint">
        <span class="api-method PUT">PUT</span>
        <div><div class="api-path">/api/locations/:id</div><div class="api-desc">更新地点详情 (需 API Key)</div></div>
      </div>
      <div class="api-endpoint">
        <span class="api-method DELETE">DEL</span>
        <div><div class="api-path">/api/locations/:id</div><div class="api-desc">删除地点 (需 API Key)</div></div>
      </div>
    </div>

    <div class="api-section">
      <h3>地图结构接口</h3>
      <div class="api-endpoint">
        <span class="api-method GET">GET</span>
        <div><div class="api-path">/api/map/structure</div><div class="api-desc">获取地图 GeoJSON 结构</div></div>
      </div>
      <div class="api-endpoint">
        <span class="api-method GET">GET</span>
        <div><div class="api-path">/api/map/layers</div><div class="api-desc">获取图层列表</div></div>
      </div>
      <div class="api-endpoint">
        <span class="api-method POST">POST</span>
        <div><div class="api-path">/api/map/features</div><div class="api-desc">新增地图区域 (需 API Key)</div></div>
      </div>
      <div class="api-endpoint">
        <span class="api-method PUT">PUT</span>
        <div><div class="api-path">/api/map/features/:id</div><div class="api-desc">更新地图区域 (需 API Key)</div></div>
      </div>
      <div class="api-endpoint">
        <span class="api-method DELETE">DEL</span>
        <div><div class="api-path">/api/map/features/:id</div><div class="api-desc">删除地图区域 (需 API Key)</div></div>
      </div>
      <div class="api-endpoint">
        <span class="api-method PUT">PUT</span>
        <div><div class="api-path">/api/map/structure</div><div class="api-desc">批量替换地图结构 (需 API Key)</div></div>
      </div>
    </div>

    <div class="api-section">
      <h3>版本控制接口</h3>
      <div class="api-endpoint">
        <span class="api-method GET">GET</span>
        <div><div class="api-path">/api/versions</div><div class="api-desc">获取版本列表</div></div>
      </div>
      <div class="api-endpoint">
        <span class="api-method POST">POST</span>
        <div><div class="api-path">/api/versions/:version/rollback</div><div class="api-desc">回滚到指定版本 (需 API Key)</div></div>
      </div>
      <div class="api-endpoint">
        <span class="api-method POST">POST</span>
        <div><div class="api-path">/api/versions/snapshot</div><div class="api-desc">手动创建版本快照 (需 API Key)</div></div>
      </div>
    </div>

    <div class="api-section">
      <h3>日志与记忆接口</h3>
      <div class="api-endpoint">
        <span class="api-method GET">GET</span>
        <div><div class="api-path">/api/logs</div><div class="api-desc">获取操作日志 (支持 ?agentName= &action= &limit=)</div></div>
      </div>
      <div class="api-endpoint">
        <span class="api-method GET">GET</span>
        <div><div class="api-path">/api/logs/timeline</div><div class="api-desc">获取世界观演变时间线</div></div>
      </div>
      <div class="api-endpoint">
        <span class="api-method GET">GET</span>
        <div><div class="api-path">/api/memory/summary</div><div class="api-desc">世界观演变摘要</div></div>
      </div>
      <div class="api-endpoint">
        <span class="api-method GET">GET</span>
        <div><div class="api-path">/api/memory/timeline</div><div class="api-desc">Agent 记忆时间线</div></div>
      </div>
    </div>

    <div class="api-section">
      <h3>调用示例</h3>
      <div style="margin-bottom:12px;color:var(--text-secondary);font-size:12px">新增地点:</div>
      <div class="api-example">curl -X POST http://localhost:3000/api/locations \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: writer-agent-key-001" \\
  -d '{
    "name": "迷雾森林",
    "coordinates": [780, 450],
    "type": "landmark",
    "description": "一片常年被浓雾笼罩的神秘森林",
    "tags": ["神秘", "危险"],
    "context": "用户描述了该区域的氛围"
  }'</div>

      <div style="margin:12px 0;color:var(--text-secondary);font-size:12px">新增区域:</div>
      <div class="api-example">curl -X POST http://localhost:3000/api/map/features \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: writer-agent-key-001" \\
  -d '{
    "type": "Feature",
    "properties": {
      "name": "翠绿平原",
      "id": "verdant_plains",
      "type": "plains",
      "color": "rgba(30, 70, 50, 0.35)"
    },
    "geometry": {
      "type": "Polygon",
      "coordinates": [[[300,320],[700,320],[720,550],[700,680],[350,680],[330,520],[340,420]]]
    }
  }'</div>

      <div style="margin:12px 0;color:var(--text-secondary);font-size:12px">查询地点:</div>
      <div class="api-example">curl http://localhost:3000/api/locations?type=city</div>
    </div>

    <div class="api-section">
      <h3>坐标系统</h3>
      <p style="color:var(--text-secondary);font-size:13px">
        所有地点坐标基于统一的相对坐标系（0-1000 平面坐标），x 轴向右递增，y 轴向上递增。
        坐标范围必须在 [0, 1000] 内。新增地点时系统会自动检测坐标冲突（间距 < 15 单位）。
      </p>
    </div>
  `;

  body.innerHTML = html;
  document.getElementById('api-modal').classList.remove('hidden');
}

// ============================================================
// 版本控制
// ============================================================
function renderVersionSelect() {
  const select = document.getElementById('version-select');
  const current = select.value;

  select.innerHTML = '<option value="">-- 选择版本 --</option>';
  state.versions.forEach((v) => {
    const opt = document.createElement('option');
    opt.value = v.version;
    opt.textContent = `v${v.version} - ${v.description} (${v.locationCount}地点, ${v.featureCount}区域)`;
    select.appendChild(opt);
  });

  if (current) select.value = current;
}

async function handleRollback() {
  if (!state.selectedVersion) return;

  const version = parseInt(state.selectedVersion, 10);
  const verInfo = state.versions.find((v) => v.version === version);

  if (!confirm(`确定要回滚到版本 v${version} (${verInfo?.description}) 吗？\n当前数据将被覆盖。`)) {
    return;
  }

  try {
    await api.rollback(version, API_KEYS.writer, `前端用户手动回滚到 v${version}`);
    alert(`已回滚到版本 v${version}`);
    await loadAllData();
  } catch (err) {
    alert(`回滚失败: ${err.message}`);
  }
}

// ============================================================
// 日志渲染
// ============================================================
function renderLogs() {
  const container = document.getElementById('log-list');

  if (state.logs.length === 0) {
    container.innerHTML = '<p class="empty-text">暂无操作记录</p>';
    return;
  }

  const actionLabels = {
    create: '创建',
    update: '更新',
    delete: '删除',
    rollback: '回滚',
    map_update: '地图变更',
    snapshot: '快照',
  };

  container.innerHTML = state.logs
    .map((log) => {
      const actionLabel = actionLabels[log.action] || log.action;
      const time = new Date(log.timestamp).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });

      return `
        <div class="log-entry action-${log.action}">
          <div class="log-entry-header">
            <span class="log-agent">${log.agentName}</span>
            <span class="log-action ${log.action}">${actionLabel}</span>
          </div>
          <div class="log-context">${log.context || log.details?.name || ''}</div>
          <div class="log-time">${time}</div>
        </div>
      `;
    })
    .join('');
}

// ============================================================
// 自动刷新
// ============================================================
function startAutoRefresh() {
  if (state.refreshInterval) clearInterval(state.refreshInterval);
  state.refreshInterval = setInterval(async () => {
    await loadAllData();
  }, state.REFRESH_INTERVAL_MS);
}

function stopAutoRefresh() {
  if (state.refreshInterval) {
    clearInterval(state.refreshInterval);
    state.refreshInterval = null;
  }
}

function toggleAutoRefresh() {
  state.autoRefresh = !state.autoRefresh;
  const btn = document.getElementById('auto-refresh-toggle');
  btn.textContent = `自动刷新: ${state.autoRefresh ? '开' : '关'}`;

  if (state.autoRefresh) {
    startAutoRefresh();
  } else {
    stopAutoRefresh();
  }
}

// ============================================================
// 启动
// ============================================================
window.addEventListener('DOMContentLoaded', init);
