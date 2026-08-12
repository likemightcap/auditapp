import type { CameraState, Point } from "../types";

export const GRID_SIZE_FT = 1;
export const MIN_ZOOM = 6;
export const MAX_ZOOM = 60;

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function snapToGrid(value: number, grid = GRID_SIZE_FT): number {
  return Math.round(value / grid) * grid;
}

export function snapPointToGrid(point: Point, grid = GRID_SIZE_FT): Point {
  return { x: snapToGrid(point.x, grid), y: snapToGrid(point.y, grid) };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function worldToScreen(point: Point, camera: CameraState): Point {
  return {
    x: point.x * camera.zoom + camera.x,
    y: point.y * camera.zoom + camera.y,
  };
}

export function screenToWorld(point: Point, camera: CameraState): Point {
  return {
    x: (point.x - camera.x) / camera.zoom,
    y: (point.y - camera.y) / camera.zoom,
  };
}

export function constrainOrthogonal(from: Point, to: Point): Point {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  if (dx >= dy) {
    return { x: to.x, y: from.y };
  }
  return { x: from.x, y: to.y };
}

export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function normalize(vx: number, vy: number): Point {
  const len = Math.hypot(vx, vy) || 1;
  return { x: vx / len, y: vy / len };
}
