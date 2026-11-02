import earcut from 'earcut';
import { worldToClipMatrix, type Camera } from '../../src/shared/camera.js';
import { hexToRgba } from '../../src/shared/color.js';
import type { Point } from '../../src/shared/geom.js';

export type DrawPolygon = { points: Point[]; fill: string; stroke: string; strokeWidth?: number };
export type DrawPlace = { x: number; y: number; fill: string };
export type DrawTile = { x: number; y: number; color: string };
export type DrawRoute = { points: Point[]; color: string; width: number };

const VERT = `#version 300 es
layout(location=0) in vec2 a_pos;
layout(location=1) in vec4 a_color;
uniform mat3 u_matrix;
out vec4 v_color;
void main() {
  vec3 p = u_matrix * vec3(a_pos, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
  v_color = a_color;
}`;

const FRAG = `#version 300 es
precision mediump float;
in vec4 v_color;
out vec4 outColor;
void main() { outColor = v_color; }`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('无法创建 shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? '';
    gl.deleteShader(shader);
    throw new Error(log);
  }
  return shader;
}

export class MapGl {
  readonly gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private buffer: WebGLBuffer;
  private matrixLoc: WebGLUniformLocation;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) throw new Error('需要 WebGL2');
    this.gl = gl;
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const program = gl.createProgram();
    if (!program) throw new Error('无法创建 program');
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'link 失败');
    this.program = program;
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error('无法创建 buffer');
    this.buffer = buffer;
    const matrix = gl.getUniformLocation(program, 'u_matrix');
    if (!matrix) throw new Error('缺少 u_matrix');
    this.matrixLoc = matrix;
  }

  draw(options: {
    camera: Camera;
    width: number;
    height: number;
    polygons: DrawPolygon[];
    routes: DrawRoute[];
    places: DrawPlace[];
    tiles: DrawTile[];
    grid: { minX: number; minY: number; maxX: number; maxY: number; step: number } | null;
  }): void {
    const { gl } = this;
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clearColor(0.07, 0.06, 0.05, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.matrixLoc, false, worldToClipMatrix(options.camera, options.width, options.height));
    const triangles: number[] = [];
    const lines: number[] = [];
    const push = (target: number[], x: number, y: number, color: [number, number, number, number]) => {
      target.push(x, y, color[0], color[1], color[2], color[3]);
    };
    const pushStrokeSegment = (target: number[], a: Point, b: Point, halfWidth: number, color: [number, number, number, number]) => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.hypot(dx, dy);
      if (length < 0.001) return;
      const nx = (-dy / length) * halfWidth;
      const ny = (dx / length) * halfWidth;
      const a1 = { x: a.x + nx, y: a.y + ny };
      const a2 = { x: a.x - nx, y: a.y - ny };
      const b1 = { x: b.x + nx, y: b.y + ny };
      const b2 = { x: b.x - nx, y: b.y - ny };
      for (const point of [a1, b1, b2, a1, b2, a2]) push(target, point.x, point.y, color);
    };
    const pushRoundJoin = (target: number[], point: Point, radius: number, color: [number, number, number, number]) => {
      const segments = 8;
      for (let i = 0; i < segments; i += 1) {
        const first = (i / segments) * Math.PI * 2;
        const second = ((i + 1) / segments) * Math.PI * 2;
        push(target, point.x, point.y, color);
        push(target, point.x + Math.cos(first) * radius, point.y + Math.sin(first) * radius, color);
        push(target, point.x + Math.cos(second) * radius, point.y + Math.sin(second) * radius, color);
      }
    };
    if (options.grid) {
      const gridColor: [number, number, number, number] = [0.35, 0.3, 0.24, 0.35];
      const { minX, minY, maxX, maxY, step } = options.grid;
      const startX = Math.floor(minX / step) * step;
      const startY = Math.floor(minY / step) * step;
      let count = 0;
      for (let x = startX; x <= maxX && count < 80; x += step, count += 1) {
        push(lines, x, minY, gridColor);
        push(lines, x, maxY, gridColor);
      }
      for (let y = startY; y <= maxY && count < 160; y += step, count += 1) {
        push(lines, minX, y, gridColor);
        push(lines, maxX, y, gridColor);
      }
    }
    for (const tile of options.tiles) {
      const color = hexToRgba(tile.color, 1);
      const x = tile.x;
      const y = tile.y;
      push(triangles, x, y, color);
      push(triangles, x + 1, y, color);
      push(triangles, x + 1, y + 1, color);
      push(triangles, x, y, color);
      push(triangles, x + 1, y + 1, color);
      push(triangles, x, y + 1, color);
    }
    for (const polygon of options.polygons) {
      const fill = hexToRgba(polygon.fill, 0.88);
      const stroke = hexToRgba(polygon.stroke, 1);
      const flat = polygon.points.flatMap((point) => [point.x, point.y]);
      const indices = earcut(flat);
      for (const index of indices) {
        const point = polygon.points[index];
        push(triangles, point.x, point.y, fill);
      }
      for (let i = 0; i < polygon.points.length; i += 1) {
        const a = polygon.points[i];
        const b = polygon.points[(i + 1) % polygon.points.length];
        pushStrokeSegment(triangles, a, b, (polygon.strokeWidth ?? 2) / Math.max(options.camera.zoom, 0.001) / 2, stroke);
      }
    }
    for (const route of options.routes) {
      const color = hexToRgba(route.color, 1);
      const halfWidth = Math.max(1, route.width) / 2;
      for (let i = 0; i < route.points.length - 1; i += 1) {
        pushStrokeSegment(triangles, route.points[i], route.points[i + 1], halfWidth, color);
      }
      for (const point of route.points) pushRoundJoin(triangles, point, halfWidth, color);
    }
    for (const place of options.places) {
      const color = hexToRgba(place.fill, 1);
      const r = 7 / Math.max(options.camera.zoom, 0.001);
      const { x, y } = place;
      push(triangles, x, y - r, color);
      push(triangles, x + r, y, color);
      push(triangles, x, y + r, color);
      push(triangles, x, y - r, color);
      push(triangles, x, y + r, color);
      push(triangles, x - r, y, color);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 24, 0);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 24, 8);
    if (triangles.length) {
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(triangles), gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, triangles.length / 6);
    }
    if (lines.length) {
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lines), gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.LINES, 0, lines.length / 6);
    }
  }
}
