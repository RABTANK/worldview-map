import { isFiniteCoord, parseLineString, parsePolygon, type LineString, type Polygon } from '../shared/geom.js';
import { isRegionLevel, type RegionLevel } from '../shared/levels.js';
import { ROUTE_KINDS, SCOPES, type RouteKind, type Scope } from '../shared/types.js';
import { AppError } from './errors.js';

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const KIND_RE = /^[a-z0-9_-]{1,32}$/;

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return crypto.randomUUID();
}

export function requireId(value: string | undefined): string {
  if (value == null || value === '') return newId();
  if (!ID_RE.test(value)) throw new AppError(400, 'VALIDATION', 'id 只能包含字母、数字、下划线和连字符，最长 80');
  return value;
}

export function normalizeName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 80) throw new AppError(400, 'VALIDATION', '名称长度需为 1–80');
  return trimmed;
}

export function normalizeDescription(description: string | undefined): string {
  const value = description ?? '';
  if (value.length > 4000) throw new AppError(400, 'VALIDATION', '描述最长 4000 字');
  return value;
}

export function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  const out: string[] = [];
  for (const tag of tags) {
    if (typeof tag !== 'string') throw new AppError(400, 'VALIDATION', 'tags 必须是字符串数组');
    const trimmed = tag.trim();
    if (!trimmed) continue;
    if (trimmed.length > 24) throw new AppError(400, 'VALIDATION', '单个标签最长 24 字');
    if (!out.includes(trimmed)) out.push(trimmed);
  }
  if (out.length > 12) throw new AppError(400, 'VALIDATION', '标签最多 12 个');
  return out;
}

export function normalizeColor(value: string | undefined, fallback: string): string {
  if (value == null || value === '') return fallback;
  if (!COLOR_RE.test(value)) throw new AppError(400, 'VALIDATION', '颜色需为 #RGB 或 #RRGGBB');
  return value.toLowerCase();
}

export function normalizeKind(kind: string | undefined): string {
  const value = kind ?? 'landmark';
  if (!KIND_RE.test(value)) throw new AppError(400, 'VALIDATION', 'kind 需为 1–32 位小写字母、数字、下划线或连字符');
  return value;
}

export function requirePolygon(input: unknown): Polygon {
  const polygon = parsePolygon(input);
  if (!polygon) throw new AppError(400, 'VALIDATION', 'geometry 需为至少 3 个点的 Polygon');
  return polygon;
}

export function requireLineString(input: unknown): LineString {
  const line = parseLineString(input);
  if (!line) throw new AppError(400, 'VALIDATION', 'geometry 需为 2–256 个点的 LineString');
  return line;
}

export function normalizeRouteKind(kind: string | undefined): RouteKind {
  const value = kind ?? 'road';
  if (!(ROUTE_KINDS as readonly string[]).includes(value)) {
    throw new AppError(400, 'VALIDATION', 'kind 必须是 road/trail/sea/custom');
  }
  return value as RouteKind;
}

export function normalizeRouteWidth(value: number | null | undefined): number | null {
  if (value == null) return null;
  if (!Number.isInteger(value) || value < 1 || value > 64) {
    throw new AppError(400, 'VALIDATION', 'width 需为 1–64 的局部坐标单位');
  }
  return value;
}

export function normalizeRouteStyle(value: string | null | undefined): string | null {
  if (value == null || value === '') return null;
  return normalizeColor(value, '#d9b66f');
}

export function requireLevel(value: string): RegionLevel {
  if (!isRegionLevel(value)) throw new AppError(400, 'VALIDATION', 'level 必须是 continent/city/district/building_group/building');
  return value;
}

export function requireCoord(value: number, label: string): number {
  if (!isFiniteCoord(value)) throw new AppError(400, 'VALIDATION', `${label} 超出范围`);
  return value;
}

export function normalizeScopes(scopes: string[]): Scope[] {
  if (!Array.isArray(scopes) || scopes.length === 0) throw new AppError(400, 'VALIDATION', '至少指定一个权限');
  const out: Scope[] = [];
  for (const scope of scopes) {
    if (!(SCOPES as readonly string[]).includes(scope)) {
      throw new AppError(400, 'VALIDATION', `未知权限 ${scope}`);
    }
    const typed = scope as Scope;
    if (!out.includes(typed)) out.push(typed);
  }
  return out;
}
