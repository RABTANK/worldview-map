import './style.css';
import { fitCamera, screenToWorld, worldToScreen, type Camera } from '../../src/shared/camera.js';
import { distance, pointInPolygon, polygonBounds, translatePolygon, vertexAverage, type Point, type Polygon } from '../../src/shared/geom.js';
import { LEVEL_LABEL } from '../../src/shared/levels.js';
import { TILE_COLORS, TILE_LABEL, TILE_TYPES, type TileType } from '../../src/shared/tiles.js';
import type { MapView, Place, Region, RouteKind, Scope } from '../../src/shared/types.js';
import { Api, ApiError } from './api.js';
import { MapGl } from './gl.js';

type Selection =
  | { type: 'region'; id: string }
  | { type: 'place'; id: string }
  | { type: 'tile'; x: number; y: number }
  | null;

type Drag =
  | { kind: 'pan'; x: number; y: number; moved: boolean; selectOnClick: boolean }
  | { kind: 'place'; id: string; originX: number; originY: number; start: Point; moved: boolean }
  | { kind: 'region'; id: string; origin: Polygon; start: Point; moved: boolean }
  | { kind: 'vertex'; id: string; index: number; origin: Polygon; start: Point; moved: boolean };

const ROUTE_STYLE: Record<RouteKind, { color: string; width: number }> = {
  road: { color: '#e1b766', width: 8 },
  trail: { color: '#c18d57', width: 5 },
  sea: { color: '#76bdd0', width: 10 },
  custom: { color: '#d88b78', width: 6 },
};

const KEY_STORAGE = 'worldview-map-api-key';

const glCanvas = document.querySelector<HTMLCanvasElement>('#gl')!;
const labelCanvas = document.querySelector<HTMLCanvasElement>('#labels')!;
const hint = document.querySelector<HTMLParagraphElement>('#hint')!;
const crumbs = document.querySelector<HTMLElement>('#crumbs')!;
const who = document.querySelector<HTMLElement>('#who')!;
const childrenBox = document.querySelector<HTMLElement>('#children')!;
const placesBox = document.querySelector<HTMLElement>('#places')!;
const currentForm = document.querySelector<HTMLFormElement>('#current-form')!;
const editor = document.querySelector<HTMLFormElement>('#editor')!;
const palette = document.querySelector<HTMLElement>('#palette')!;
const floorsBox = document.querySelector<HTMLElement>('#floors')!;
const indoorSection = document.querySelector<HTMLElement>('#indoor-section')!;
const statusEl = document.querySelector<HTMLElement>('#status')!;
const dialog = document.querySelector<HTMLDialogElement>('#key-dialog')!;
const keyInput = document.querySelector<HTMLInputElement>('#key-input')!;

const api = new Api(() => sessionStorage.getItem(KEY_STORAGE) ?? '');
let renderer: MapGl | null = null;
try {
  renderer = new MapGl(glCanvas);
} catch (error) {
  hint.textContent = error instanceof Error ? error.message : 'WebGL 初始化失败';
}

let regionId: string | null = null;
let floorId: string | null = null;
let view: MapView | null = null;
let camera: Camera = { x: 500, y: 500, zoom: 0.6 };
let selection: Selection = null;
let hovered: Selection = null;
let selectedVertex: { regionId: string; index: number } | null = null;
let formDirty = false;
let drag: Drag | null = null;
let preview: { kind: 'place'; id: string; x: number; y: number } | { kind: 'region'; id: string; geometry: Polygon } | null = null;
let gridVisible = true;
let spacePanning = false;
let scopes: Scope[] = [];

function canWrite(): boolean {
  return scopes.includes('write') || scopes.includes('admin');
}

function setStatus(message: string, error = false): void {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', error);
}

function esc(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}

function resize(): void {
  const rect = glCanvas.parentElement!.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  for (const canvas of [glCanvas, labelCanvas]) {
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  }
  draw();
}

function viewSize(): { width: number; height: number } {
  const rect = glCanvas.getBoundingClientRect();
  return { width: rect.width, height: rect.height };
}

function indoor(): boolean {
  return view?.region?.level === 'building';
}

function childGeometry(region: Region): Polygon {
  if (preview?.kind === 'region' && preview.id === region.id) return preview.geometry;
  return region.geometry;
}

function placePoint(place: Place): Point {
  if (preview?.kind === 'place' && preview.id === place.id) return { x: preview.x, y: preview.y };
  return { x: place.x, y: place.y };
}

function fit(): void {
  const { width, height } = viewSize();
  if (!view || width < 2 || height < 2) return;
  if (indoor()) {
    const floor = view.indoor?.activeFloor;
    if (!floor) return;
    camera = fitCamera({ minX: 0, minY: 0, maxX: floor.width, maxY: floor.height }, width, height, 36);
    draw();
    return;
  }
  const points: Point[] = [];
  for (const child of view.children) points.push(...childGeometry(child).points);
  for (const place of view.places) points.push(placePoint(place));
  for (const route of view.routes) points.push(...route.geometry.points);
  if (!points.length) {
    camera = { x: 500, y: 500, zoom: Math.min(width, height) / 1200 };
  } else {
    camera = fitCamera(polygonBounds(points), width, height, 56);
  }
  draw();
}

function zoomBy(factor: number): void {
  const { width, height } = viewSize();
  if (width < 2 || height < 2) return;
  const sx = width / 2;
  const sy = height / 2;
  const before = screenToWorld(camera, width, height, sx, sy);
  camera.zoom = Math.min(400, Math.max(0.02, camera.zoom * factor));
  const after = screenToWorld(camera, width, height, sx, sy);
  camera.x += before.x - after.x;
  camera.y += before.y - after.y;
  draw();
}

function draw(): void {
  if (!renderer || !view) return;
  const { width, height } = viewSize();
  if (width < 2 || height < 2) return;
  const selectedRegion = selection?.type === 'region' ? selection.id : null;
  const selectedPlace = selection?.type === 'place' ? selection.id : null;
  const hoveredRegion = hovered?.type === 'region' ? hovered.id : null;
  const hoveredPlace = hovered?.type === 'place' ? hovered.id : null;
  const polygons = indoor()
    ? []
    : view.children.map((child) => ({
        points: childGeometry(child).points,
        fill: child.fill,
        stroke: child.id === selectedRegion ? '#f2d48a' : child.id === hoveredRegion ? '#a9d8c6' : child.stroke,
        strokeWidth: child.id === selectedRegion ? 4 : child.id === hoveredRegion ? 3 : 1.75,
      }));
  const routes = indoor()
    ? []
    : view.routes.map((route) => ({
        points: route.geometry.points,
        color: route.style ?? ROUTE_STYLE[route.kind].color,
        width: route.width ?? ROUTE_STYLE[route.kind].width,
      }));
  const places = indoor()
    ? []
    : view.places.map((place) => ({
        ...placePoint(place),
        fill: place.id === selectedPlace ? '#f2d48a' : place.id === hoveredPlace ? '#a9d8c6' : '#f4ecdf',
      }));
  const floor = indoor() ? view.indoor?.activeFloor : null;
  const tiles =
    floor?.tiles.map((tile) => ({
      x: tile.x,
      y: tile.y,
      color:
        selection?.type === 'tile' && selection.x === tile.x && selection.y === tile.y ? '#f2d48a' : TILE_COLORS[tile.tileType],
    })) ?? [];
  let grid: { minX: number; minY: number; maxX: number; maxY: number; step: number } | null = null;
  const corners = [
    screenToWorld(camera, width, height, 0, 0),
    screenToWorld(camera, width, height, width, height),
  ];
  const minX = Math.min(corners[0].x, corners[1].x);
  const maxX = Math.max(corners[0].x, corners[1].x);
  const minY = Math.min(corners[0].y, corners[1].y);
  const maxY = Math.max(corners[0].y, corners[1].y);
  grid = gridVisible ? { minX, minY, maxX, maxY, step: floor ? 1 : 100 } : null;
  renderer.draw({ camera, width, height, polygons, routes, places, tiles, grid });
  drawLabels(width, height);
}

function drawLabels(width: number, height: number): void {
  const ctx = labelCanvas.getContext('2d');
  if (!ctx || !view) return;
  const dpr = labelCanvas.width / width;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f6efe2';
  ctx.strokeStyle = 'rgba(16, 14, 12, 0.9)';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  const occupied: { left: number; right: number; top: number; bottom: number }[] = [];
  const placeLabel = (text: string, x: number, y: number, font: string): boolean => {
    ctx.font = font;
    const textWidth = ctx.measureText(text).width;
    const box = { left: x - textWidth / 2 - 4, right: x + textWidth / 2 + 4, top: y - 9, bottom: y + 9 };
    if (box.left < 4 || box.right > width - 4 || box.top < 4 || box.bottom > height - 4) return false;
    if (occupied.some((other) => box.left < other.right + 3 && box.right + 3 > other.left && box.top < other.bottom + 2 && box.bottom + 2 > other.top)) return false;
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
    occupied.push(box);
    return true;
  };
  if (!indoor()) {
    const selectedRegion = selection?.type === 'region' ? selection.id : null;
    const hoveredRegion = hovered?.type === 'region' ? hovered.id : null;
    const showAllLabels = camera.zoom >= 0.12;
    const regions = [...view.children].sort((a, b) => {
      const aPriority = a.id === selectedRegion ? 2 : a.id === hoveredRegion ? 1 : 0;
      const bPriority = b.id === selectedRegion ? 2 : b.id === hoveredRegion ? 1 : 0;
      return bPriority - aPriority;
    });
    for (const child of regions) {
      if (!showAllLabels && child.id !== selectedRegion && child.id !== hoveredRegion) continue;
      const center = vertexAverage(childGeometry(child).points);
      const screen = worldToScreen(camera, width, height, center.x, center.y);
      const selected = child.id === selectedRegion || child.id === hoveredRegion;
      const font = selected ? 'bold 15px Palatino, "Songti SC", serif' : '14px Palatino, "Songti SC", serif';
      for (const offset of [0, -18, 18, -34, 34]) {
        if (placeLabel(child.name, screen.x, screen.y + offset, font)) break;
      }
    }
    const selectedPlace = selection?.type === 'place' ? selection.id : null;
    const hoveredPlace = hovered?.type === 'place' ? hovered.id : null;
    const places = [...view.places].sort((a, b) => {
      const aPriority = a.id === selectedPlace ? 2 : a.id === hoveredPlace ? 1 : 0;
      const bPriority = b.id === selectedPlace ? 2 : b.id === hoveredPlace ? 1 : 0;
      return bPriority - aPriority;
    });
    for (const place of places) {
      if (camera.zoom < 0.18 && place.id !== selectedPlace && place.id !== hoveredPlace) continue;
      const point = placePoint(place);
      const screen = worldToScreen(camera, width, height, point.x, point.y);
      const selected = place.id === selectedPlace || place.id === hoveredPlace;
      const font = selected ? 'bold 13px Palatino, "Songti SC", serif' : '12px Palatino, "Songti SC", serif';
      for (const [dx, dy] of [[0, 16], [0, -16], [20, 0], [-20, 0]] as const) {
        if (placeLabel(place.name, screen.x + dx, screen.y + dy, font)) break;
      }
    }
  } else if (!view.indoor?.activeFloor) {
    ctx.fillText('这栋建筑还没有室内楼层', width / 2, height / 2);
  }

  const selectedRegionId = selection?.type === 'region' ? selection.id : null;
  if (canWrite() && selectedRegionId) {
    const region = view.children.find((item) => item.id === selectedRegionId);
    if (region) {
      for (let index = 0; index < childGeometry(region).points.length; index += 1) {
        const point = childGeometry(region).points[index];
        const screen = worldToScreen(camera, width, height, point.x, point.y);
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, selectedVertex?.regionId === region.id && selectedVertex.index === index ? 7 : 5, 0, Math.PI * 2);
        ctx.fillStyle = selectedVertex?.regionId === region.id && selectedVertex.index === index ? '#f2d48a' : '#211b16';
        ctx.fill();
        ctx.strokeStyle = '#f2d48a';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }
}

function pick(worldPoint: Point): Selection {
  if (!view) return null;
  if (indoor()) {
    const floor = view.indoor?.activeFloor;
    if (!floor) return null;
    const x = Math.floor(worldPoint.x);
    const y = Math.floor(worldPoint.y);
    if (x < 0 || y < 0 || x >= floor.width || y >= floor.height) return null;
    return { type: 'tile', x, y };
  }
  const radius = Math.min(18, Math.max(4, 12 / camera.zoom));
  for (let i = view.places.length - 1; i >= 0; i -= 1) {
    const place = view.places[i];
    if (distance(worldPoint, placePoint(place)) <= radius) return { type: 'place', id: place.id };
  }
  for (let i = view.children.length - 1; i >= 0; i -= 1) {
    const child = view.children[i];
    if (pointInPolygon(worldPoint, childGeometry(child).points)) return { type: 'region', id: child.id };
  }
  return null;
}

function renderChrome(): void {
  crumbs.replaceChildren();
  const root = document.createElement('button');
  root.type = 'button';
  root.textContent = '世界';
  root.addEventListener('click', () => goto(null));
  crumbs.append(root);
  for (const crumb of view?.breadcrumb ?? []) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `${crumb.name}`;
    button.title = LEVEL_LABEL[crumb.level];
    button.addEventListener('click', () => goto(crumb.id));
    crumbs.append(button);
  }
  who.textContent = scopes.length ? scopes.join(' · ') : '未登录';

  childrenBox.replaceChildren();
  if (indoor()) {
    childrenBox.append(note('建筑内部显示室内平面，不叠加子区域。'));
  } else if (!view?.children.length) {
    childrenBox.append(note('没有直接子级。'));
  } else {
    for (const child of view.children) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'item' + (selection?.type === 'region' && selection.id === child.id ? ' active' : '');
      button.innerHTML = `${esc(child.name)}<small>${esc(LEVEL_LABEL[child.level])}</small>`;
      button.addEventListener('click', () => {
        selection = { type: 'region', id: child.id };
        formDirty = false;
        renderChrome();
        draw();
      });
      button.addEventListener('dblclick', () => goto(child.id));
      childrenBox.append(button);
    }
  }

  placesBox.replaceChildren();
  if (!view?.places.length) placesBox.append(note('这一层没有地点。'));
  for (const place of view?.places ?? []) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'item' + (selection?.type === 'place' && selection.id === place.id ? ' active' : '');
    button.innerHTML = `${esc(place.name)}<small>${esc(place.kind)} · ${place.x.toFixed(0)}, ${place.y.toFixed(0)}</small>`;
    button.addEventListener('click', () => {
      selection = { type: 'place', id: place.id };
      formDirty = false;
      renderChrome();
      draw();
    });
    placesBox.append(button);
  }

  indoorSection.hidden = !indoor();
  floorsBox.replaceChildren();
  if (indoor()) {
    const floors = view?.indoor?.floors ?? [];
    if (!floors.length) {
      floorsBox.append(note('还没有楼层。'));
      if (canWrite() && view?.region) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = '添加门厅';
        button.addEventListener('click', () => addDefaultFloor());
        floorsBox.append(button);
      }
    } else {
      const select = document.createElement('select');
      for (const floor of floors) {
        const option = document.createElement('option');
        option.value = floor.id;
        option.textContent = `${floor.floorIndex} · ${floor.name}`;
        if (view?.indoor?.activeFloor?.id === floor.id) option.selected = true;
        select.append(option);
      }
      select.addEventListener('change', () => {
        floorId = select.value;
        void reload(false);
      });
      floorsBox.append(select);
    }
  }

  if (!formDirty) {
    renderCurrent();
    renderEditor();
  }
  const floor = view?.indoor?.activeFloor;
  hint.textContent = indoor()
    ? floor
      ? '滚轮或 +/− 缩放 · 空白拖动或 Space+拖动平移 · 点击格子选中，有 write 权限时用色块修改。'
      : '进入建筑后显示室内平面 · 滚轮或 +/− 缩放 · 空白拖动或 Space+拖动平移。'
    : `滚轮或 +/− 缩放 · 空白拖动或 Space+拖动平移 · 双击区域下钻${canWrite() ? ' · 点选区域后拖顶点、点边插点，选中顶点后 Delete 删除 · Shift+拖动平移区域' : ''}。`;
}

function note(text: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.className = 'empty';
  p.textContent = text;
  return p;
}

function renderCurrent(): void {
  currentForm.replaceChildren();
  const region = view?.region;
  if (!region) {
    currentForm.append(note('世界根没有可编辑字段。双击一块大陆进入。'));
    return;
  }
  currentForm.append(
    field('名称', 'text', region.name, 'name'),
    field('描述', 'textarea', region.description, 'description'),
    field('标签', 'text', region.tags.join(', '), 'tags'),
  );
  const row = document.createElement('div');
  row.className = 'row';
  const save = document.createElement('button');
  save.type = 'submit';
  save.textContent = '保存当前区域';
  save.disabled = !canWrite();
  const enter = document.createElement('button');
  enter.type = 'button';
  enter.textContent = region.level === 'building' ? '查看室内' : '进入';
  enter.disabled = region.level === 'building';
  enter.addEventListener('click', () => goto(region.id));
  row.append(save, enter);
  currentForm.append(row);
}

function renderEditor(): void {
  editor.replaceChildren();
  palette.hidden = true;
  palette.replaceChildren();
  if (!view || !selection) {
    editor.append(note('在画布上点选区域、地点或室内格子。'));
    return;
  }
  if (selection.type === 'region') {
    const selectedId = selection.id;
    const found = view.children.find((child) => child.id === selectedId);
    if (!found) {
      editor.append(note('选中的区域不在当前层。'));
      return;
    }
    editor.append(
      note(`${LEVEL_LABEL[found.level]} · ${found.id}`),
      field('名称', 'text', found.name, 'name'),
      field('描述', 'textarea', found.description, 'description'),
      field('标签', 'text', found.tags.join(', '), 'tags'),
    );
    const row = document.createElement('div');
    row.className = 'row';
    const save = document.createElement('button');
    save.type = 'submit';
    save.textContent = '保存选中区域';
    save.disabled = !canWrite();
    const go = document.createElement('button');
    go.type = 'button';
    go.textContent = '进入';
    go.addEventListener('click', () => goto(found.id));
    row.append(save, go);
    editor.append(row);
    return;
  }
  if (selection.type === 'place') {
    const selectedId = selection.id;
    const found = view.places.find((item) => item.id === selectedId);
    if (!found) {
      editor.append(note('选中的地点不在当前层。'));
      return;
    }
    editor.append(
      field('名称', 'text', found.name, 'name'),
      field('描述', 'textarea', found.description, 'description'),
      field('标签', 'text', found.tags.join(', '), 'tags'),
      field('类型', 'text', found.kind, 'kind'),
      field('x', 'number', String(found.x), 'x'),
      field('y', 'number', String(found.y), 'y'),
    );
    const save = document.createElement('button');
    save.type = 'submit';
    save.textContent = '保存地点';
    save.disabled = !canWrite();
    editor.append(save);
    return;
  }
  const floor = view.indoor?.activeFloor;
  const tileX = selection.x;
  const tileY = selection.y;
  const tile = floor?.tiles.find((item) => item.x === tileX && item.y === tileY);
  editor.append(note(`格子 ${tileX}, ${tileY} · ${tile ? TILE_LABEL[tile.tileType] : '空'}`));
  palette.hidden = false;
  for (const tileType of TILE_TYPES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'swatch';
    button.disabled = !canWrite() || !floor;
    button.innerHTML = `<i style="background:${TILE_COLORS[tileType]}"></i>${esc(TILE_LABEL[tileType])}`;
    button.addEventListener('click', () => setTile(tileType));
    palette.append(button);
  }
  if (!canWrite()) palette.append(note('当前密钥不能写入。'));
}

function field(labelText: string, type: 'text' | 'textarea' | 'number', value: string, name: string): HTMLLabelElement {
  const label = document.createElement('label');
  label.textContent = labelText;
  const input = type === 'textarea' ? document.createElement('textarea') : document.createElement('input');
  if (input instanceof HTMLInputElement) input.type = type === 'number' ? 'number' : 'text';
  input.name = name;
  input.value = value;
  input.addEventListener('input', () => {
    formDirty = true;
  });
  label.append(input);
  return label;
}

function readForm(form: HTMLFormElement): Record<string, string> {
  const result: Record<string, string> = {};
  for (const element of Array.from(form.elements)) {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) continue;
    if (element.name) result[element.name] = element.value;
  }
  return result;
}

function tagsOf(value: string): string[] {
  return value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean);
}

async function reload(refit: boolean): Promise<void> {
  view = await api.view(regionId, floorId);
  if (view.indoor?.activeFloor) floorId = view.indoor.activeFloor.id;
  if (refit) fit();
  renderChrome();
  draw();
}

async function goto(next: string | null): Promise<void> {
  regionId = next;
  floorId = null;
  selection = null;
  formDirty = false;
  preview = null;
  await reload(true);
}

async function addDefaultFloor(): Promise<void> {
  if (!view?.region) return;
  const floor = await api.createFloor(view.region.id, { name: '门厅', floorIndex: 0, width: 12, height: 10 });
  floorId = floor.id;
  await reload(true);
  setStatus('已添加楼层');
}

async function setTile(tileType: TileType): Promise<void> {
  const floor = view?.indoor?.activeFloor;
  if (!floor || selection?.type !== 'tile') return;
  const { x, y } = selection;
  const tiles = floor.tiles
    .filter((tile) => !(tile.x === x && tile.y === y))
    .map((tile) => ({ x: tile.x, y: tile.y, tileType: tile.tileType }));
  tiles.push({ x, y, tileType });
  await api.setTiles(floor.id, tiles);
  await reload(false);
  setStatus('室内 tile 已写入');
}

currentForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!view?.region) return;
  const data = readForm(currentForm);
  try {
    await api.patchRegion(view.region.id, {
      name: data.name,
      description: data.description,
      tags: tagsOf(data.tags ?? ''),
    });
    formDirty = false;
    await reload(false);
    setStatus('当前区域已保存，API 立即可见');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : '保存失败', true);
  }
});

editor.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!selection) return;
  const data = readForm(editor);
  try {
    if (selection.type === 'region') {
      await api.patchRegion(selection.id, {
        name: data.name,
        description: data.description,
        tags: tagsOf(data.tags ?? ''),
      });
    } else if (selection.type === 'place') {
      await api.patchPlace(selection.id, {
        name: data.name,
        description: data.description,
        tags: tagsOf(data.tags ?? ''),
        kind: data.kind,
        x: Number(data.x),
        y: Number(data.y),
      });
    }
    formDirty = false;
    await reload(false);
    setStatus('已保存到 SQLite');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : '保存失败', true);
  }
});

function eventPoint(event: { clientX: number; clientY: number }): Point {
  const rect = glCanvas.getBoundingClientRect();
  const { width, height } = viewSize();
  return screenToWorld(camera, width, height, event.clientX - rect.left, event.clientY - rect.top);
}

function nearestVertexIndex(region: Region, clientX: number, clientY: number): number | null {
  const rect = glCanvas.getBoundingClientRect();
  const { width, height } = viewSize();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  let nearestIndex: number | null = null;
  let nearestDistance = Infinity;
  for (let index = 0; index < childGeometry(region).points.length; index += 1) {
    const point = childGeometry(region).points[index];
    const screen = worldToScreen(camera, width, height, point.x, point.y);
    const distance = Math.hypot(screen.x - x, screen.y - y);
    if (distance <= 10 && distance < nearestDistance) {
      nearestIndex = index;
      nearestDistance = distance;
    }
  }
  return nearestIndex;
}

function nearestEdgePoint(region: Region, clientX: number, clientY: number): { index: number; point: Point } | null {
  const rect = glCanvas.getBoundingClientRect();
  const { width, height } = viewSize();
  const points = childGeometry(region).points;
  const target = { x: clientX - rect.left, y: clientY - rect.top };
  let nearest: { index: number; distance: number; point: Point } | null = null;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const aScreen = worldToScreen(camera, width, height, a.x, a.y);
    const bScreen = worldToScreen(camera, width, height, b.x, b.y);
    const dx = bScreen.x - aScreen.x;
    const dy = bScreen.y - aScreen.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((target.x - aScreen.x) * dx + (target.y - aScreen.y) * dy) / lengthSquared));
    const screenPoint = { x: aScreen.x + t * dx, y: aScreen.y + t * dy };
    const distance = Math.hypot(screenPoint.x - target.x, screenPoint.y - target.y);
    if (distance <= 9 && (!nearest || distance < nearest.distance)) {
      nearest = { index, distance, point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t } };
    }
  }
  return nearest ? { index: nearest.index + 1, point: nearest.point } : null;
}

async function saveGeometry(regionId: string, geometry: Polygon, successMessage: string): Promise<void> {
  try {
    await api.patchRegion(regionId, { geometry });
    preview = null;
    formDirty = false;
    await reload(false);
    setStatus(successMessage);
  } catch (error) {
    preview = null;
    setStatus(error instanceof Error ? error.message : '区域多边形保存失败', true);
    draw();
  }
}

function insertVertex(region: Region, edgeIndex: number, point: Point): void {
  const points = [...childGeometry(region).points];
  points.splice(edgeIndex, 0, point);
  selectedVertex = { regionId: region.id, index: edgeIndex };
  void saveGeometry(region.id, { type: 'Polygon', points }, '已插入并保存顶点');
}

function deleteSelectedVertex(): void {
  const currentSelection = selection;
  const vertex = selectedVertex;
  if (!canWrite() || currentSelection?.type !== 'region' || vertex?.regionId !== currentSelection.id) return;
  const region = view?.children.find((item) => item.id === currentSelection.id);
  if (!region) return;
  const points = childGeometry(region).points;
  if (points.length <= 3) {
    setStatus('区域至少需要保留 3 个顶点', true);
    return;
  }
  const next = points.filter((_point, index) => index !== vertex.index);
  selectedVertex = null;
  void saveGeometry(region.id, { type: 'Polygon', points: next }, '已删除并保存顶点');
}

function sameSelection(a: Selection, b: Selection): boolean {
  if (a === null || b === null) return a === b;
  if (a.type !== b.type) return false;
  if (a.type === 'tile' && b.type === 'tile') return a.x === b.x && a.y === b.y;
  return 'id' in a && 'id' in b && a.id === b.id;
}

glCanvas.addEventListener('pointerdown', (event) => {
  if (!view) return;
  glCanvas.focus({ preventScroll: true });
  glCanvas.setPointerCapture(event.pointerId);
  const worldPoint = eventPoint(event);
  const hit = pick(worldPoint);
  if (event.button === 1 || event.altKey || spacePanning) {
    event.preventDefault();
    drag = { kind: 'pan', x: event.clientX, y: event.clientY, moved: false, selectOnClick: false };
    return;
  }
  const selectedRegionId = selection?.type === 'region' ? selection.id : null;
  if (canWrite() && selectedRegionId && !event.shiftKey && (hit === null || (hit.type === 'region' && hit.id === selectedRegionId))) {
    const region = view.children.find((item) => item.id === selectedRegionId);
    if (region) {
      const vertexIndex = nearestVertexIndex(region, event.clientX, event.clientY);
      if (vertexIndex !== null) {
        selectedVertex = { regionId: region.id, index: vertexIndex };
        drag = { kind: 'vertex', id: region.id, index: vertexIndex, origin: childGeometry(region), start: worldPoint, moved: false };
        draw();
        return;
      }
      const edge = nearestEdgePoint(region, event.clientX, event.clientY);
      if (edge) {
        insertVertex(region, edge.index, edge.point);
        draw();
        return;
      }
    }
  }
  if (canWrite() && hit?.type === 'place' && !event.shiftKey) {
    const place = view.places.find((item) => item.id === hit.id)!;
    drag = { kind: 'place', id: hit.id, originX: place.x, originY: place.y, start: worldPoint, moved: false };
    selection = hit;
    selectedVertex = null;
    return;
  }
  if (canWrite() && event.shiftKey && hit?.type === 'region') {
    const region = view.children.find((item) => item.id === hit.id)!;
    drag = { kind: 'region', id: hit.id, origin: region.geometry, start: worldPoint, moved: false };
    selection = hit;
    selectedVertex = null;
    return;
  }
  drag = { kind: 'pan', x: event.clientX, y: event.clientY, moved: false, selectOnClick: true };
  if (hit && !sameSelection(selection, hit)) selectedVertex = null;
  if (hit) selection = hit;
});

glCanvas.addEventListener('pointermove', (event) => {
  if (!drag) {
    const hit = view ? pick(eventPoint(event)) : null;
    if (!sameSelection(hit, hovered)) {
      hovered = hit;
      draw();
    }
    glCanvas.style.cursor = spacePanning ? 'grab' : hit ? 'pointer' : 'grab';
    return;
  }
  const currentDrag = drag;
  const worldPoint = eventPoint(event);
  if (currentDrag.kind === 'pan') {
    const dx = event.clientX - currentDrag.x;
    const dy = event.clientY - currentDrag.y;
    if (Math.hypot(dx, dy) > 3) currentDrag.moved = true;
    camera.x -= dx / camera.zoom;
    camera.y -= dy / camera.zoom;
    currentDrag.x = event.clientX;
    currentDrag.y = event.clientY;
    draw();
    return;
  }
  const dx = worldPoint.x - currentDrag.start.x;
  const dy = worldPoint.y - currentDrag.start.y;
  if (Math.hypot(dx, dy) > 2) currentDrag.moved = true;
  if (currentDrag.kind === 'place') preview = { kind: 'place', id: currentDrag.id, x: currentDrag.originX + dx, y: currentDrag.originY + dy };
  if (currentDrag.kind === 'region') preview = { kind: 'region', id: currentDrag.id, geometry: translatePolygon(currentDrag.origin, dx, dy) };
  if (currentDrag.kind === 'vertex') {
    const points = currentDrag.origin.points.map((point, index) => index === currentDrag.index ? worldPoint : point);
    preview = { kind: 'region', id: currentDrag.id, geometry: { type: 'Polygon', points } };
    selectedVertex = { regionId: currentDrag.id, index: currentDrag.index };
  }
  draw();
});

glCanvas.addEventListener('pointerup', async (event) => {
  const finished = drag;
  drag = null;
  if (!finished) return;
  if (!finished.moved) {
    if (finished.kind === 'pan' && !finished.selectOnClick) return;
    const hit = finished.kind === 'vertex' ? { type: 'region' as const, id: finished.id } : pick(eventPoint(event));
    if (!sameSelection(selection, hit)) selectedVertex = null;
    selection = hit;
    formDirty = false;
    renderChrome();
    draw();
    return;
  }
  try {
    if (finished.kind === 'place' && preview?.kind === 'place') {
      await api.patchPlace(finished.id, { x: preview.x, y: preview.y });
      setStatus('地点坐标已保存');
    }
    if (finished.kind === 'region' && preview?.kind === 'region') {
      await api.patchRegion(finished.id, { geometry: preview.geometry });
      setStatus('区域多边形已平移并保存');
    }
    if (finished.kind === 'vertex' && preview?.kind === 'region') {
      await api.patchRegion(finished.id, { geometry: preview.geometry });
      setStatus('区域顶点已保存');
    }
    preview = null;
    formDirty = false;
    await reload(false);
  } catch (error) {
    preview = null;
    setStatus(error instanceof Error ? error.message : '拖动保存失败', true);
    draw();
  }
});

glCanvas.addEventListener('pointercancel', () => {
  drag = null;
  preview = null;
  draw();
});

glCanvas.addEventListener('dblclick', (event) => {
  const hit = pick(eventPoint(event));
  if (hit?.type === 'region') void goto(hit.id);
});

glCanvas.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    const rect = glCanvas.getBoundingClientRect();
    const { width, height } = viewSize();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    const before = screenToWorld(camera, width, height, sx, sy);
    const factor = event.deltaY < 0 ? 1.12 : 0.89;
    camera.zoom = Math.min(400, Math.max(0.02, camera.zoom * factor));
    const after = screenToWorld(camera, width, height, sx, sy);
    camera.x += before.x - after.x;
    camera.y += before.y - after.y;
    draw();
  },
  { passive: false },
);

document.querySelector('#zoom-in')!.addEventListener('click', () => zoomBy(1.2));
document.querySelector('#zoom-out')!.addEventListener('click', () => zoomBy(1 / 1.2));
document.querySelector('#grid-toggle')!.addEventListener('click', (event) => {
  gridVisible = !gridVisible;
  (event.currentTarget as HTMLButtonElement).textContent = gridVisible ? '隐藏网格' : '显示网格';
  draw();
});

window.addEventListener('keydown', (event) => {
  const target = event.target;
  const interactive = target instanceof HTMLElement && Boolean(target.closest('button,a,input,textarea,select,[contenteditable="true"]'));
  if (interactive) return;
  if (event.code === 'Space') {
    event.preventDefault();
    spacePanning = true;
    glCanvas.style.cursor = 'grab';
  } else if (event.key === 'Delete' || event.key === 'Backspace') {
    if (selectedVertex) {
      event.preventDefault();
      deleteSelectedVertex();
    }
  } else if (event.key === '+' || event.key === '=') {
    event.preventDefault();
    zoomBy(1.2);
  } else if (event.key === '-') {
    event.preventDefault();
    zoomBy(1 / 1.2);
  }
});
window.addEventListener('keyup', (event) => {
  if (event.code === 'Space') {
    spacePanning = false;
    glCanvas.style.cursor = '';
  }
});
window.addEventListener('blur', () => {
  spacePanning = false;
});

document.querySelector('#fit')!.addEventListener('click', () => fit());
document.querySelector('#up')!.addEventListener('click', () => {
  const crumbsNow = view?.breadcrumb ?? [];
  const parent = crumbsNow.length > 1 ? crumbsNow[crumbsNow.length - 2].id : null;
  void goto(parent);
});
document.querySelector('#refresh')!.addEventListener('click', () => {
  formDirty = false;
  void reload(false).then(() => setStatus('已从数据库重新读取'));
});
document.querySelector('#key-button')!.addEventListener('click', () => {
  keyInput.value = sessionStorage.getItem(KEY_STORAGE) ?? '';
  dialog.showModal();
});
document.querySelector('#key-close')!.addEventListener('click', () => dialog.close());
document.querySelector('#key-clear')!.addEventListener('click', () => {
  sessionStorage.removeItem(KEY_STORAGE);
  scopes = [];
  dialog.close();
  setStatus('已清除标签页中的密钥');
  renderChrome();
});
document.querySelector('#key-form')!.addEventListener('submit', async () => {
  sessionStorage.setItem(KEY_STORAGE, keyInput.value.trim());
  await boot();
});

window.addEventListener('resize', resize);
window.addEventListener('focus', () => {
  if (!formDirty) void reload(false).catch(() => undefined);
});

async function boot(): Promise<void> {
  const key = sessionStorage.getItem(KEY_STORAGE) ?? '';
  if (!key) {
    scopes = [];
    view = null;
    renderChrome();
    dialog.showModal();
    setStatus('先粘贴 API Key。种子命令会在终端打印明文。', true);
    return;
  }
  try {
    const me = await api.me();
    scopes = me.scopes;
    who.textContent = `${me.name} · ${scopes.join(' · ')}`;
    await reload(view == null);
    setStatus(canWrite() ? '可以校正并立即落库' : '当前密钥只读');
  } catch (error) {
    scopes = [];
    const message = error instanceof ApiError ? error.message : '无法连接';
    setStatus(message, true);
    dialog.showModal();
  }
}

resize();
void boot();
