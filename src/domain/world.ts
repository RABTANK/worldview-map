import type Database from 'better-sqlite3';
import { and, asc, desc, eq, isNull, like, or } from 'drizzle-orm';
import { auditLogs, indoorFloors, indoorTiles, places, regions, snapshots } from '../db/schema.js';
import { distance, translatePolygon } from '../shared/geom.js';
import { expectedParentLevel, LEVEL_LABEL, LEVELS, type RegionLevel } from '../shared/levels.js';
import { isTileType, type TileType } from '../shared/tiles.js';
import type { Actor, AuditEntry, Floor, IndoorView, MapView, Place, Region, SnapshotMeta, Tile } from '../shared/types.js';
import type { DB } from './auth.js';
import { hasScope } from './auth.js';
import { AppError } from './errors.js';
import {
  newId,
  normalizeColor,
  normalizeDescription,
  normalizeKind,
  normalizeName,
  normalizeTags,
  nowIso,
  requireCoord,
  requireId,
  requireLevel,
  requirePolygon,
} from './validate.js';

type RegionRow = typeof regions.$inferSelect;
type PlaceRow = typeof places.$inferSelect;
type FloorRow = typeof indoorFloors.$inferSelect;
type TileRow = typeof indoorTiles.$inferSelect;

type SnapshotPayload = {
  regions: Region[];
  places: Place[];
  floors: Floor[];
  tiles: Tile[];
};

export type RegionInput = {
  id?: string;
  parentId?: string | null;
  level: string;
  name: string;
  description?: string;
  tags?: string[];
  geometry: unknown;
  fill?: string;
  stroke?: string;
  sortOrder?: number;
};

export type RegionPatch = {
  parentId?: string | null;
  level?: string;
  name?: string;
  description?: string;
  tags?: string[];
  geometry?: unknown;
  fill?: string;
  stroke?: string;
  sortOrder?: number;
};

export type PlaceInput = {
  id?: string;
  regionId: string;
  name: string;
  description?: string;
  tags?: string[];
  kind?: string;
  x: number;
  y: number;
  ignoreConflict?: boolean;
};

export type PlacePatch = {
  regionId?: string;
  name?: string;
  description?: string;
  tags?: string[];
  kind?: string;
  x?: number;
  y?: number;
  ignoreConflict?: boolean;
};

export type FloorInput = {
  id?: string;
  regionId: string;
  floorIndex: number;
  name: string;
  width: number;
  height: number;
};

export type FloorPatch = {
  floorIndex?: number;
  name?: string;
  width?: number;
  height?: number;
};

export type TileInput = {
  x: number;
  y: number;
  tileType: string;
  meta?: Record<string, unknown>;
};

const AUTO_PREFIX = 'auto:';

function parseJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function toRegion(row: RegionRow): Region {
  return {
    id: row.id,
    parentId: row.parentId,
    level: requireLevel(row.level),
    name: row.name,
    description: row.description,
    tags: parseJson<string[]>(row.tags, []),
    geometry: requirePolygon(parseJson(row.geometry, null)),
    fill: row.fill,
    stroke: row.stroke,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toPlace(row: PlaceRow): Place {
  return {
    id: row.id,
    regionId: row.regionId,
    name: row.name,
    description: row.description,
    tags: parseJson<string[]>(row.tags, []),
    kind: row.kind,
    x: row.x,
    y: row.y,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toFloor(row: FloorRow): Floor {
  return {
    id: row.id,
    regionId: row.regionId,
    floorIndex: row.floorIndex,
    name: row.name,
    width: row.width,
    height: row.height,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toTile(row: TileRow): Tile {
  const tileType = row.tileType;
  if (!isTileType(tileType)) throw new AppError(500, 'INTERNAL', '数据损坏');
  return {
    id: row.id,
    floorId: row.floorId,
    x: row.x,
    y: row.y,
    tileType,
    meta: parseJson<Record<string, unknown>>(row.meta, {}),
  };
}

export class WorldService {
  constructor(
    private sqlite: Database.Database,
    private db: DB,
    private options: { snapshotLimit: number; conflictDistance: number },
  ) {}

  listChildren(parentId: string | null): Region[] {
    const rows = parentId
      ? this.db.select().from(regions).where(eq(regions.parentId, parentId)).all()
      : this.db.select().from(regions).where(isNull(regions.parentId)).all();
    return rows
      .map(toRegion)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'zh'));
  }

  listRegions(): Region[] {
    return this.db.select().from(regions).all().map(toRegion);
  }

  getRegion(id: string): Region {
    const row = this.db.select().from(regions).where(eq(regions.id, id)).get();
    if (!row) throw new AppError(404, 'NOT_FOUND', '区域不存在');
    return toRegion(row);
  }

  createRegion(input: RegionInput, actor: Actor): Region {
    const id = requireId(input.id);
    if (this.db.select().from(regions).where(eq(regions.id, id)).get()) {
      throw new AppError(409, 'CONFLICT', '区域 id 已存在');
    }
    const level = requireLevel(input.level);
    const parentId = this.normalizeParent(level, input.parentId ?? null);
    const geometry = requirePolygon(input.geometry);
    const timestamp = nowIso();
    const region: Region = {
      id,
      parentId,
      level,
      name: normalizeName(input.name),
      description: normalizeDescription(input.description),
      tags: normalizeTags(input.tags),
      geometry,
      fill: normalizeColor(input.fill, '#3d6b58'),
      stroke: normalizeColor(input.stroke, '#f0e2c0'),
      sortOrder: this.requireSort(input.sortOrder),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.insertRegion(region);
    this.audit(actor, 'region.create', 'region', region.id, { name: region.name, level: region.level });
    return region;
  }

  updateRegion(id: string, patch: RegionPatch, actor: Actor): Region {
    const current = this.getRegion(id);
    const level = patch.level == null ? current.level : requireLevel(patch.level);
    const parentId = patch.parentId === undefined ? current.parentId : this.normalizeParent(level, patch.parentId);
    if (level !== current.level && this.listChildren(id).length > 0) {
      throw new AppError(409, 'CONFLICT', '存在子区域时不能更改层级');
    }
    this.assertParentMatches(level, parentId);
    if (parentId) this.assertNotDescendant(id, parentId);
    const next: Region = {
      ...current,
      parentId,
      level,
      name: patch.name == null ? current.name : normalizeName(patch.name),
      description: patch.description == null ? current.description : normalizeDescription(patch.description),
      tags: patch.tags == null ? current.tags : normalizeTags(patch.tags),
      geometry: patch.geometry == null ? current.geometry : requirePolygon(patch.geometry),
      fill: patch.fill == null ? current.fill : normalizeColor(patch.fill, current.fill),
      stroke: patch.stroke == null ? current.stroke : normalizeColor(patch.stroke, current.stroke),
      sortOrder: patch.sortOrder == null ? current.sortOrder : this.requireSort(patch.sortOrder),
      updatedAt: nowIso(),
    };
    this.db
      .update(regions)
      .set({
        parentId: next.parentId,
        level: next.level,
        name: next.name,
        description: next.description,
        tags: JSON.stringify(next.tags),
        geometry: JSON.stringify(next.geometry),
        fill: next.fill,
        stroke: next.stroke,
        sortOrder: next.sortOrder,
        updatedAt: next.updatedAt,
      })
      .where(eq(regions.id, id))
      .run();
    this.audit(actor, 'region.update', 'region', id, { name: next.name });
    return next;
  }

  deleteRegion(id: string, options: { confirm: boolean; cascade: boolean }, actor: Actor): { snapshotId: string } {
    if (!options.confirm) throw new AppError(400, 'CONFIRMATION_REQUIRED', '删除区域需要 confirm=true');
    const region = this.getRegion(id);
    const descendants = this.descendantIds(id);
    const hasNested = descendants.length > 1;
    if (hasNested && !options.cascade) {
      throw new AppError(409, 'CONFLICT', '目标包含子区域，需要 cascade=true');
    }
    const snapshot = this.createSnapshot(actor, `删除区域前：${region.name}`, 'auto:before_delete');
    const remove = this.sqlite.transaction(() => {
      for (const regionId of [...descendants].reverse()) this.deleteRegionRow(regionId);
    });
    remove();
    this.audit(actor, 'region.delete', 'region', id, { name: region.name, cascade: options.cascade }, snapshot.id);
    return { snapshotId: snapshot.id };
  }

  listPlaces(filter: {
    regionId?: string;
    minX?: number;
    minY?: number;
    maxX?: number;
    maxY?: number;
    q?: string;
  }): Place[] {
    const bounds = [filter.minX, filter.minY, filter.maxX, filter.maxY];
    const boundCount = bounds.filter((value) => value != null).length;
    if (boundCount !== 0 && boundCount !== 4) {
      throw new AppError(400, 'VALIDATION', '范围查询需要同时提供 minX、minY、maxX、maxY');
    }
    let rows = filter.regionId
      ? this.db.select().from(places).where(eq(places.regionId, filter.regionId)).all()
      : this.db.select().from(places).all();
    if (filter.q) {
      const needle = filter.q.trim().toLowerCase();
      rows = rows.filter((row) => row.name.toLowerCase().includes(needle) || row.tags.toLowerCase().includes(needle));
    }
    if (boundCount === 4) {
      const minX = filter.minX as number;
      const minY = filter.minY as number;
      const maxX = filter.maxX as number;
      const maxY = filter.maxY as number;
      rows = rows.filter((row) => row.x >= minX && row.x <= maxX && row.y >= minY && row.y <= maxY);
    }
    return rows.map(toPlace).sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  }

  getPlace(id: string): Place {
    const row = this.db.select().from(places).where(eq(places.id, id)).get();
    if (!row) throw new AppError(404, 'NOT_FOUND', '地点不存在');
    return toPlace(row);
  }

  createPlace(input: PlaceInput, actor: Actor): Place {
    const id = requireId(input.id);
    if (this.db.select().from(places).where(eq(places.id, id)).get()) {
      throw new AppError(409, 'CONFLICT', '地点 id 已存在');
    }
    this.getRegion(input.regionId);
    const x = requireCoord(input.x, 'x');
    const y = requireCoord(input.y, 'y');
    this.assertNoConflict(input.regionId, x, y, Boolean(input.ignoreConflict));
    const timestamp = nowIso();
    const place: Place = {
      id,
      regionId: input.regionId,
      name: normalizeName(input.name),
      description: normalizeDescription(input.description),
      tags: normalizeTags(input.tags),
      kind: normalizeKind(input.kind),
      x,
      y,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.insertPlace(place);
    this.audit(actor, 'place.create', 'place', place.id, { name: place.name, regionId: place.regionId });
    return place;
  }

  updatePlace(id: string, patch: PlacePatch, actor: Actor): Place {
    const current = this.getPlace(id);
    const regionId = patch.regionId ?? current.regionId;
    this.getRegion(regionId);
    const x = patch.x == null ? current.x : requireCoord(patch.x, 'x');
    const y = patch.y == null ? current.y : requireCoord(patch.y, 'y');
    this.assertNoConflict(regionId, x, y, Boolean(patch.ignoreConflict), id);
    const next: Place = {
      ...current,
      regionId,
      name: patch.name == null ? current.name : normalizeName(patch.name),
      description: patch.description == null ? current.description : normalizeDescription(patch.description),
      tags: patch.tags == null ? current.tags : normalizeTags(patch.tags),
      kind: patch.kind == null ? current.kind : normalizeKind(patch.kind),
      x,
      y,
      updatedAt: nowIso(),
    };
    this.db
      .update(places)
      .set({
        regionId: next.regionId,
        name: next.name,
        description: next.description,
        tags: JSON.stringify(next.tags),
        kind: next.kind,
        x: next.x,
        y: next.y,
        updatedAt: next.updatedAt,
      })
      .where(eq(places.id, id))
      .run();
    this.audit(actor, 'place.update', 'place', id, { name: next.name });
    return next;
  }

  upsertPlace(input: PlaceInput, actor: Actor): Place {
    if (input.id && this.db.select().from(places).where(eq(places.id, input.id)).get()) {
      return this.updatePlace(input.id, input, actor);
    }
    return this.createPlace(input, actor);
  }

  deletePlace(id: string, confirm: boolean, actor: Actor): void {
    if (!confirm) throw new AppError(400, 'CONFIRMATION_REQUIRED', '删除地点需要 confirm=true');
    const place = this.getPlace(id);
    this.db.delete(places).where(eq(places.id, id)).run();
    this.audit(actor, 'place.delete', 'place', id, { name: place.name });
  }

  listFloors(regionId: string): Floor[] {
    this.assertBuilding(regionId);
    return this.db
      .select()
      .from(indoorFloors)
      .where(eq(indoorFloors.regionId, regionId))
      .orderBy(asc(indoorFloors.floorIndex))
      .all()
      .map(toFloor);
  }

  getFloor(id: string): Floor & { tiles: Tile[] } {
    const row = this.db.select().from(indoorFloors).where(eq(indoorFloors.id, id)).get();
    if (!row) throw new AppError(404, 'NOT_FOUND', '楼层不存在');
    const tiles = this.db.select().from(indoorTiles).where(eq(indoorTiles.floorId, id)).all().map(toTile);
    return { ...toFloor(row), tiles };
  }

  createFloor(input: FloorInput, actor: Actor): Floor {
    this.assertBuilding(input.regionId);
    const id = requireId(input.id);
    if (this.db.select().from(indoorFloors).where(eq(indoorFloors.id, id)).get()) {
      throw new AppError(409, 'CONFLICT', '楼层 id 已存在');
    }
    const width = this.requireGridSize(input.width, 'width');
    const height = this.requireGridSize(input.height, 'height');
    const duplicate = this.db
      .select()
      .from(indoorFloors)
      .where(and(eq(indoorFloors.regionId, input.regionId), eq(indoorFloors.floorIndex, input.floorIndex)))
      .get();
    if (duplicate) throw new AppError(409, 'CONFLICT', '该建筑已有相同楼层序号');
    const timestamp = nowIso();
    const floor: Floor = {
      id,
      regionId: input.regionId,
      floorIndex: this.requireFloorIndex(input.floorIndex),
      name: normalizeName(input.name),
      width,
      height,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.insertFloor(floor);
    this.audit(actor, 'floor.create', 'floor', floor.id, { regionId: floor.regionId, name: floor.name });
    return floor;
  }

  updateFloor(id: string, patch: FloorPatch, actor: Actor): Floor {
    const current = this.getFloor(id);
    const width = patch.width == null ? current.width : this.requireGridSize(patch.width, 'width');
    const height = patch.height == null ? current.height : this.requireGridSize(patch.height, 'height');
    const floorIndex = patch.floorIndex == null ? current.floorIndex : this.requireFloorIndex(patch.floorIndex);
    if (floorIndex !== current.floorIndex) {
      const duplicate = this.db
        .select()
        .from(indoorFloors)
        .where(and(eq(indoorFloors.regionId, current.regionId), eq(indoorFloors.floorIndex, floorIndex)))
        .get();
      if (duplicate && duplicate.id !== id) throw new AppError(409, 'CONFLICT', '该建筑已有相同楼层序号');
    }
    const next: Floor = {
      ...current,
      floorIndex,
      name: patch.name == null ? current.name : normalizeName(patch.name),
      width,
      height,
      updatedAt: nowIso(),
    };
    const run = this.sqlite.transaction(() => {
      this.db
        .update(indoorFloors)
        .set({
          floorIndex: next.floorIndex,
          name: next.name,
          width: next.width,
          height: next.height,
          updatedAt: next.updatedAt,
        })
        .where(eq(indoorFloors.id, id))
        .run();
      if (width < current.width || height < current.height) {
        const tiles = this.db.select().from(indoorTiles).where(eq(indoorTiles.floorId, id)).all();
        for (const tile of tiles) {
          if (tile.x >= width || tile.y >= height) {
            this.db.delete(indoorTiles).where(eq(indoorTiles.id, tile.id)).run();
          }
        }
      }
    });
    run();
    this.audit(actor, 'floor.update', 'floor', id, { name: next.name });
    return next;
  }

  upsertFloor(input: FloorInput, actor: Actor): Floor {
    if (input.id) {
      const existing = this.db.select().from(indoorFloors).where(eq(indoorFloors.id, input.id)).get();
      if (existing) return this.updateFloor(input.id, input, actor);
    }
    return this.createFloor(input, actor);
  }

  deleteFloor(id: string, confirm: boolean, actor: Actor): void {
    if (!confirm) throw new AppError(400, 'CONFIRMATION_REQUIRED', '删除楼层需要 confirm=true');
    const floor = this.getFloor(id);
    const run = this.sqlite.transaction(() => {
      this.db.delete(indoorTiles).where(eq(indoorTiles.floorId, id)).run();
      this.db.delete(indoorFloors).where(eq(indoorFloors.id, id)).run();
    });
    run();
    this.audit(actor, 'floor.delete', 'floor', id, { name: floor.name });
  }

  setTiles(floorId: string, tiles: TileInput[], actor: Actor): Floor & { tiles: Tile[] } {
    const floor = this.getFloor(floorId);
    const seen = new Set<string>();
    const next: Tile[] = [];
    for (const tile of tiles) {
      if (!Number.isInteger(tile.x) || !Number.isInteger(tile.y)) {
        throw new AppError(400, 'VALIDATION', 'tile 坐标必须是整数');
      }
      if (tile.x < 0 || tile.y < 0 || tile.x >= floor.width || tile.y >= floor.height) {
        throw new AppError(400, 'VALIDATION', 'tile 坐标超出楼层范围');
      }
      if (!isTileType(tile.tileType)) throw new AppError(400, 'VALIDATION', `未知 tile 类型 ${tile.tileType}`);
      const key = `${tile.x},${tile.y}`;
      if (seen.has(key)) throw new AppError(400, 'VALIDATION', `重复的 tile 坐标 ${key}`);
      seen.add(key);
      const meta = tile.meta ?? {};
      if (JSON.stringify(meta).length > 500) throw new AppError(400, 'VALIDATION', 'tile meta 过长');
      next.push({
        id: newId(),
        floorId,
        x: tile.x,
        y: tile.y,
        tileType: tile.tileType,
        meta,
      });
    }
    const run = this.sqlite.transaction(() => {
      this.db.delete(indoorTiles).where(eq(indoorTiles.floorId, floorId)).run();
      for (const tile of next) this.insertTile(tile);
      this.db.update(indoorFloors).set({ updatedAt: nowIso() }).where(eq(indoorFloors.id, floorId)).run();
    });
    run();
    this.audit(actor, 'tiles.replace', 'floor', floorId, { count: next.length });
    return this.getFloor(floorId);
  }

  getView(regionId: string | null, floorId?: string | null): MapView {
    if (!regionId) {
      const children = this.listChildren(null);
      return {
        region: null,
        breadcrumb: [],
        children,
        places: [],
        indoor: null,
        summary: this.summarize(null, children, [], null),
      };
    }
    const region = this.getRegion(regionId);
    const children = region.level === 'building' ? [] : this.listChildren(region.id);
    const placeRows = this.listPlaces({ regionId: region.id });
    const indoor = region.level === 'building' ? this.indoorView(region.id, floorId ?? null) : null;
    return {
      region,
      breadcrumb: this.breadcrumb(region),
      children,
      places: placeRows,
      indoor,
      summary: this.summarize(region, children, placeRows, indoor),
    };
  }

  search(query: string): { regions: Region[]; places: Place[] } {
    const q = query.trim();
    if (!q) throw new AppError(400, 'VALIDATION', '搜索词不能为空');
    if (q.length > 80) throw new AppError(400, 'VALIDATION', '搜索词过长');
    const needle = `%${q.replace(/[%_]/g, '')}%`;
    const regionRows = this.db
      .select()
      .from(regions)
      .where(or(like(regions.name, needle), like(regions.description, needle), like(regions.tags, needle)))
      .limit(40)
      .all();
    const placeRows = this.db
      .select()
      .from(places)
      .where(or(like(places.name, needle), like(places.description, needle), like(places.tags, needle)))
      .limit(40)
      .all();
    return { regions: regionRows.map(toRegion), places: placeRows.map(toPlace) };
  }

  createSnapshot(actor: Actor, label: string, reason = 'manual'): SnapshotMeta {
    const cleanLabel = label.trim().slice(0, 120);
    if (!cleanLabel) throw new AppError(400, 'VALIDATION', '快照标签不能为空');
    if (reason !== 'manual' && !reason.startsWith(AUTO_PREFIX)) {
      throw new AppError(400, 'VALIDATION', '非法快照原因');
    }
    const payload = this.capture();
    const meta: SnapshotMeta = {
      id: newId(),
      label: cleanLabel,
      reason,
      actorKeyId: actor.keyId,
      createdAt: nowIso(),
    };
    const run = this.sqlite.transaction(() => {
      this.db
        .insert(snapshots)
        .values({ ...meta, payload: JSON.stringify(payload) })
        .run();
      this.pruneSnapshots(meta.id);
    });
    run();
    this.audit(actor, 'snapshot.create', 'snapshot', meta.id, { label: meta.label, reason: meta.reason });
    return meta;
  }

  listSnapshots(): SnapshotMeta[] {
    return this.db
      .select({
        id: snapshots.id,
        label: snapshots.label,
        reason: snapshots.reason,
        actorKeyId: snapshots.actorKeyId,
        createdAt: snapshots.createdAt,
      })
      .from(snapshots)
      .orderBy(asc(snapshots.createdAt))
      .all()
      .reverse();
  }

  getSnapshot(id: string): SnapshotMeta & { payload: SnapshotPayload } {
    const row = this.db.select().from(snapshots).where(eq(snapshots.id, id)).get();
    if (!row) throw new AppError(404, 'NOT_FOUND', '快照不存在');
    return {
      id: row.id,
      label: row.label,
      reason: row.reason,
      actorKeyId: row.actorKeyId,
      createdAt: row.createdAt,
      payload: parseJson<SnapshotPayload>(row.payload, { regions: [], places: [], floors: [], tiles: [] }),
    };
  }

  rollback(id: string, confirm: boolean, actor: Actor): { restoredSnapshotId: string; backupSnapshotId: string } {
    if (!hasScope(actor, 'admin')) throw new AppError(403, 'FORBIDDEN', '回滚需要 admin 权限');
    if (!confirm) throw new AppError(400, 'CONFIRMATION_REQUIRED', '回滚需要 confirm=true');
    const snapshot = this.getSnapshot(id);
    const backup = this.createSnapshot(actor, `回滚前自动备份`, 'auto:before_rollback');
    try {
      this.restore(snapshot.payload);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(500, 'INTERNAL', '快照载荷无法恢复');
    }
    this.audit(actor, 'snapshot.rollback', 'snapshot', id, { backupId: backup.id });
    return { restoredSnapshotId: id, backupSnapshotId: backup.id };
  }

  listLogs(limit = 50): AuditEntry[] {
    const size = Math.min(Math.max(limit, 1), 200);
    return this.db
      .select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(size)
      .all()
      .map((row) => ({
        id: row.id,
        actorKeyId: row.actorKeyId,
        actorName: row.actorName,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        detail: parseJson(row.detail, {}),
        snapshotId: row.snapshotId,
        createdAt: row.createdAt,
      }));
  }

  /** 供测试与校正使用：把多边形整体平移，仍走更新校验。 */
  translateRegion(id: string, dx: number, dy: number, actor: Actor): Region {
    const region = this.getRegion(id);
    return this.updateRegion(id, { geometry: translatePolygon(region.geometry, dx, dy) }, actor);
  }

  private indoorView(regionId: string, floorId: string | null): IndoorView {
    const floors = this.listFloors(regionId);
    if (floors.length === 0) return { floors: [], activeFloor: null };
    const selected = floors.find((floor) => floor.id === floorId) ?? floors[0];
    return { floors, activeFloor: this.getFloor(selected.id) };
  }

  private summarize(region: Region | null, children: Region[], placeRows: Place[], indoor: IndoorView | null): string {
    const head = region ? `${region.name}（${LEVEL_LABEL[region.level]}）` : '世界根';
    const childText = children.length ? children.map((child) => child.name).join('、') : '无';
    const placeText = placeRows.length ? placeRows.map((place) => place.name).join('、') : '无';
    const lines = [
      head,
      `直接子区域 ${children.length} 个：${childText}`,
      `地点 ${placeRows.length} 个：${placeText}`,
    ];
    if (indoor) {
      lines.push(
        indoor.floors.length
          ? `室内楼层 ${indoor.floors.length} 层，当前「${indoor.activeFloor?.name ?? ''}」`
          : '建筑尚无室内楼层',
      );
    }
    lines.push('坐标是当前区域的局部平面坐标，y 向下为正，不是经纬度。只应编辑直接子级，避免跨层重叠。');
    return lines.join('\n');
  }

  private assertBuilding(regionId: string): Region {
    const region = this.getRegion(regionId);
    if (region.level !== 'building') throw new AppError(400, 'VALIDATION', '只有建筑可以拥有室内楼层');
    return region;
  }

  private requireSort(value: number | undefined): number {
    const sort = value ?? 0;
    if (!Number.isInteger(sort) || sort < -10000 || sort > 10000) {
      throw new AppError(400, 'VALIDATION', 'sortOrder 需为 -10000 到 10000 的整数');
    }
    return sort;
  }

  private requireFloorIndex(value: number): number {
    if (!Number.isInteger(value) || value < -20 || value > 200) {
      throw new AppError(400, 'VALIDATION', 'floorIndex 需为 -20 到 200 的整数');
    }
    return value;
  }

  private requireGridSize(value: number, label: string): number {
    if (!Number.isInteger(value) || value < 1 || value > 64) {
      throw new AppError(400, 'VALIDATION', `${label} 需为 1–64 的整数`);
    }
    return value;
  }

  private normalizeParent(level: RegionLevel, parentId: string | null): string | null {
    this.assertParentMatches(level, parentId);
    return parentId;
  }

  private assertParentMatches(level: RegionLevel, parentId: string | null): void {
    const expected = expectedParentLevel(level);
    if (!expected) {
      if (parentId) throw new AppError(400, 'VALIDATION', '大陆不能有父区域');
      return;
    }
    if (!parentId) throw new AppError(400, 'VALIDATION', `${LEVEL_LABEL[level]}必须属于${LEVEL_LABEL[expected]}`);
    const parent = this.getRegion(parentId);
    if (parent.level !== expected) {
      throw new AppError(400, 'VALIDATION', `${LEVEL_LABEL[level]}的父级必须是${LEVEL_LABEL[expected]}`);
    }
  }

  private assertNotDescendant(regionId: string, parentId: string): void {
    let cursor: string | null = parentId;
    const seen = new Set<string>();
    while (cursor) {
      if (cursor === regionId) throw new AppError(400, 'VALIDATION', '不能把区域移动到自己的子孙下面');
      if (seen.has(cursor)) break;
      seen.add(cursor);
      cursor = this.getRegion(cursor).parentId;
    }
  }

  private assertNoConflict(regionId: string, x: number, y: number, ignore: boolean, selfId?: string): void {
    if (ignore) return;
    const rows = this.db.select().from(places).where(eq(places.regionId, regionId)).all();
    for (const row of rows) {
      if (row.id === selfId) continue;
      if (distance({ x, y }, { x: row.x, y: row.y }) < this.options.conflictDistance) {
        throw new AppError(
          409,
          'CONFLICT',
          `与地点「${row.name}」距离过近（阈值 ${this.options.conflictDistance}）。可设置 ignoreConflict=true 强制写入`,
        );
      }
    }
  }

  private descendantIds(id: string): string[] {
    const ids: string[] = [];
    const walk = (regionId: string) => {
      ids.push(regionId);
      for (const child of this.listChildren(regionId)) walk(child.id);
    };
    walk(id);
    return ids;
  }

  private breadcrumb(region: Region): MapView['breadcrumb'] {
    const chain = [region];
    const seen = new Set<string>([region.id]);
    let current = region;
    while (current.parentId) {
      if (seen.has(current.parentId)) break;
      const parent = this.db.select().from(regions).where(eq(regions.id, current.parentId)).get();
      if (!parent) break;
      const parsed = toRegion(parent);
      seen.add(parsed.id);
      chain.push(parsed);
      current = parsed;
    }
    return chain.reverse().map((item) => ({ id: item.id, name: item.name, level: item.level }));
  }

  private deleteRegionRow(id: string): void {
    const floorRows = this.db.select().from(indoorFloors).where(eq(indoorFloors.regionId, id)).all();
    for (const floor of floorRows) {
      this.db.delete(indoorTiles).where(eq(indoorTiles.floorId, floor.id)).run();
    }
    this.db.delete(indoorFloors).where(eq(indoorFloors.regionId, id)).run();
    this.db.delete(places).where(eq(places.regionId, id)).run();
    this.db.delete(regions).where(eq(regions.id, id)).run();
  }

  private capture(): SnapshotPayload {
    return {
      regions: this.db.select().from(regions).all().map(toRegion),
      places: this.db.select().from(places).all().map(toPlace),
      floors: this.db.select().from(indoorFloors).all().map(toFloor),
      tiles: this.db.select().from(indoorTiles).all().map(toTile),
    };
  }

  private restore(payload: SnapshotPayload): void {
    if (!payload || !Array.isArray(payload.regions) || !Array.isArray(payload.places)) {
      throw new AppError(500, 'INTERNAL', '快照载荷无法恢复');
    }
    const run = this.sqlite.transaction(() => {
      this.db.delete(indoorTiles).run();
      this.db.delete(indoorFloors).run();
      this.db.delete(places).run();
      for (const level of [...LEVELS].reverse()) {
        this.db.delete(regions).where(eq(regions.level, level)).run();
      }
      for (const level of LEVELS) {
        for (const region of payload.regions.filter((item) => item.level === level)) this.insertRegion(region);
      }
      for (const place of payload.places) this.insertPlace(place);
      for (const floor of payload.floors ?? []) this.insertFloor(floor);
      for (const tile of payload.tiles ?? []) this.insertTile(tile);
    });
    run();
  }

  private pruneSnapshots(keepId: string): void {
    const rows = this.db.select().from(snapshots).orderBy(asc(snapshots.createdAt)).all();
    let extra = rows.length - this.options.snapshotLimit;
    if (extra <= 0) return;
    const ordered = [
      ...rows.filter((row) => row.reason.startsWith(AUTO_PREFIX)),
      ...rows.filter((row) => !row.reason.startsWith(AUTO_PREFIX)),
    ];
    for (const row of ordered) {
      if (extra <= 0) break;
      if (row.id === keepId) continue;
      this.db.delete(snapshots).where(eq(snapshots.id, row.id)).run();
      extra -= 1;
    }
  }

  private insertRegion(region: Region): void {
    this.db
      .insert(regions)
      .values({
        id: region.id,
        parentId: region.parentId,
        level: region.level,
        name: region.name,
        description: region.description,
        tags: JSON.stringify(region.tags),
        geometry: JSON.stringify(region.geometry),
        fill: region.fill,
        stroke: region.stroke,
        sortOrder: region.sortOrder,
        createdAt: region.createdAt,
        updatedAt: region.updatedAt,
      })
      .run();
  }

  private insertPlace(place: Place): void {
    this.db
      .insert(places)
      .values({
        ...place,
        tags: JSON.stringify(place.tags),
      })
      .run();
  }

  private insertFloor(floor: Floor): void {
    this.db.insert(indoorFloors).values(floor).run();
  }

  private insertTile(tile: Tile): void {
    this.db
      .insert(indoorTiles)
      .values({ ...tile, tileType: tile.tileType satisfies TileType, meta: JSON.stringify(tile.meta) })
      .run();
  }

  private audit(
    actor: Actor,
    action: string,
    entityType: string,
    entityId: string | null,
    detail: unknown,
    snapshotId?: string,
  ): void {
    this.db
      .insert(auditLogs)
      .values({
        id: newId(),
        actorKeyId: actor.keyId,
        actorName: actor.name,
        action,
        entityType,
        entityId,
        detail: JSON.stringify(detail ?? {}),
        snapshotId: snapshotId ?? null,
        createdAt: nowIso(),
      })
      .run();
  }
}
