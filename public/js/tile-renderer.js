// ============================================================
// tile-renderer.js - RPG Maker 风格建筑平面图渲染器
// 独立 Canvas 渲染,支持拖拽/缩放/楼层切换/瓦片点击
// ============================================================

class TileRenderer {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.canvas = null;
    this.ctx = null;
    this.tileMap = null;       // 当前建筑的完整瓦片数据
    this.currentFloor = '1F';  // 当前楼层
    this.callbacks = {};
    this.tileSize = 32;        // 基础瓦片大小 (像素)
    this.zoom = 1;             // 缩放倍率
    this.offsetX = 0;          // 平移偏移 X
    this.offsetY = 0;          // 平移偏移 Y
    this.isDragging = false;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.hoveredTile = null;
    this.labels = [];          // 当前楼层的标签
    this.showGrid = true;
    this._animFrame = null;
  }

  // ---- 初始化 Canvas ----
  init() {
    this.canvas = document.createElement('canvas');
    this.canvas.style.position = 'absolute';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'none';
    this.canvas.style.zIndex = '10';
    this.container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    this.resize();
    this.setupEvents();
    window.addEventListener('resize', () => this.resize());
  }

  on(event, cb) { this.callbacks[event] = cb; }

  // ---- 调整 Canvas 尺寸 ----
  resize() {
    if (!this.canvas) return;
    const rect = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.render();
  }

  // ---- 事件处理 ----
  setupEvents() {
    // 拖拽平移
    this.canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.dragStartX = e.clientX - this.offsetX;
      this.dragStartY = e.clientY - this.offsetY;
      this.canvas.style.cursor = 'grabbing';
    });

    this.canvas.addEventListener('mousemove', (e) => {
      if (this.isDragging) {
        this.offsetX = e.clientX - this.dragStartX;
        this.offsetY = e.clientY - this.dragStartY;
        this.render();
      } else {
        // 悬停检测
        this.updateHover(e);
      }
    });

    this.canvas.addEventListener('mouseup', (e) => {
      if (this.isDragging) {
        this.isDragging = false;
        this.canvas.style.cursor = 'grab';
        // 检测是否为点击 (拖拽距离很小)
        const moved = Math.abs(e.clientX - (this.dragStartX + this.offsetX)) +
                      Math.abs(e.clientY - (this.dragStartY + this.offsetY));
        if (moved < 5) {
          this.handleClick(e);
        }
      }
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.isDragging = false;
      this.canvas.style.cursor = 'grab';
      this.hoveredTile = null;
      this.render();
    });

    // 滚轮缩放
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const oldZoom = this.zoom;
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      this.zoom = Math.max(0.5, Math.min(5, this.zoom * delta));

      // 以鼠标为中心缩放
      const scale = this.zoom / oldZoom;
      this.offsetX = mx - (mx - this.offsetX) * scale;
      this.offsetY = my - (my - this.offsetY) * scale;

      this.render();
      this.callbacks.zoomChange?.(Math.round(this.zoom * 100));
    });
  }

  // ---- 加载建筑瓦片数据 ----
  loadBuilding(tileMapData, buildingName) {
    this.tileMap = tileMapData;
    this.buildingName = buildingName || '';

    if (!tileMapData || !tileMapData.floors) {
      this.currentFloor = null;
      this.render();
      return;
    }

    // 默认选择第一层
    const floorKeys = Object.keys(tileMapData.floors).sort();
    this.currentFloor = tileMapData.currentFloor || floorKeys[0] || '1F';

    // 居中显示
    this.centerView();

    // 通知楼层列表
    this.callbacks.floorChange?.({
      floors: floorKeys,
      currentFloor: this.currentFloor,
      buildingName: this.buildingName,
    });

    this.render();
  }

  // ---- 切换楼层 ----
  switchFloor(floorKey) {
    if (!this.tileMap?.floors?.[floorKey]) return;
    this.currentFloor = floorKey;
    this.centerView();
    this.callbacks.floorChange?.({
      floors: Object.keys(this.tileMap.floors).sort(),
      currentFloor: this.currentFloor,
      buildingName: this.buildingName,
    });
    this.render();
  }

  // ---- 居中视图 ----
  centerView() {
    const floorData = this.getCurrentFloorData();
    if (!floorData) return;

    const rect = this.container.getBoundingClientRect();
    const mapWidth = floorData.width * this.tileSize * this.zoom;
    const mapHeight = floorData.height * this.tileSize * this.zoom;

    // 自动缩放以适应容器
    const fitZoom = Math.min(
      (rect.width - 80) / (floorData.width * this.tileSize),
      (rect.height - 80) / (floorData.height * this.tileSize)
    );
    this.zoom = Math.max(0.5, Math.min(3, fitZoom));

    const scaledW = floorData.width * this.tileSize * this.zoom;
    const scaledH = floorData.height * this.tileSize * this.zoom;
    this.offsetX = (rect.width - scaledW) / 2;
    this.offsetY = (rect.height - scaledH) / 2;
  }

  // ---- 获取当前楼层数据 ----
  getCurrentFloorData() {
    if (!this.tileMap?.floors?.[this.currentFloor]) return null;
    return this.tileMap.floors[this.currentFloor];
  }

  // ---- 显示/隐藏 ----
  show() {
    if (this.canvas) {
      this.canvas.style.display = 'block';
      this.canvas.style.cursor = 'grab';
      this.resize();
    }
  }

  hide() {
    if (this.canvas) {
      this.canvas.style.display = 'none';
    }
  }

  // ---- 悬停检测 ----
  updateHover(e) {
    const rect = this.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    const tilePos = this.pixelToTile(px, py);
    if (!tilePos) {
      if (this.hoveredTile) {
        this.hoveredTile = null;
        this.render();
      }
      return;
    }

    const floorData = this.getCurrentFloorData();
    if (!floorData) return;

    const tile = floorData.tiles[tilePos.y]?.[tilePos.x];
    if (tile === undefined) {
      if (this.hoveredTile) {
        this.hoveredTile = null;
        this.render();
      }
      return;
    }

    const prev = this.hoveredTile;
    this.hoveredTile = { ...tilePos, tile };
    if (!prev || prev.x !== tilePos.x || prev.y !== tilePos.y) {
      this.render();
    }
  }

  // ---- 点击处理 ----
  handleClick(e) {
    const rect = this.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;

    const tilePos = this.pixelToTile(px, py);
    if (!tilePos) return;

    const floorData = this.getCurrentFloorData();
    if (!floorData) return;

    const tile = floorData.tiles[tilePos.y]?.[tilePos.x];
    if (tile === undefined) return;

    // 查找标签
    const label = floorData.labels?.find(
      (l) => l.x === tilePos.x && l.y === tilePos.y
    );

    this.callbacks.tileClick?.({
      x: tilePos.x,
      y: tilePos.y,
      tile: tile,
      tileName: TILE_CONFIG[tile]?.name || '',
      label: label?.text || '',
      floor: this.currentFloor,
      building: this.buildingName,
    });
  }

  // ---- 像素坐标转瓦片坐标 ----
  pixelToTile(px, py) {
    const ts = this.tileSize * this.zoom;
    const x = Math.floor((px - this.offsetX) / ts);
    const y = Math.floor((py - this.offsetY) / ts);
    const floorData = this.getCurrentFloorData();
    if (!floorData) return null;
    if (x < 0 || x >= floorData.width || y < 0 || y >= floorData.height) return null;
    return { x, y };
  }

  // ---- 渲染主函数 ----
  render() {
    if (!this.ctx) return;
    const rect = this.container.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    // 清空画布
    this.ctx.fillStyle = '#0a0e1a';
    this.ctx.fillRect(0, 0, w, h);

    const floorData = this.getCurrentFloorData();
    if (!floorData) {
      this.ctx.fillStyle = '#5a6a7e';
      this.ctx.font = '16px "Noto Sans SC", sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.fillText('该建筑暂无平面图数据', w / 2, h / 2);
      return;
    }

    const ts = this.tileSize * this.zoom;
    const { width: mapW, height: mapH, tiles, labels } = floorData;

    // ---- 绘制背景网格 ----
    if (this.showGrid && this.zoom > 0.8) {
      this.ctx.strokeStyle = 'rgba(100, 150, 200, 0.05)';
      this.ctx.lineWidth = 1;
      for (let x = 0; x <= mapW; x++) {
        this.ctx.beginPath();
        this.ctx.moveTo(this.offsetX + x * ts, this.offsetY);
        this.ctx.lineTo(this.offsetX + x * ts, this.offsetY + mapH * ts);
        this.ctx.stroke();
      }
      for (let y = 0; y <= mapH; y++) {
        this.ctx.beginPath();
        this.ctx.moveTo(this.offsetX, this.offsetY + y * ts);
        this.ctx.lineTo(this.offsetX + mapW * ts, this.offsetY + y * ts);
        this.ctx.stroke();
      }
    }

    // ---- 绘制瓦片 ----
    for (let y = 0; y < mapH; y++) {
      for (let x = 0; x < mapW; x++) {
        const tile = tiles[y]?.[x];
        if (tile === undefined || tile === TILE.VOID) continue;

        const px = this.offsetX + x * ts;
        const py = this.offsetY + y * ts;
        const cfg = TILE_CONFIG[tile];
        if (!cfg) continue;

        // 填充
        this.ctx.fillStyle = cfg.color;
        this.ctx.fillRect(px, py, ts, ts);

        // 边框
        if (cfg.border && cfg.border !== 'transparent') {
          this.ctx.strokeStyle = cfg.border;
          this.ctx.lineWidth = 1;
          this.ctx.strokeRect(px + 0.5, py + 0.5, ts - 1, ts - 1);
        }

        // 图标
        if (cfg.icon && this.zoom > 1) {
          this.ctx.fillStyle = '#e0e6ed';
          this.ctx.font = `${Math.floor(ts * 0.5)}px sans-serif`;
          this.ctx.textAlign = 'center';
          this.ctx.textBaseline = 'middle';
          this.ctx.fillText(cfg.icon, px + ts / 2, py + ts / 2);
        }
      }
    }

    // ---- 绘制标签 ----
    if (labels && this.zoom > 0.7) {
      for (const label of labels) {
        const px = this.offsetX + (label.x + 0.5) * ts;
        const py = this.offsetY + (label.y + 0.5) * ts;

        // 标签背景
        this.ctx.font = `${Math.max(9, Math.floor(ts * 0.35))}px "Noto Sans SC", sans-serif`;
        const metrics = this.ctx.measureText(label.text);
        const padX = 4;
        const padY = 2;
        const bgW = metrics.width + padX * 2;
        const bgH = Math.max(12, ts * 0.4) + padY * 2;

        this.ctx.fillStyle = label.color ? `${label.color}33` : 'rgba(0, 212, 255, 0.15)';
        this.ctx.fillRect(px - bgW / 2, py - bgH / 2, bgW, bgH);

        this.ctx.strokeStyle = label.color || 'rgba(0, 212, 255, 0.4)';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(px - bgW / 2, py - bgH / 2, bgW, bgH);

        // 标签文字
        this.ctx.fillStyle = label.color || '#e0e6ed';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(label.text, px, py);
      }
    }

    // ---- 绘制悬停高亮 ----
    if (this.hoveredTile) {
      const px = this.offsetX + this.hoveredTile.x * ts;
      const py = this.offsetY + this.hoveredTile.y * ts;
      this.ctx.strokeStyle = '#00d4ff';
      this.ctx.lineWidth = 2;
      this.ctx.strokeRect(px, py, ts, ts);

      // 显示瓦片信息
      const cfg = TILE_CONFIG[this.hoveredTile.tile];
      if (cfg) {
        const info = cfg.name;
        this.ctx.font = '12px "Noto Sans SC", sans-serif';
        const metrics = this.ctx.measureText(info);
        const boxW = metrics.width + 16;
        const boxH = 24;
        let bx = px + ts + 8;
        let by = py;
        if (bx + boxW > w) bx = px - boxW - 8;
        if (by + boxH > h) by = h - boxH - 4;

        this.ctx.fillStyle = 'rgba(15, 21, 37, 0.95)';
        this.ctx.fillRect(bx, by, boxW, boxH);
        this.ctx.strokeStyle = 'rgba(0, 212, 255, 0.3)';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(bx, by, boxW, boxH);

        this.ctx.fillStyle = '#e0e6ed';
        this.ctx.textAlign = 'left';
        this.ctx.textBaseline = 'middle';
        this.ctx.fillText(info, bx + 8, by + boxH / 2);
      }
    }

    // ---- 绘制楼层标识 ----
    this.ctx.font = 'bold 14px "Cinzel", "Noto Sans SC", serif';
    this.ctx.fillStyle = 'rgba(0, 212, 255, 0.6)';
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'top';
    this.ctx.fillText(`${this.buildingName} - ${this.currentFloor}`, 16, 16);
  }

  // ---- 获取所有楼层 ----
  getFloors() {
    if (!this.tileMap?.floors) return [];
    return Object.keys(this.tileMap.floors).sort();
  }

  // ---- 重置视图 ----
  resetView() {
    this.centerView();
    this.render();
  }
}
