import { z } from 'zod';
import { AppError } from '../domain/errors.js';
import { LEVELS } from '../shared/levels.js';
import { TILE_TYPES } from '../shared/tiles.js';

const levelSchema = z.enum(LEVELS);
const tileTypeSchema = z.enum(TILE_TYPES);

export const polygonSchema = z.object({
  type: z.literal('Polygon'),
  points: z.array(z.object({ x: z.number(), y: z.number() })).min(3).max(64),
});

export const createRegionSchema = z.object({
  id: z.string().optional(),
  parentId: z.string().nullable().optional(),
  level: levelSchema,
  name: z.string(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  geometry: polygonSchema,
  fill: z.string().optional(),
  stroke: z.string().optional(),
  sortOrder: z.number().optional(),
});

export const patchRegionSchema = createRegionSchema.partial().refine((value) => Object.keys(value).length > 0, {
  message: '至少提供一个字段',
});

export const createPlaceSchema = z.object({
  id: z.string().optional(),
  regionId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  kind: z.string().optional(),
  x: z.number(),
  y: z.number(),
  ignoreConflict: z.boolean().optional(),
});

export const patchPlaceSchema = createPlaceSchema.partial().refine((value) => Object.keys(value).length > 0, {
  message: '至少提供一个字段',
});

export const floorBodySchema = z.object({
  id: z.string().optional(),
  floorIndex: z.number(),
  name: z.string(),
  width: z.number(),
  height: z.number(),
});

export const patchFloorSchema = floorBodySchema.partial().refine((value) => Object.keys(value).length > 0, {
  message: '至少提供一个字段',
});

export const setTilesSchema = z.object({
  tiles: z.array(
    z.object({
      x: z.number(),
      y: z.number(),
      tileType: tileTypeSchema,
      meta: z.record(z.unknown()).optional(),
    }),
  ),
});

export const snapshotSchema = z.object({ label: z.string() });

export const rollbackSchema = z.object({ confirm: z.boolean() });

export const createKeySchema = z.object({
  name: z.string(),
  scopes: z.array(z.enum(['read', 'write', 'delete', 'admin'])).min(1),
});

export function parseBody<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const message = result.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; ');
    throw new AppError(400, 'VALIDATION', message);
  }
  return result.data;
}
