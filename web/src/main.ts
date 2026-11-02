import './style.css';
import { fitCamera, screenToWorld, worldToScreen, type Camera } from '../../src/shared/camera.js';
import { distance, pointInPolygon, polygonBounds, translatePolygon, vertexAverage, type Point, type Polygon } from '../../src/shared/geom.js';
import { LEVEL_LABEL } from '../../src/shared/levels.js';
import { TILE_COLORS, TILE_LABEL, TILE_TYPES, type TileType } from '../../src/shared/tiles.js';
import type { MapView, Place, Region, Scope } from '../../src/shared/types.js';
import { Api, ApiError } from './api.js';
import { MapGl } from './gl.js';

type Selection =
  | { type: 'region'; id: string }
  | { type: 'place'; id: string }
  | { type: 'tile'; x: number; y: number }
  | null;

type Drag =
  | { kind: 'pan'; x: number; y: number; moved: boolean }
  | { kind: 'place'; id: string; originX: number; originY: number; start: Point; moved: boolean }
  | { kind: 'region'; id: string; origin: Polygon; start: Point; moved: boolean };

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
let formDirty = false;
let drag: Drag | null = null;
let preview: { kind: 'place'; id: string; x: number; y: number } | { kind: 'region'; id: string; geometry: Polygon } | null = null;
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
  if (!points.length) {
    camera = { x: 500, y: 500, zoom: Math.min(width, height) / 1200 };
  } else {
    camera = fitCamera(polygonBounds(points), width, height, 56);
  }
  draw();
}

function draw(): void {
  if (!renderer || !view) return;
  const { width, height } = viewSize();
  if (width < 2 || height < 2) return;
  const selectedRegion = selection?.type === 'region' ? selection.id : null;
  const selectedPlace = selection?.type === 'place' ? selection.id : null;
  const polygons = indoor()
    ? []
    : view.children.map((child) => ({
        points: childGeometry(child).points,
        fill: child.fill,
        stroke: child.id === selectedRegion ? '#f2d48a' : child.stroke,
      }));
  const places = indoor()
    ? []
    : view.places.map((place) => ({
        ...placePoint(place),
        fill: place.id === selectedPlace ? '#f2d48a' : '#f4ecdf',
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
  grid = { minX, minY, maxX, maxY, step: floor ? 1 : 100 };
  renderer.draw({ camera, width, height, polygons, places, tiles, grid });
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
  ctx.font = '14px Palatino, "Songti SC", serif';
  if (!indoor()) {
    for (const child of view.children) {
      const center = vertexAverage(childGeometry(child).points);
      const screen = worldToScreen(camera, width, height, center.x, center.y);
      ctx.fillText(child.name, screen.x, screen.y);
    }
    ctx.font = '12px Palatino, "Songti SC", serif';
    for (const place of view.places) {
      const point = placePoint(place);
      const screen = worldToScreen(camera, width, height, point.x, point.y);
      ctx.fillText(place.name, screen.x, screen.y + 16);
    }
  } else if (!view.indoor?.activeFloor) {
    ctx.fillText('这栋建筑还没有室内楼层', width / 2, height / 2);
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
      ? '室内平面：点击格子可选中。有 write 权限时，用下方色块立即改 tile。滚轮缩放，拖动空白平移。'
      : '进入建筑后这里是室内平面。返回上级可回到建筑所在的建筑群。'
    : '拖动空白平移，滚轮缩放，双击区域下钻。拖动地点可校正坐标；按住 Shift 拖动区域可平移多边形。只渲染当前层的直接子级。';
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

glCanvas.addEventListener('pointerdown', (event) => {
  if (!view) return;
  glCanvas.setPointerCapture(event.pointerId);
  const worldPoint = eventPoint(event);
  const hit = pick(worldPoint);
  if (event.button === 1 || event.altKey) {
    drag = { kind: 'pan', x: event.clientX, y: event.clientY, moved: false };
    return;
  }
  if (canWrite() && hit?.type === 'place' && !event.shiftKey) {
    const place = view.places.find((item) => item.id === hit.id)!;
    drag = { kind: 'place', id: hit.id, originX: place.x, originY: place.y, start: worldPoint, moved: false };
    selection = hit;
    return;
  }
  if (canWrite() && event.shiftKey && hit?.type === 'region') {
    const region = view.children.find((item) => item.id === hit.id)!;
    drag = { kind: 'region', id: hit.id, origin: region.geometry, start: worldPoint, moved: false };
    selection = hit;
    return;
  }
  drag = { kind: 'pan', x: event.clientX, y: event.clientY, moved: false };
  if (hit) selection = hit;
});

glCanvas.addEventListener('pointermove', (event) => {
  if (!drag) return;
  const worldPoint = eventPoint(event);
  if (drag.kind === 'pan') {
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.hypot(dx, dy) > 3) drag.moved = true;
    camera.x -= dx / camera.zoom;
    camera.y -= dy / camera.zoom;
    drag.x = event.clientX;
    drag.y = event.clientY;
    draw();
    return;
  }
  const dx = worldPoint.x - drag.start.x;
  const dy = worldPoint.y - drag.start.y;
  if (Math.hypot(dx, dy) > 2) drag.moved = true;
  if (drag.kind === 'place') preview = { kind: 'place', id: drag.id, x: drag.originX + dx, y: drag.originY + dy };
  if (drag.kind === 'region') preview = { kind: 'region', id: drag.id, geometry: translatePolygon(drag.origin, dx, dy) };
  draw();
});

glCanvas.addEventListener('pointerup', async (event) => {
  const finished = drag;
  drag = null;
  if (!finished) return;
  if (!finished.moved) {
    const hit = pick(eventPoint(event));
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
    preview = null;
    formDirty = false;
    await reload(false);
  } catch (error) {
    preview = null;
    setStatus(error instanceof Error ? error.message : '拖动保存失败', true);
    draw();
  }
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
