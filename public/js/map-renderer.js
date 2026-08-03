// ============================================================
// map-renderer.js - ECharts 地图渲染引擎 v5
// 支持任意层级深度: 大陆→城市→区域→建筑群→建筑
// 核心设计: 只注册当前活跃区域的直接子级，消除重叠和点击问题
// 混合层级: 同一视图可同时显示不同层级的区域（如城市旁的独立小宅）
// ============================================================

// ---- 种子化 PRNG (mulberry32) ----
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- 贝塞尔曲线插值 ----
function bezierPoint(points, t) {
  if (points.length === 1) return [...points[0]];
  const next = [];
  for (let i = 0; i < points.length - 1; i++) {
    next.push([
      points[i][0] * (1 - t) + points[i + 1][0] * t,
      points[i][1] * (1 - t) + points[i + 1][1] * t,
    ]);
  }
  return bezierPoint(next, t);
}

// ---- 层级配置 ----
const LEVEL_CONFIG = {
  1: { name: '大陆',   fontSize: 18, fontWeight: 700, zoom: 1   },
  2: { name: '城市',   fontSize: 16, fontWeight: 700, zoom: 2.5 },
  3: { name: '区域',   fontSize: 13, fontWeight: 600, zoom: 5   },
  4: { name: '建筑群', fontSize: 12, fontWeight: 500, zoom: 8   },
  5: { name: '建筑',   fontSize: 11, fontWeight: 500, zoom: 12  },
};

class MapRenderer {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.chart = null;
    this.geoJSON = { type: 'FeatureCollection', features: [] };
    this.locations = [];
    this.layers = { regions: true, markers: true, labels: true, grid: false, roads: true };
    this.typeFilter = new Set();
    this.searchKeyword = '';
    this.callbacks = {};
    this._graphicTimer = null;
    this._graphicRAF = null;  // requestAnimationFrame ID，用于 georoam 事件
    this._focusTimer = null;
    this.roadSeed = 42;
    this.roads = [];
    this.regionDetails = {};

    // ============================================================
    // 视图状态 (中心/缩放) - 由本类管理，setOption 不再依赖 ECharts 内部
    // 关键修复: 之前 buildOption 中 geo 没有 center/zoom，
    // 每次 updateData(true 模式) 都会把视图打回默认值，造成"回弹"
    // ============================================================
    this.viewCenter = null;  // [x, y] 或 null
    this.viewZoom = 1;       // 默认 1

    // ============================================================
    // 层级状态
    // activeRegionId: 当前活跃区域 ID (null = 顶层世界地图)
    // activeRegionPath: 从根到当前的完整路径 [null, 'city_id', 'district_id', ...]
    // ============================================================
    this.activeRegionId = null;
    this.activeRegionPath = [null]; // 路径栈，用于面包屑和返回
    this.mapName = 'worldview_root'; // 动态地图名称
    // regionTree: { id: { level, parent, children: [], center, name, hasChildren, tileMap } }
    this.regionTree = {};

    // ============================================================
    // 建筑平面图模式
    // ============================================================
    this.tileMode = false;          // 是否处于瓦片渲染模式
    this.tileRenderer = null;       // TileRenderer 实例
    this.activeBuildingId = null;   // 当前查看的建筑 ID
  }

  // ---- 初始化 ----
  init() {
    this.chart = echarts.init(this.container, null, { renderer: 'canvas' });
    this.registerMap();
    this.chart.setOption(this.buildOption(), true);
    this.setupEvents();
    setTimeout(() => this.renderGraphics(), 200);
    window.addEventListener('resize', () => {
      this.chart.resize();
      this.renderGraphics();
    });
  }

  on(event, cb) { this.callbacks[event] = cb; }

  // ============================================================
  // 地图注册 - 核心：只注册当前活跃区域的直接子级
  // 使用动态地图名称强制 ECharts 重新渲染
  // ============================================================
  registerMap() {
    const visibleFeatures = (this.geoJSON.features || []).filter((f) => {
      if (!f.properties?.name || f.properties?.name === '__boundary__') return false;
      const parent = f.properties?.parentRegion || null;
      if (this.activeRegionId === null) {
        return !parent;
      }
      return parent === this.activeRegionId;
    });

    const features = [{
      type: 'Feature',
      properties: { name: '__boundary__', id: '__boundary__' },
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [1000, 0], [1000, 1000], [0, 1000], [0, 0]]] },
    }, ...visibleFeatures];

    // 动态地图名称 - 每次层级变化都使用新名称
    this.mapName = 'worldview_' + (this.activeRegionId || 'root');
    echarts.registerMap(this.mapName, { type: 'FeatureCollection', features });
    
    console.log('[Renderer] registerMap:', this.mapName, '| features:', visibleFeatures.length, '| activeRegionId:', this.activeRegionId);
  }

  // ============================================================
  // 事件处理
  // ============================================================
  setupEvents() {
    // ============================================================
    // ECharts 点击事件 - 唯一路径
    // 关键修复: 移除 DOM canvas click handler, 它通过 capture=true
    // 抢先于 ECharts 内部处理, 其 drillInto → setOption 会干扰
    // ECharts 的事件分发, 导致高亮和点击不可靠
    // ============================================================
    this.chart.on('click', (params) => {
      if (this._drillGuard) return;

      // 地点图钉点击
      if (params.seriesType === 'scatter' && params.data?.id) {
        this._drillGuard = true;
        this.callbacks.locationClick?.(params.data);
        setTimeout(() => { this._drillGuard = false; }, 200);
        return;
      }

      // 区域色块点击 - 通过名称查找
      const name = params.name;
      if (name && name !== '__boundary__' && this.regionDetails[name]) {
        const detail = this.regionDetails[name];
        this._drillGuard = true;
        this.drillInto(detail.id);
        setTimeout(() => { this._drillGuard = false; }, 200);
        return;
      }
    });

    // ============================================================
    // mousedown 仅用于拖拽检测 (不再做 click 后备)
    // ============================================================
    this._mouseDownPos = null;
    const canvas = this.container.querySelector('canvas');
    if (canvas) {
      canvas.addEventListener('mousedown', (e) => {
        const rect = this.container.getBoundingClientRect();
        this._mouseDownPos = [e.clientX - rect.left, e.clientY - rect.top];
      });
    }

    // 缩放/拖拽 → 同步视图状态
    // 关键优化: 道路已改为 lines series (coordinateSystem: 'geo'),
    // ECharts 原生处理缩放变换, 完全跟手, 无需手动重绘。
    // 仅网格(grid)需要手动更新, 且使用节流避免性能问题。
    this.chart.on('georoam', () => {
      const opt = this.chart.getOption();
      const zoom = opt.geo[0].zoom || 1;
      const center = opt.geo[0].center || null;
      // 关键: 同步视图状态到本类管理，避免后续 setOption 丢失
      this.viewZoom = zoom;
      this.viewCenter = center;
      this.callbacks.zoomChange?.(Math.round(zoom * 100));
      
      // 仅网格需要手动更新 (可选图层, 非实时需求), 使用节流
      if (this.layers.grid) {
        if (this._graphicRAF) {
          cancelAnimationFrame(this._graphicRAF);
        }
        this._graphicRAF = requestAnimationFrame(() => {
          this.renderGraphics();
          this._graphicRAF = null;
        });
      }
    });

    // 鼠标移动 → 坐标显示
    this.chart.getZr().on('mousemove', (e) => {
      const coords = this.chart.convertFromPixel({ geoIndex: 0 }, [e.offsetX, e.offsetY]);
      if (coords) {
        const x = Math.round(coords[0]);
        const y = Math.round(coords[1]);
        if (x >= -50 && x <= 1050 && y >= -50 && y <= 1050) {
          this.callbacks.coordinateChange?.(x, y);
        }
      }
    });
  }

  // ============================================================
  // 点在多边形内判断（射线法）- 用于 zr click 后备方案
  // ============================================================
  pointInRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1];
      const xj = ring[j][0], yj = ring[j][1];
      const intersect = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  findRegionAtPoint(x, y) {
    const features = (this.geoJSON.features || []).filter(
      (f) => f.properties?.name !== '__boundary__'
    );

    // 只检查当前可见的区域（直接子级）
    for (const f of features) {
      const parent = f.properties?.parentRegion || null;
      if (this.activeRegionId === null) {
        if (parent) continue; // 顶层只匹配无父级的区域
      } else {
        if (parent !== this.activeRegionId) continue;
      }

      if (f.geometry?.type === 'Polygon') {
        if (this.pointInRing(x, y, f.geometry.coordinates[0])) {
          return f;
        }
      }
    }
    return null;
  }

  // ============================================================
  // 钻入区域 - 设置为活跃区域，显示其子级
  // 如果是建筑级别(level 5)且有 tileMap，切换到瓦片渲染模式
  // 关键修复:
  //   1. 幂等保护 - 同一区域重复点击不会 push 路径
  //   2. 视图状态由 viewCenter/viewZoom 管理，与 updateData 保持一致
  //   3. 在 setOption 中直接传 center/zoom,统一管理
  // ============================================================
  drillInto(regionId) {
    if (!regionId) return;
    const node = this.regionTree[regionId];
    if (!node) {
      console.warn('[Renderer] drillInto: 区域不存在', regionId);
      return;
    }
    const detail = this.regionDetails[node.name];
    if (!detail) return;

    // 幂等保护 - 已经是当前活跃区域则忽略
    if (this.activeRegionId === regionId && !this.tileMode) {
      // 已经是该区域,只触发一次回调即可
      this.callbacks.regionClick?.(detail);
      return;
    }

    // 取消任何未完成的 focus 延迟,防止旧调用覆盖新状态
    if (this._focusTimer) {
      clearTimeout(this._focusTimer);
      this._focusTimer = null;
    }

    // ---- 建筑级别: 检查是否有 tileMap ----
    if (node.level === 5 && node.tileMap) {
      this.activeBuildingId = regionId;
      this.activeRegionId = regionId;
      // 避免重复 push: 如果路径最后一项已经是该 ID 则不 push
      if (this.activeRegionPath[this.activeRegionPath.length - 1] !== regionId) {
        this.activeRegionPath.push(regionId);
      }
      this.enterTileMode(node, detail);
      this.callbacks.regionClick?.(detail);
      this.fireLevelChange();
      return;
    }

    // 更新路径栈 - 避免重复 push
    if (this.activeRegionPath[this.activeRegionPath.length - 1] !== regionId) {
      this.activeRegionPath.push(regionId);
    }
    this.activeRegionId = regionId;

    // 重新注册地图 + 生成道路 + 刷新
    this.generateRoads();
    this.registerMap();

    // 关键: 更新视图状态管理
    const levelCfg = LEVEL_CONFIG[node.level] || LEVEL_CONFIG[3];
    if (node.center) {
      this.viewCenter = [...node.center];
      this.viewZoom = levelCfg.zoom;
    }

    // 用合并模式，让本类 viewCenter/viewZoom 同步给 ECharts
    this.chart.setOption(this.buildOption(), false);
    setTimeout(() => this.renderGraphics(), 100);

    // 通知 UI
    this.callbacks.regionClick?.(detail);
    this.fireLevelChange();
  }

  // ============================================================
  // 进入建筑瓦片渲染模式
  // ============================================================
  enterTileMode(node, detail) {
    // 先清理之前的状态(但不恢复 ECharts,因为我们马上要再隐藏)
    this.tileMode = false;
    this.activeBuildingId = null;
    if (this.tileRenderer) {
      this.tileRenderer.hide();
    }

    // 重新设置为新建筑
    this.tileMode = true;
    this.activeBuildingId = node.id;

    // 隐藏 ECharts 图表
    if (this.chart) {
      this.chart.getZr().painter.getViewportRoot().style.display = 'none';
    }

    // 显示瓦片渲染器
    if (this.tileRenderer) {
      this.tileRenderer.loadBuilding(node.tileMap, node.name);
      this.tileRenderer.show();
    }

    // 通知 UI 进入建筑模式
    this.callbacks.enterBuilding?.({
      buildingId: node.id,
      buildingName: node.name,
      detail: detail,
      floors: this.tileRenderer?.getFloors() || [],
    });
  }

  // ============================================================
  // 退出建筑瓦片渲染模式
  // ============================================================
  exitTileMode(restoreECharts = true) {
    if (!this.tileMode && !this.activeBuildingId) return;

    this.tileMode = false;
    this.activeBuildingId = null;

    // 隐藏瓦片渲染器
    if (this.tileRenderer) {
      this.tileRenderer.hide();
    }

    // 恢复 ECharts
    if (restoreECharts && this.chart) {
      this.chart.getZr().painter.getViewportRoot().style.display = 'block';
      this.chart.resize();
    }

    // 通知 UI 退出建筑模式
    this.callbacks.exitBuilding?.();
  }

  // ============================================================
  // 切换楼层 (建筑模式)
  // ============================================================
  switchFloor(floorKey) {
    if (this.tileRenderer && this.tileMode) {
      this.tileRenderer.switchFloor(floorKey);
    }
  }

  // ---- 设置瓦片渲染器 ----
  setTileRenderer(tr) {
    this.tileRenderer = tr;
  }

  // ============================================================
  // 返回上级
  // 关键修复: 视图状态 (viewCenter/viewZoom) 与 buildOption 同步
  // ============================================================
  goBack() {
    if (this.activeRegionPath.length <= 1) return;

    // 取消未完成的 focus 延迟
    if (this._focusTimer) {
      clearTimeout(this._focusTimer);
      this._focusTimer = null;
    }

    // 如果在瓦片模式,先退出
    if (this.tileMode) {
      this.exitTileMode(true);
    }

    // 弹出当前区域
    this.activeRegionPath.pop();
    const parentId = this.activeRegionPath[this.activeRegionPath.length - 1];
    this.activeRegionId = parentId;

    this.generateRoads();
    this.registerMap();

    // 关键: 同步视图状态
    if (parentId) {
      const parent = this.regionTree[parentId];
      if (parent && parent.center) {
        const levelCfg = LEVEL_CONFIG[parent.level] || LEVEL_CONFIG[3];
        this.viewCenter = [...parent.center];
        this.viewZoom = levelCfg.zoom;
      } else {
        this.viewCenter = null;
        this.viewZoom = 1;
      }
    } else {
      this.viewCenter = null;
      this.viewZoom = 1;
    }

    this.chart.setOption(this.buildOption(), false);
    setTimeout(() => this.renderGraphics(), 100);

    this.fireLevelChange();
  }

  // ============================================================
  // 跳转到指定级别（面包屑点击）
  // 关键修复: 视图状态 (viewCenter/viewZoom) 与 buildOption 同步
  // ============================================================
  jumpToPath(index) {
    if (index < 0 || index >= this.activeRegionPath.length) return;

    // 取消未完成的 focus 延迟
    if (this._focusTimer) {
      clearTimeout(this._focusTimer);
      this._focusTimer = null;
    }

    // 如果在瓦片模式,先退出
    if (this.tileMode) {
      this.exitTileMode(true);
    }

    this.activeRegionPath = this.activeRegionPath.slice(0, index + 1);
    this.activeRegionId = this.activeRegionPath[this.activeRegionPath.length - 1];

    this.generateRoads();
    this.registerMap();

    // 关键: 同步视图状态
    if (this.activeRegionId) {
      const node = this.regionTree[this.activeRegionId];
      if (node && node.center) {
        const levelCfg = LEVEL_CONFIG[node.level] || LEVEL_CONFIG[3];
        this.viewCenter = [...node.center];
        this.viewZoom = levelCfg.zoom;
      } else {
        this.viewCenter = null;
        this.viewZoom = 1;
      }
    } else {
      this.viewCenter = null;
      this.viewZoom = 1;
    }

    this.chart.setOption(this.buildOption(), false);
    setTimeout(() => this.renderGraphics(), 100);

    this.fireLevelChange();
  }

  // ---- 触发级别变化回调 ----
  fireLevelChange() {
    // 构建路径名称数组
    const pathNames = this.activeRegionPath.map((id) => {
      if (id === null) return '世界地图';
      return this.regionTree[id]?.name || '';
    });

    this.callbacks.levelChange?.({
      activeRegionId: this.activeRegionId,
      path: this.activeRegionPath,
      pathNames: pathNames,
      depth: this.activeRegionPath.length - 1,
      tileMode: this.tileMode,
      buildingId: this.activeBuildingId,
      floors: this.tileMode && this.tileRenderer ? this.tileRenderer.getFloors() : [],
      currentFloor: this.tileMode && this.tileRenderer ? this.tileRenderer.currentFloor : null,
    });
  }

  // ============================================================
  // 道路生成（种子化贝塞尔曲线）- 连接当前活跃区域的直接子级
  // ============================================================
  generateRoads() {
    const allPoints = [];

    if (this.activeRegionId === null) {
      // 顶层：连接所有顶层区域
      const topFeatures = (this.geoJSON.features || []).filter((f) => {
        if (f.properties?.name === '__boundary__') return false;
        return !f.properties?.parentRegion;
      });
      for (const f of topFeatures) {
        const coords = f.properties?.coordinates || f.properties?.districtCenter;
        if (coords) {
          allPoints.push({ name: f.properties.name, id: f.properties.id, coordinates: coords });
        }
      }
    } else {
      // 子级：连接当前区域的直接子区域 + 直接子地点
      const childFeatures = (this.geoJSON.features || []).filter((f) => {
        if (f.properties?.name === '__boundary__') return false;
        return f.properties?.parentRegion === this.activeRegionId;
      });
      for (const f of childFeatures) {
        const coords = f.properties?.coordinates || f.properties?.districtCenter;
        if (coords) {
          allPoints.push({ name: f.properties.name, id: f.properties.id, coordinates: coords });
        }
      }

      // 直接子地点
      const childLocs = this.locations.filter((l) => l.parentId === this.activeRegionId);
      for (const loc of childLocs) {
        allPoints.push({ name: loc.name, id: loc.id, coordinates: loc.coordinates });
      }

      // 当前区域中心作为枢纽
      const region = this.regionTree[this.activeRegionId];
      if (region && region.center) {
        allPoints.push({ name: region.name, id: region.id, coordinates: region.center });
      }
    }

    if (allPoints.length < 2) {
      this.roads = [];
      return;
    }

    const rng = mulberry32(this.roadSeed + (this.activeRegionId?.length || 0) * 100);
    const seen = new Set();
    const roads = [];

    for (let i = 0; i < allPoints.length; i++) {
      const a = allPoints[i];
      const dists = [];
      for (let j = 0; j < allPoints.length; j++) {
        if (i === j) continue;
        const dx = a.coordinates[0] - allPoints[j].coordinates[0];
        const dy = a.coordinates[1] - allPoints[j].coordinates[1];
        dists.push({ idx: j, d: Math.sqrt(dx * dx + dy * dy) });
      }
      dists.sort((p, q) => p.d - q.d);

      const numConn = 2 + Math.floor(rng() * 2);
      for (let k = 0; k < Math.min(numConn, dists.length); k++) {
        const j = dists[k].idx;
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const b = allPoints[j];
        const path = this.generateCurvedPath(a.coordinates, b.coordinates, rng);
        roads.push({ coords: path, from: a.name, to: b.name });
      }
    }
    this.roads = roads;
  }

  generateCurvedPath(start, end, rng) {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return [[...start], [...end]];

    const numCP = dist > 150 ? 3 : dist > 80 ? 2 : 1;
    const ctrl = [[...start]];
    const perpX = -dy / dist;
    const perpY = dx / dist;

    for (let i = 1; i <= numCP; i++) {
      const t = i / (numCP + 1);
      const bx = start[0] + dx * t;
      const by = start[1] + dy * t;
      const offsetMag = (rng() - 0.5) * dist * 0.35;
      ctrl.push([bx + perpX * offsetMag, by + perpY * offsetMag]);
    }
    ctrl.push([...end]);

    const samples = 24;
    const path = [];
    for (let i = 0; i <= samples; i++) {
      path.push(bezierPoint(ctrl, i / samples));
    }
    return path;
  }

  // ============================================================
  // 统一渲染 graphic（仅网格）- 道路已改为 lines series, 由 ECharts 原生变换
  // ============================================================
  renderGraphics() {
    if (!this.chart) return;
    const graphics = [];

    // ---- 坐标网格 ----
    if (this.layers.grid) {
      const step = 100;
      for (let x = 0; x <= 1000; x += step) {
        const p1 = this.chart.convertToPixel({ geoIndex: 0 }, [x, 0]);
        const p2 = this.chart.convertToPixel({ geoIndex: 0 }, [x, 1000]);
        if (p1 && p2) {
          graphics.push({
            type: 'line', shape: { x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1] },
            style: { stroke: x === 500 ? 'rgba(0,212,255,0.15)' : 'rgba(100,150,200,0.06)', lineWidth: x === 500 ? 1.5 : 1 },
            silent: true, z: 1,
          });
        }
      }
      for (let y = 0; y <= 1000; y += step) {
        const p1 = this.chart.convertToPixel({ geoIndex: 0 }, [0, y]);
        const p2 = this.chart.convertToPixel({ geoIndex: 0 }, [1000, y]);
        if (p1 && p2) {
          graphics.push({
            type: 'line', shape: { x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1] },
            style: { stroke: y === 500 ? 'rgba(0,212,255,0.15)' : 'rgba(100,150,200,0.06)', lineWidth: y === 500 ? 1.5 : 1 },
            silent: true, z: 1,
          });
        }
      }
    }

    // 关键修复: 使用 replaceMerge 只替换 graphic 组件，不影响其他配置
    // 否则层级切换后，旧层级的网格会残留
    this.chart.setOption({ graphic: graphics }, { replaceMerge: ['graphic'] });
  }

  // ============================================================
  // 判断区域是否有子级（区域或地点）
  // ============================================================
  hasChildren(regionId) {
    const node = this.regionTree[regionId];
    if (!node) return false;
    return node.children.length > 0;
  }

  // ============================================================
  // ECharts 配置
  // 关键修复: geo 中心/缩放由 viewCenter/viewZoom 管理
  // 这样 updateData(setOption) 不再丢失用户的视图
  // ============================================================
  buildOption() {
    const regionStyles = this.buildRegionStyles();
    const markerData = this.buildMarkerData();
    const highlightData = this.buildHighlightData(markerData);

    // 当前活跃区域的级别配置
    let activeLevel = 1;
    if (this.activeRegionId) {
      activeLevel = this.regionTree[this.activeRegionId]?.level || 1;
    }
    const levelCfg = LEVEL_CONFIG[activeLevel] || LEVEL_CONFIG[1];

    // ---- 构造 geo 配置，强制使用本类管理的视图状态 ----
    const geoConfig = {
      map: this.mapName,
      roam: true,
      boundingCoords: [[0, 0], [1000, 1000]],
      zoom: this.viewZoom,
      scaleLimit: { min: 0.5, max: 30 },
      layoutCenter: ['50%', '50%'],
      layoutSize: '95%',

      // 关键修复: 关闭 geo 动画，避免缩放时区域色块从屏幕外飞入
      // geo 组件不需要入场动画，缩放/拖拽应即时响应
      animation: false,

      itemStyle: {
        areaColor: 'rgba(20, 30, 50, 0.15)',
        borderColor: 'rgba(100, 150, 200, 0.1)',
        borderWidth: 0.5,
      },

      emphasis: {
        label: {
          show: true,
          color: '#ffffff',
          fontSize: 14,
          fontWeight: 600,
        },
        itemStyle: {
          borderWidth: 2,
          borderColor: 'rgba(0, 212, 255, 0.6)',
          shadowBlur: 15,
        },
      },

      select: { disabled: true },
      regions: [
        // 边界框 - 完全透明,无 tooltip,无高亮
        {
          name: '__boundary__',
          itemStyle: { areaColor: 'transparent', borderColor: 'transparent' },
          label: { show: false },
          emphasis: {
            label: { show: false },
            itemStyle: { areaColor: 'transparent', borderColor: 'transparent' },
          },
        },
        ...regionStyles,
      ],
      zlevel: 0,
    };

    // 只在有 center 时设置
    if (this.viewCenter) {
      geoConfig.center = this.viewCenter;
    }

    return {
      backgroundColor: 'transparent',
      animation: true,
      animationDuration: 600,
      animationEasing: 'cubicOut',

      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(15, 21, 37, 0.95)',
        borderColor: 'rgba(0, 212, 255, 0.3)',
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { color: '#e0e6ed', fontSize: 12 },
        formatter: (params) => {
          // 边界框不显示 tooltip
          if (params.name === '__boundary__') return '';

          // 地点图钉 tooltip
          if (params.data?.name && params.data?.id) {
            const tc = TYPE_CONFIG[params.data.type] || TYPE_CONFIG.other;
            return `<div style="font-weight:600;margin-bottom:4px">${tc.icon} ${params.data.name}</div>` +
              `<div style="color:#8b9bb4;font-size:11px">${tc.label}</div>` +
              `<div style="color:#5a6a7e;font-size:10px;margin-top:4px">坐标: [${params.data.value[0]}, ${params.data.value[1]}]</div>` +
              `<div style="color:#00d4ff;font-size:10px;margin-top:2px">点击查看详情</div>`;
          }
          // 区域色块 tooltip
          if (params.name && params.name !== '__boundary__') {
            const detail = this.regionDetails[params.name];
            if (!detail) return '';

            const node = this.regionTree[detail.id];
            const hasKids = node ? node.children.length > 0 : false;
            const levelName = LEVEL_CONFIG[detail.level]?.name || '区域';

            let hint;
            if (detail.level === 5 && node?.tileMap) {
              hint = '点击查看建筑平面图';
            } else if (hasKids) {
              hint = '点击进入内部';
            } else {
              hint = '点击查看详情';
            }

            const tags = detail.tags?.length ? detail.tags.join(' · ') : '';
            return `<div style="font-weight:600;margin-bottom:4px">${detail.name}</div>` +
              `<div style="color:#00d4ff;font-size:11px">${levelName}</div>` +
              (tags ? `<div style="color:#8b9bb4;font-size:11px;margin-top:2px">${tags}</div>` : '') +
              `<div style="color:#5a6a7e;font-size:10px;margin-top:4px">${hint}</div>`;
          }
          return '';
        },
      },

      geo: geoConfig,

      series: [
        // ---- 道路光晕层 (lines series, 跟随 geo 缩放/平移, 完全跟手) ----
        {
          name: '道路光晕',
          type: 'lines',
          coordinateSystem: 'geo',
          polyline: true,
          data: this.buildRoadSeriesData(),
          lineStyle: {
            color: 'rgba(190, 165, 120, 0.10)',
            width: 8,
            curveness: 0,
          },
          effect: { show: false },
          silent: true,
          tooltip: { show: false },
          hoverAnimation: false,
          zlevel: 1,
        },
        // ---- 道路路面层 ----
        {
          name: '道路路面',
          type: 'lines',
          coordinateSystem: 'geo',
          polyline: true,
          data: this.buildRoadSeriesData(),
          lineStyle: {
            color: 'rgba(200, 175, 130, 0.6)',
            width: 2.5,
            curveness: 0,
          },
          effect: { show: false },
          silent: true,
          tooltip: { show: false },
          hoverAnimation: false,
          zlevel: 2,
        },
        // ---- 地点图钉 ----
        {
          name: '地点',
          type: 'scatter',
          coordinateSystem: 'geo',
          data: this.layers.markers ? markerData : [],
          symbol: 'pin',
          symbolSize: 32,
          symbolOffset: [0, -16],
          itemStyle: {
            borderColor: 'rgba(255, 255, 255, 0.4)',
            borderWidth: 1.5,
          },
          label: {
            show: this.layers.labels,
            position: 'bottom',
            offset: [0, -6],
            color: '#e0e6ed',
            fontSize: 11,
            fontWeight: 500,
            textShadowColor: 'rgba(0, 0, 0, 0.95)',
            textShadowBlur: 5,
            formatter: '{b}',
          },
          emphasis: {
            scale: 1.4,
            label: { fontSize: 13, color: '#00d4ff', fontWeight: 700 },
            itemStyle: { borderColor: '#00d4ff', borderWidth: 2, shadowBlur: 20 },
          },
          zlevel: 3,
        },
        // ---- 搜索高亮 ----
        {
          name: '搜索高亮',
          type: 'effectScatter',
          coordinateSystem: 'geo',
          data: highlightData,
          symbolSize: 16,
          rippleEffect: { brushType: 'stroke', scale: 3, period: 3 },
          itemStyle: { color: '#00d4ff', shadowBlur: 15, shadowColor: '#00d4ff' },
          zlevel: 4,
        },
      ],
    };
  }

  // ============================================================
  // 区域色块样式 - 所有已注册区域都可见
  // ============================================================
  buildRegionStyles() {
    const features = (this.geoJSON.features || []).filter((f) => {
      if (!f.properties?.name || f.properties?.name === '__boundary__') return false;
      const parent = f.properties?.parentRegion || null;
      if (this.activeRegionId === null) return !parent;
      return parent === this.activeRegionId;
    });

    const palette = [
      'rgba(30, 60, 90, 0.4)', 'rgba(50, 40, 70, 0.4)',
      'rgba(30, 70, 50, 0.4)', 'rgba(70, 50, 30, 0.4)',
      'rgba(50, 30, 60, 0.4)', 'rgba(30, 50, 70, 0.4)',
      'rgba(60, 40, 50, 0.4)', 'rgba(40, 60, 40, 0.4)',
      'rgba(50, 50, 30, 0.4)', 'rgba(30, 40, 60, 0.4)',
      'rgba(60, 30, 40, 0.4)', 'rgba(40, 30, 50, 0.4)',
    ];

    // 当前活跃区域的级别
    let activeLevel = 1;
    if (this.activeRegionId) {
      activeLevel = this.regionTree[this.activeRegionId]?.level || 1;
    }
    const levelCfg = LEVEL_CONFIG[activeLevel] || LEVEL_CONFIG[1];

    return features.map((f, i) => {
      const props = f.properties;
      const color = props.color || palette[i % palette.length];
      const borderColor = props.borderColor || 'rgba(0, 212, 255, 0.3)';

      return {
        name: props.name,
        itemStyle: {
          areaColor: color,
          borderColor: borderColor,
          borderWidth: 1.5,
          shadowBlur: 8,
          shadowColor: color,
        },
        label: {
          show: this.layers.regions,
          color: 'rgba(220, 230, 255, 0.75)',
          fontSize: levelCfg.fontSize,
          fontWeight: levelCfg.fontWeight,
        },
      };
    });
  }

  // ============================================================
  // 地点图钉数据 - 显示当前活跃区域的直接子地点
  // ============================================================
  buildMarkerData() {
    // 搜索模式：忽略级别限制，显示所有匹配结果
    if (this.searchKeyword) {
      return this.locations
        .filter((loc) => {
          if (this.typeFilter.size > 0 && !this.typeFilter.has(loc.type)) return false;
          return loc.name.toLowerCase().includes(this.searchKeyword.toLowerCase());
        })
        .map((loc) => {
          const tc = TYPE_CONFIG[loc.type] || TYPE_CONFIG.other;
          return {
            name: loc.name,
            value: [loc.coordinates[0], loc.coordinates[1]],
            id: loc.id,
            type: loc.type,
            itemStyle: { color: tc.color, shadowBlur: 12, shadowColor: tc.color },
          };
        });
    }

    // 正常模式：显示直接子地点
    return this.locations
      .filter((loc) => {
        if (loc.parentId !== this.activeRegionId) return false;
        if (this.typeFilter.size > 0 && !this.typeFilter.has(loc.type)) return false;
        return true;
      })
      .map((loc) => {
        const tc = TYPE_CONFIG[loc.type] || TYPE_CONFIG.other;
        return {
          name: loc.name,
          value: [loc.coordinates[0], loc.coordinates[1]],
          id: loc.id,
          type: loc.type,
          itemStyle: { color: tc.color, shadowBlur: 12, shadowColor: tc.color },
        };
      });
  }

  buildHighlightData(markerData) {
    if (!this.searchKeyword) return [];
    return markerData.slice(0, 5).map((d) => ({ name: d.name, value: d.value }));
  }

  // ============================================================
  // 道路序列数据 - 用于 lines series (coordinateSystem: 'geo')
  // 关键: 使用 geo 坐标系的 series,缩放/平移时 ECharts 原生变换,完全跟手
  // ============================================================
  buildRoadSeriesData() {
    if (!this.layers.roads || !this.roads || this.roads.length === 0) return [];
    return this.roads.map((road) => ({
      coords: road.coords,
    }));
  }

  // ============================================================
  // 更新数据 - 构建区域树
  // 关键修复（v3 全面修复）:
  //   1. 不重置 activeRegionId/activeRegionPath (除 resetLevel=true)
  //   2. 视图中心/缩放由 viewCenter/viewZoom 管理，setOption 不会丢失
  //   3. 默认使用 setOption(false) 合并模式，避免完全重建
  //   4. 当区域被删除或 resetLevel=true 时清空 viewCenter/viewZoom
  // ============================================================
  updateData(geoJSON, locations, resetLevel = false) {
    // 取消任何未完成的 focus 延迟
    if (this._focusTimer) {
      clearTimeout(this._focusTimer);
      this._focusTimer = null;
    }

    this.geoJSON = geoJSON || { type: 'FeatureCollection', features: [] };
    this.locations = locations || [];

    // 提取区域详情 + 构建区域树
    this.regionDetails = {};
    this.regionTree = {};

    for (const f of (this.geoJSON.features || [])) {
      if (!f.properties?.name || f.properties?.name === '__boundary__') continue;
      const props = f.properties;
      const level = props.level ?? 2;
      const coords = props.coordinates || props.districtCenter || null;

      // 区域详情
      this.regionDetails[props.name] = {
        name: props.name,
        id: props.id,
        type: props.locationType || props.type || 'district',
        description: props.description || '',
        history: props.history || [],
        tags: props.tags || [],
        relatedCharacters: props.relatedCharacters || [],
        coordinates: coords,
        color: props.color,
        regionId: props.id,
        level: level,
      };

      // 区域树节点
      this.regionTree[props.id] = {
        id: props.id,
        name: props.name,
        level: level,
        parent: props.parentRegion || null,
        center: coords,
        children: [],
        tileMap: props.tileMap || null,
      };
    }

    // 构建 parent → children 关系
    for (const id of Object.keys(this.regionTree)) {
      const node = this.regionTree[id];
      if (node.parent && this.regionTree[node.parent]) {
        this.regionTree[node.parent].children.push(id);
      }
    }

    // 地点的 parentId 也加入树
    for (const loc of this.locations) {
      if (loc.parentId && this.regionTree[loc.parentId]) {
        this.regionTree[loc.parentId].children.push(loc.id);
      }
    }

    // ============================================================
    // 校验当前活跃区域是否还存在
    // ============================================================
    if (this.activeRegionId && !this.regionTree[this.activeRegionId]) {
      // 当前区域已被删除,回退到顶层
      this.activeRegionId = null;
      this.activeRegionPath = [null];
      this.exitTileMode(true);
      resetLevel = true;
    } else if (!resetLevel) {
      // 自动刷新路径: 保持当前层级,只刷新渲染
      // 清理路径中已不存在的区域
      const filtered = this.activeRegionPath.filter(
        (id) => id === null || this.regionTree[id]
      );
      if (filtered.length === 0) {
        this.activeRegionPath = [null];
        this.activeRegionId = null;
      } else {
        this.activeRegionPath = filtered;
        this.activeRegionId = filtered[filtered.length - 1];
      }
    }

    if (resetLevel) {
      this.exitTileMode(true);
      this.activeRegionId = null;
      this.activeRegionPath = [null];
      // 关键: 重置视图状态到默认值
      this.viewCenter = null;
      this.viewZoom = 1;
    }

    this.generateRoads();
    this.registerMap();

    // ============================================================
    // 关键: 使用合并模式 (setOption option, false)
    // 这样 ECharts 内部 geo state (用户当前缩放/拖拽的位置)
    // 不会被擦除。本类的 viewCenter/viewZoom 也会被 buildOption 写回
    // 起到"保险"作用。
    // ============================================================
    if (this.chart) {
      this.chart.setOption(this.buildOption(), false);
    }
    setTimeout(() => this.renderGraphics(), 100);

    this.fireLevelChange();
  }

  // ---- 图层控制 ----
  setLayer(layer, visible) {
    this.layers[layer] = visible;
    this.chart.setOption(this.buildOption(), false);
    setTimeout(() => this.renderGraphics(), 50);
  }

  setTypeFilter(types) {
    this.typeFilter = new Set(types);
    this.chart.setOption(this.buildOption(), false);
  }

  search(keyword) {
    this.searchKeyword = keyword || '';
    this.chart.setOption(this.buildOption(), false);
    setTimeout(() => this.renderGraphics(), 50);
  }

  focusOn(coordinates, zoom = 3) {
    if (!this.chart || !coordinates) return;
    // 取消前一个未完成的 focus,避免与后续 setOption(true) 冲突
    if (this._focusTimer) {
      clearTimeout(this._focusTimer);
      this._focusTimer = null;
    }
    // 关键: 同步视图状态，避免 updateData 把它擦掉
    this.viewCenter = [...coordinates];
    this.viewZoom = zoom;
    this.chart.setOption({ geo: { center: this.viewCenter, zoom: this.viewZoom } }, false);
    this._focusTimer = setTimeout(() => {
      this._focusTimer = null;
      this.renderGraphics();
    }, 200);
  }

  resetView() {
    if (this._focusTimer) {
      clearTimeout(this._focusTimer);
      this._focusTimer = null;
    }
    // 同步视图状态
    this.viewCenter = null;
    this.viewZoom = 1;
    this.chart.setOption({ geo: { center: null, zoom: 1 } }, false);
    this._focusTimer = setTimeout(() => {
      this._focusTimer = null;
      this.renderGraphics();
    }, 200);
  }

  getInstance() { return this.chart; }

  setRoadSeed(seed) {
    this.roadSeed = seed >>> 0;
    this.generateRoads();
    this.renderGraphics();
  }

  getRegionNames() {
    return Object.keys(this.regionDetails);
  }

  // ============================================================
  // 搜索跳转：跳到指定区域并钻入
  // 关键修复: 视图状态 (viewCenter/viewZoom) 与 buildOption 同步
  // ============================================================
  focusOnRegion(regionId) {
    const node = this.regionTree[regionId];
    if (!node) return;

    // 取消未完成的 focus 延迟
    if (this._focusTimer) {
      clearTimeout(this._focusTimer);
      this._focusTimer = null;
    }

    // 如果在瓦片模式,先退出
    if (this.tileMode) {
      this.exitTileMode(true);
    }

    // 如果是建筑级别且有 tileMap，直接进入瓦片模式
    if (node.level === 5 && node.tileMap) {
      this.activeRegionPath = [];
      let n = node;
      while (n) {
        this.activeRegionPath.unshift(n.id);
        n = n.parent ? this.regionTree[n.parent] : null;
      }
      this.activeRegionPath.unshift(null);
      this.activeRegionId = regionId;
      this.activeBuildingId = regionId;
      const detail = this.regionDetails[node.name];
      this.enterTileMode(node, detail);
      this.fireLevelChange();
      return;
    }

    // 构建从根到该区域的完整路径
    const path = [];
    let n = node;
    while (n) {
      path.unshift(n.id);
      n = n.parent ? this.regionTree[n.parent] : null;
    }
    path.unshift(null); // 顶层

    this.activeRegionPath = path;
    this.activeRegionId = regionId;

    this.generateRoads();
    this.registerMap();

    // 关键: 同步视图状态
    const levelCfg = LEVEL_CONFIG[node.level] || LEVEL_CONFIG[3];
    if (node.center) {
      this.viewCenter = [...node.center];
      this.viewZoom = levelCfg.zoom;
    } else {
      this.viewCenter = null;
      this.viewZoom = 1;
    }

    this.chart.setOption(this.buildOption(), false);
    setTimeout(() => this.renderGraphics(), 100);

    this.fireLevelChange();
  }

  // ---- 搜索跳转：跳到指定地点 ----
  focusOnLocation(loc) {
    if (!loc || !loc.parentId) return;
    const region = this.regionTree[loc.parentId];
    if (!region) return;

    // 钻入到地点的父区域
    this.focusOnRegion(loc.parentId);

    // 聚焦到地点坐标
    setTimeout(() => {
      this.focusOn(loc.coordinates, 10);
    }, 300);
  }
}
