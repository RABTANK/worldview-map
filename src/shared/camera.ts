import type { Point } from './geom.js';

export type Camera = { x: number; y: number; zoom: number };

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

/**
 * 世界坐标 y 向下增大。zoom 是「每世界单位对应的 CSS 像素」。
 * 屏幕中心对应相机 (x, y)。
 */
export function screenToWorld(camera: Camera, width: number, height: number, sx: number, sy: number): Point {
  const clipX = (sx / width) * 2 - 1;
  const clipY = (sy / height) * 2 - 1;
  return {
    x: camera.x + (clipX * width) / (2 * camera.zoom),
    y: camera.y + (clipY * height) / (2 * camera.zoom),
  };
}

export function worldToScreen(camera: Camera, width: number, height: number, wx: number, wy: number): Point {
  const clipX = ((wx - camera.x) * 2 * camera.zoom) / width;
  const clipY = ((wy - camera.y) * 2 * camera.zoom) / height;
  return {
    x: ((clipX + 1) * width) / 2,
    y: ((clipY + 1) * height) / 2,
  };
}

export function fitCamera(bounds: Bounds, width: number, height: number, padding = 48): Camera {
  const worldWidth = Math.max(bounds.maxX - bounds.minX, 1);
  const worldHeight = Math.max(bounds.maxY - bounds.minY, 1);
  const availW = Math.max(width - padding * 2, 1);
  const availH = Math.max(height - padding * 2, 1);
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    zoom: Math.min(availW / worldWidth, availH / worldHeight),
  };
}

/** 列主序 3x3，供 WebGL mat3 使用。 */
export function worldToClipMatrix(camera: Camera, width: number, height: number): Float32Array {
  const sx = (2 * camera.zoom) / width;
  const sy = (2 * camera.zoom) / height;
  const tx = -camera.x * sx;
  const ty = -camera.y * sy;
  return new Float32Array([
    sx, 0, 0,
    0, sy, 0,
    tx, ty, 1,
  ]);
}
