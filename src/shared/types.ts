import type { Polygon } from './geom.js';
import type { RegionLevel } from './levels.js';
import type { TileType } from './tiles.js';

export const SCOPES = ['read', 'write', 'delete', 'admin'] as const;
export type Scope = (typeof SCOPES)[number];

export type Region = {
  id: string;
  parentId: string | null;
  level: RegionLevel;
  name: string;
  description: string;
  tags: string[];
  geometry: Polygon;
  fill: string;
  stroke: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type Place = {
  id: string;
  regionId: string;
  name: string;
  description: string;
  tags: string[];
  kind: string;
  x: number;
  y: number;
  createdAt: string;
  updatedAt: string;
};

export type Floor = {
  id: string;
  regionId: string;
  floorIndex: number;
  name: string;
  width: number;
  height: number;
  createdAt: string;
  updatedAt: string;
};

export type Tile = {
  id: string;
  floorId: string;
  x: number;
  y: number;
  tileType: TileType;
  meta: Record<string, unknown>;
};

export type IndoorView = {
  floors: Floor[];
  activeFloor: (Floor & { tiles: Tile[] }) | null;
};

export type Crumb = { id: string; name: string; level: RegionLevel };

export type MapView = {
  region: Region | null;
  breadcrumb: Crumb[];
  children: Region[];
  places: Place[];
  indoor: IndoorView | null;
  summary: string;
};

export type PublicKey = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: Scope[];
  createdAt: string;
  revokedAt: string | null;
};

export type Actor = {
  keyId: string | null;
  name: string;
  scopes: Scope[];
};

export type SnapshotMeta = {
  id: string;
  label: string;
  reason: string;
  actorKeyId: string | null;
  createdAt: string;
};

export type AuditEntry = {
  id: string;
  actorKeyId: string | null;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string | null;
  detail: unknown;
  snapshotId: string | null;
  createdAt: string;
};
