export type Point = { x: number; y: number };

export type Polygon = {
  type: 'Polygon';
  points: Point[];
};

export type LineString = {
  type: 'LineString';
  points: Point[];
};

export function isFiniteCoord(value: number): boolean {
  return Number.isFinite(value) && value >= -100_000 && value <= 100_000;
}

export function parsePolygon(input: unknown): Polygon | null {
  if (!input || typeof input !== 'object') return null;
  const record = input as { type?: unknown; points?: unknown };
  if (record.type !== 'Polygon' || !Array.isArray(record.points)) return null;
  if (record.points.length < 3 || record.points.length > 64) return null;
  const points: Point[] = [];
  for (const point of record.points) {
    if (!point || typeof point !== 'object') return null;
    const { x, y } = point as { x?: unknown; y?: unknown };
    if (typeof x !== 'number' || typeof y !== 'number') return null;
    if (!isFiniteCoord(x) || !isFiniteCoord(y)) return null;
    points.push({ x, y });
  }
  return { type: 'Polygon', points };
}

export function parseLineString(input: unknown): LineString | null {
  if (!input || typeof input !== 'object') return null;
  const record = input as { type?: unknown; points?: unknown };
  if (record.type !== 'LineString' || !Array.isArray(record.points)) return null;
  if (record.points.length < 2 || record.points.length > 256) return null;
  const points: Point[] = [];
  for (const point of record.points) {
    if (!point || typeof point !== 'object') return null;
    const { x, y } = point as { x?: unknown; y?: unknown };
    if (typeof x !== 'number' || typeof y !== 'number') return null;
    if (!isFiniteCoord(x) || !isFiniteCoord(y)) return null;
    points.push({ x, y });
  }
  return { type: 'LineString', points };
}

export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const crosses = yi > point.y !== yj > point.y;
    if (!crosses) continue;
    const xCross = ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;
    if (point.x < xCross) inside = !inside;
  }
  return inside;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function polygonBounds(points: Point[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

export function vertexAverage(points: Point[]): Point {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  const n = points.length || 1;
  return { x: x / n, y: y / n };
}

export function translatePolygon(polygon: Polygon, dx: number, dy: number): Polygon {
  return {
    type: 'Polygon',
    points: polygon.points.map((point) => ({ x: point.x + dx, y: point.y + dy })),
  };
}
