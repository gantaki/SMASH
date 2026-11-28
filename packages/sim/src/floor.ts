// The arena floor and the wall around it: where the tiles are, what still stands, and what is solid ground.
// The layout comes from content (arena.floor, arena.rim) and never changes; what is broken lives in the match state.
// Taking damage is in combat.ts, dropping and falling in terrain.ts.

import { arena } from "@smash/content";
import { TAU } from "./math.ts";
import type { MatchState } from "./state.ts";

export interface FloorTile {
  /** 0 = the round slab in the middle, 1.. = rings outward. */
  ring: number;
  /** Inner and outer radius. */
  r0: number;
  r1: number;
  /** Start angle and width, radians. Angles follow the facing convention: 0 = +z, PI/2 = +x. */
  a0: number;
  span: number;
  /** Centre of the tile. */
  x: number;
  z: number;
}

const cfg = arena.floor;
const RING_WIDTH = (arena.radius - cfg.centerRadius) / cfg.rings;
const tilesInRing = (ring: number): number => ring * cfg.tilesPerRing;
/** Odd rings are turned by half a tile, like courses of bricks. */
const ringOffset = (ring: number): number => (ring % 2 ? Math.PI / tilesInRing(ring) : 0);

/** Index of the first tile of each ring. */
const ringStart: number[] = [0, 1];
for (let ring = 1; ring < cfg.rings; ring++) ringStart.push(ringStart[ring]! + tilesInRing(ring));

function buildTiles(): FloorTile[] {
  const tiles: FloorTile[] = [{ ring: 0, r0: 0, r1: cfg.centerRadius, a0: 0, span: TAU, x: 0, z: 0 }];
  for (let ring = 1; ring <= cfg.rings; ring++) {
    const n = tilesInRing(ring);
    const span = TAU / n;
    const r0 = cfg.centerRadius + (ring - 1) * RING_WIDTH;
    const r1 = r0 + RING_WIDTH;
    for (let k = 0; k < n; k++) {
      const a0 = ringOffset(ring) + k * span;
      const mid = a0 + span / 2;
      tiles.push({ ring, r0, r1, a0, span, x: Math.sin(mid) * (r0 + r1) / 2, z: Math.cos(mid) * (r0 + r1) / 2 });
    }
  }
  return tiles;
}

/** Every tile of the floor; a tile's index here is its id in the state and in events. */
export const floorTiles: readonly FloorTile[] = buildTiles();

/** The tile under a point, or -1 beyond the edge of the arena. */
export function tileAt(x: number, z: number): number {
  const d = Math.hypot(x, z);
  if (d > arena.radius) return -1;
  if (d < cfg.centerRadius) return 0;
  const ring = Math.min(cfg.rings, 1 + Math.floor((d - cfg.centerRadius) / RING_WIDTH));
  const n = tilesInRing(ring);
  const k = Math.floor(((Math.atan2(x, z) - ringOffset(ring)) / TAU) * n);
  return ringStart[ring]! + (((k % n) + n) % n);
}

/** A tile that is still there. A broken tile stays solid until it has finished crumbling. */
export const tileSolid = (state: MatchState, tile: number): boolean =>
  tile >= 0 && (state.floor.hp[tile]! > 0 || state.floor.crumbling.some((c) => c.tile === tile));

/** Is there floor under this point? False over a hole and beyond the edge of the arena. */
export const solidAt = (state: MatchState, x: number, z: number): boolean => tileSolid(state, tileAt(x, z));

/** Floor that is not about to drop either: where bots and companions are willing to stand. */
export function safeAt(state: MatchState, x: number, z: number): boolean {
  const tile = tileAt(x, z);
  return tile >= 0 && state.floor.hp[tile]! > 0;
}

/** Seconds until the floor under a point drops: 0 over a hole, Infinity on a tile that is not crumbling. */
export function dropTimeAt(state: MatchState, x: number, z: number): number {
  const tile = tileAt(x, z);
  if (tile < 0) return 0;
  if (state.floor.hp[tile]! > 0) return Infinity;
  return state.floor.crumbling.find((c) => c.tile === tile)?.time ?? 0;
}

/** Sampling step for paths over the floor: well under the size of a tile. */
const PATH_STEP = 0.4;

/** Is there floor all the way from a to b? (Something that slides or walks along the line would not fall.) */
export function pathSolid(state: MatchState, ax: number, az: number, bx: number, bz: number): boolean {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / PATH_STEP));
  for (let i = 0; i <= n; i++) {
    if (!solidAt(state, ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n)) return false;
  }
  return true;
}

/** Centre of the nearest safe tile, or null if the whole floor is gone. With `reachable`, only tiles a straight walk gets to. */
export function nearestSafe(state: MatchState, x: number, z: number, reachable = false): { x: number; z: number } | null {
  let best: FloorTile | null = null;
  let bestD = Infinity;
  for (let i = 0; i < floorTiles.length; i++) {
    if (state.floor.hp[i]! <= 0) continue;
    const t = floorTiles[i]!;
    const d = Math.hypot(t.x - x, t.z - z);
    if (d >= bestD || (reachable && !pathSolid(state, x, z, t.x, t.z))) continue;
    bestD = d;
    best = t;
  }
  return best ? { x: best.x, z: best.z } : null;
}

// ---------- the rim ----------

const RIM_SPAN = TAU / arena.rim.segments;

/**
 * The rim section in the direction of a point. Section i is centred on angle i × span, so the spawn axis (x = 0)
 * runs through the middle of a section, not along a joint between two.
 */
export function rimSegmentAt(x: number, z: number): number {
  const n = arena.rim.segments;
  const k = Math.floor(Math.atan2(x, z) / RIM_SPAN + 0.5);
  return ((k % n) + n) % n;
}

/** Start angle and width of a rim section. */
export const rimArc = (segment: number): { a0: number; span: number } => ({ a0: (segment - 0.5) * RIM_SPAN, span: RIM_SPAN });

/** Does the wall still stand in the direction of this point? */
export const rimStands = (state: MatchState, x: number, z: number): boolean => state.rim[rimSegmentAt(x, z)]! > 0;

/** The point of a rim section nearest to (x, z). */
export function rimPoint(segment: number, x: number, z: number): { x: number; z: number } {
  const mid = segment * RIM_SPAN;
  // Angle of the point relative to the middle of the section, wrapped to (-PI, PI], then clamped onto the arc.
  let rel = (Math.atan2(x, z) - mid) % TAU;
  if (rel > Math.PI) rel -= TAU;
  if (rel <= -Math.PI) rel += TAU;
  const a = mid + Math.max(-RIM_SPAN / 2, Math.min(RIM_SPAN / 2, rel));
  return { x: Math.sin(a) * arena.radius, z: Math.cos(a) * arena.radius };
}

export interface RimPenetration {
  /** Push-out normal (toward the centre). */
  nx: number;
  nz: number;
  depth: number;
  segment: number;
}

/**
 * Overlap with the arena wall of a circle whose centre has to stay `margin` inside it.
 * Null where the wall is not reached, or where its section is gone: that way lies the abyss.
 */
export function rimPenetration(state: MatchState, x: number, z: number, margin: number): RimPenetration | null {
  const d = Math.hypot(x, z);
  const limit = arena.radius - margin;
  if (d <= limit) return null;
  const segment = rimSegmentAt(x, z);
  if (state.rim[segment]! <= 0) return null;
  return { nx: -x / d, nz: -z / d, depth: d - limit, segment };
}

/**
 * Would something shoved `dist` meters from (x, z) along (nx, nz) go into the abyss: over a hole in the floor,
 * or out through a gap in the wall? A standing wall section stops it first.
 */
export function voidAlong(state: MatchState, x: number, z: number, nx: number, nz: number, dist: number): boolean {
  const n = Math.max(1, Math.ceil(dist / PATH_STEP));
  for (let i = 1; i <= n; i++) {
    const px = x + (nx * dist * i) / n;
    const pz = z + (nz * dist * i) / n;
    if (rimPenetration(state, px, pz, arena.wallMargin)) return false;
    if (!solidAt(state, px, pz)) return true;
  }
  return false;
}
