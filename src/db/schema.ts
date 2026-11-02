import { type AnySQLiteColumn, index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const apiKeys = sqliteTable('api_keys', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  keyPrefix: text('key_prefix').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  scopes: text('scopes').notNull(),
  createdAt: text('created_at').notNull(),
  revokedAt: text('revoked_at'),
});

export const regions = sqliteTable(
  'regions',
  {
    id: text('id').primaryKey(),
    parentId: text('parent_id').references((): AnySQLiteColumn => regions.id, { onDelete: 'cascade' }),
    level: text('level').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    tags: text('tags').notNull().default('[]'),
    geometry: text('geometry').notNull(),
    fill: text('fill').notNull().default('#3d6b58'),
    stroke: text('stroke').notNull().default('#f0e2c0'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    index('regions_parent_idx').on(table.parentId),
    index('regions_level_idx').on(table.level),
  ],
);

export const places = sqliteTable(
  'places',
  {
    id: text('id').primaryKey(),
    regionId: text('region_id')
      .notNull()
      .references(() => regions.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    tags: text('tags').notNull().default('[]'),
    kind: text('kind').notNull().default('landmark'),
    x: real('x').notNull(),
    y: real('y').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [index('places_region_idx').on(table.regionId)],
);

export const indoorFloors = sqliteTable(
  'indoor_floors',
  {
    id: text('id').primaryKey(),
    regionId: text('region_id')
      .notNull()
      .references(() => regions.id, { onDelete: 'cascade' }),
    floorIndex: integer('floor_index').notNull(),
    name: text('name').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('floors_region_index_uq').on(table.regionId, table.floorIndex),
    index('floors_region_idx').on(table.regionId),
  ],
);

export const indoorTiles = sqliteTable(
  'indoor_tiles',
  {
    id: text('id').primaryKey(),
    floorId: text('floor_id')
      .notNull()
      .references(() => indoorFloors.id, { onDelete: 'cascade' }),
    x: integer('x').notNull(),
    y: integer('y').notNull(),
    tileType: text('tile_type').notNull(),
    meta: text('meta').notNull().default('{}'),
  },
  (table) => [
    uniqueIndex('tiles_floor_xy_uq').on(table.floorId, table.x, table.y),
    index('tiles_floor_idx').on(table.floorId),
  ],
);

export const snapshots = sqliteTable(
  'snapshots',
  {
    id: text('id').primaryKey(),
    label: text('label').notNull(),
    reason: text('reason').notNull(),
    actorKeyId: text('actor_key_id'),
    payload: text('payload').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('snapshots_created_idx').on(table.createdAt)],
);

export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    actorKeyId: text('actor_key_id'),
    actorName: text('actor_name').notNull(),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    detail: text('detail').notNull().default('{}'),
    snapshotId: text('snapshot_id'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('audit_created_idx').on(table.createdAt)],
);
