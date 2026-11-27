// Collision queries against obstacles, the orb and the arena wall.

import { arena } from "@smash/content";
import { clamp, type Vec2 } from "./math.ts";
import type { MatchState, Obstacle } from "./state.ts";

export interface Penetration {
  /** Push-out normal. */
  nx: number;
  nz: number;
  depth: number;
}

const EPS = 1e-4;

/** Overlap of a circle with an obstacle, or null. */
export function obstaclePenetration(o: Obstacle, x: number, z: number, r: number): Penetration | null {
  if (!o.alive) return null;
  if (o.shape === "circle") {
    const dx = x - o.x;
    const dz = z - o.z;
    const d = Math.hypot(dx, dz);
    const m = o.radius + r;
    if (d >= m) return null;
    return d > EPS ? { nx: dx / d, nz: dz / d, depth: m - d } : { nx: 1, nz: 0, depth: m };
  }
  const co = Math.cos(o.rot);
  const si = Math.sin(o.rot);
  const dx = x - o.x;
  const dz = z - o.z;
  const lx = dx * co + dz * si;
  const lz = -dx * si + dz * co;
  const ex = lx - clamp(lx, -o.halfWidth, o.halfWidth);
  const ez = lz - clamp(lz, -o.halfDepth, o.halfDepth);
  const d = Math.hypot(ex, ez);
  if (d >= r) return null;
  let nlx: number;
  let nlz: number;
  let depth: number;
  if (d > EPS) {
    nlx = ex / d;
    nlz = ez / d;
    depth = r - d;
  } else {
    const px = o.halfWidth - Math.abs(lx);
    const pz = o.halfDepth - Math.abs(lz);
    if (px < pz) {
      nlx = Math.sign(lx) || 1;
      nlz = 0;
      depth = px + r;
    } else {
      nlx = 0;
      nlz = Math.sign(lz) || 1;
      depth = pz + r;
    }
  }
  return { nx: nlx * co - nlz * si, nz: nlx * si + nlz * co, depth };
}

/** Distance from a point to the obstacle's surface (0 inside). */
export function obstacleDistance(o: Obstacle, x: number, z: number): number {
  if (o.shape === "circle") return Math.max(0, Math.hypot(x - o.x, z - o.z) - o.radius);
  const co = Math.cos(o.rot);
  const si = Math.sin(o.rot);
  const dx = x - o.x;
  const dz = z - o.z;
  const lx = dx * co + dz * si;
  const lz = -dx * si + dz * co;
  return Math.hypot(lx - clamp(lx, -o.halfWidth, o.halfWidth), lz - clamp(lz, -o.halfDepth, o.halfDepth));
}

const pointSegmentDistance = (px: number, pz: number, ax: number, az: number, bx: number, bz: number): number => {
  const vx = bx - ax;
  const vz = bz - az;
  const l2 = vx * vx + vz * vz;
  const t = l2 > 0 ? clamp(((px - ax) * vx + (pz - az) * vz) / l2, 0, 1) : 0;
  return Math.hypot(px - ax - vx * t, pz - az - vz * t);
};

export function segmentHitsObstacle(o: Obstacle, a: Vec2, b: Vec2, pad: number): boolean {
  if (o.shape === "circle") return pointSegmentDistance(o.x, o.z, a.x, a.z, b.x, b.z) < o.radius + pad;
  const co = Math.cos(o.rot);
  const si = Math.sin(o.rot);
  const x0 = (a.x - o.x) * co + (a.z - o.z) * si;
  const z0 = -(a.x - o.x) * si + (a.z - o.z) * co;
  const x1 = (b.x - o.x) * co + (b.z - o.z) * si;
  const z1 = -(b.x - o.x) * si + (b.z - o.z) * co;
  let t0 = 0;
  let t1 = 1;
  const axes: [number, number, number][] = [
    [x0, x1 - x0, o.halfWidth + pad],
    [z0, z1 - z0, o.halfDepth + pad],
  ];
  for (const [p0, d, h] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (p0 < -h || p0 > h) return false;
    } else {
      let ta = (-h - p0) / d;
      let tb = (h - p0) / d;
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) return false;
    }
  }
  return true;
}

/** First live obstacle on the segment a→b (nearest to a), or null. */
export function blocker(state: MatchState, a: Vec2, b: Vec2, pad = 0.35): Obstacle | null {
  let best: Obstacle | null = null;
  let bestD = Infinity;
  for (const o of state.obstacles) {
    if (!o.alive || !segmentHitsObstacle(o, a, b, pad)) continue;
    const d = Math.hypot(o.x - a.x, o.z - a.z);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

export const clearLine = (state: MatchState, a: Vec2, b: Vec2): boolean => !blocker(state, a, b);

/** Clamps an aim point to `max` meters from `from` and keeps it inside the arena. */
export function reach(from: Vec2, aim: Vec2, max: number): Vec2 {
  let dx = aim.x - from.x;
  let dz = aim.z - from.z;
  const d = Math.hypot(dx, dz);
  if (d > max) {
    dx *= max / d;
    dz *= max / d;
  }
  let x = from.x + dx;
  let z = from.z + dz;
  const c = Math.hypot(x, z);
  const R = arena.radius - 1;
  if (c > R) {
    x *= R / c;
    z *= R / c;
  }
  return { x, z };
}

/** Distance from a point to a polyline. */
export function polylineDistance(points: readonly Vec2[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    best = Math.min(best, pointSegmentDistance(x, z, a.x, a.z, b.x, b.z));
  }
  return best;
}

/** True if a target knocked away from `from` by `dist` would hit an obstacle or the arena wall. */
export function wallBehind(state: MatchState, from: Vec2, target: Vec2, dist: number): boolean {
  const dx = target.x - from.x;
  const dz = target.z - from.z;
  const d = Math.hypot(dx, dz) || 1;
  const px = target.x + (dx / d) * dist;
  const pz = target.z + (dz / d) * dist;
  if (Math.hypot(px, pz) > arena.radius - 1.2) return true;
  return state.obstacles.some((o) => o.alive && obstacleDistance(o, px, pz) < 0.8);
}
