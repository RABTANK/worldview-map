import { describe, expect, it } from 'vitest';
import { fitCamera, screenToWorld, worldToScreen } from '../src/shared/camera.js';
import { pointInPolygon, translatePolygon } from '../src/shared/geom.js';
import { square } from './helpers.js';

describe('geometry and camera', () => {
  it('hits the inside of a polygon and misses the outside', () => {
    const polygon = square(0, 0, 10).points;
    expect(pointInPolygon({ x: 5, y: 5 }, polygon)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, polygon)).toBe(false);
  });

  it('round-trips the screen center through the fitted camera', () => {
    const camera = fitCamera({ minX: 0, minY: 0, maxX: 100, maxY: 50 }, 800, 600, 40);
    const center = screenToWorld(camera, 800, 600, 400, 300);
    expect(center.x).toBeCloseTo(50);
    expect(center.y).toBeCloseTo(25);
    const screen = worldToScreen(camera, 800, 600, 50, 25);
    expect(screen.x).toBeCloseTo(400);
    expect(screen.y).toBeCloseTo(300);
  });

  it('translates every vertex', () => {
    const moved = translatePolygon(square(), 3, -2);
    expect(moved.points[0]).toEqual({ x: 3, y: -2 });
  });
});
