// Arena events: the orb, and sudden death (shrinking zone + rifts that erupt like geysers).

import { arena, rules } from "@smash/content";
import { hurt, slow } from "./combat.ts";
import type { Ctx } from "./context.ts";
import { polylineDistance } from "./geometry.ts";
import { TAU, type Vec2 } from "./math.ts";
import { offGround, type MatchState, type Rift } from "./state.ts";

const DEG = Math.PI / 180;
// Generation limits (not balance): how hard to look for a valid crack before waiting, and how finely to measure gaps.
const RIFT_ATTEMPTS = 24;
const RIFT_RETRY = 1;
const RIFT_GAP_SAMPLES = 4;
/** A rift is at most this many zone radii long. */
const RIFT_LENGTH_PER_ZONE = 1.2;

export function updateOrb(ctx: Ctx): void {
  const { state } = ctx;
  const orb = state.orb;
  if (!orb.alive && state.roundTime >= orb.nextAt) {
    orb.alive = true;
    orb.hp = orb.maxHp;
    orb.lastHitter = -1;
    ctx.events.push({ t: "orbSpawn" });
  }
}

export function startSuddenDeath(ctx: Ctx): void {
  const sd = ctx.state.suddenDeath;
  if (sd.active) return;
  sd.active = true;
  sd.startedAt = ctx.state.roundTime;
  sd.zoneRadius = arena.radius;
  sd.pairsSpawned = 0;
  sd.nextRiftAt = sd.startedAt + arena.suddenDeath.rifts.firstAfter;
  ctx.events.push({ t: "suddenDeath" });
}

export function stopSuddenDeath(state: MatchState): void {
  state.suddenDeath = { active: false, startedAt: 0, zoneRadius: arena.radius, pairsSpawned: 0, nextRiftAt: 0 };
  state.rifts = [];
}

/** Smallest distance between two polylines, measured at their vertices and at points along their segments. */
function polylineGap(a: readonly Vec2[], b: readonly Vec2[]): number {
  let best = Infinity;
  const scan = (from: readonly Vec2[], to: readonly Vec2[]) => {
    for (let i = 0; i + 1 < from.length; i++) {
      const p = from[i]!;
      const q = from[i + 1]!;
      for (let k = 0; k <= RIFT_GAP_SAMPLES; k++) {
        const t = k / RIFT_GAP_SAMPLES;
        best = Math.min(best, polylineDistance(to, p.x + (q.x - p.x) * t, p.z + (q.z - p.z) * t));
      }
    }
  };
  scan(a, b);
  scan(b, a);
  return best;
}

const mirror = (points: readonly Vec2[]): Vec2[] => points.map((p) => ({ x: -p.x, z: -p.z }));

/**
 * One attempt at a crack: it starts near the zone edge and heads toward the centre, turned aside so that it cuts
 * across the arena beside the middle. Returns null if it would cross the safe centre or crowd an open rift.
 */
function riftCandidate(ctx: Ctx, leaving: number): Vec2[] | null {
  const { state, rng } = ctx;
  const cfg = arena.suddenDeath.rifts;
  const R = state.suddenDeath.zoneRadius;
  const theta = rng.range(0, TAU);
  const startR = rng.range(Math.max(cfg.centerClear + 1, R * cfg.startRadiusMin), R - 0.5);
  const side = rng.next() < 0.5 ? -1 : 1;
  let heading = theta + Math.PI + side * rng.range(cfg.headingOffsetDeg.min, cfg.headingOffsetDeg.max) * DEG;
  const segLen = Math.min(rng.range(cfg.length.min, cfg.length.max), R * RIFT_LENGTH_PER_ZONE) / cfg.segments;
  const jitter = () => rng.range(-cfg.jitterDeg, cfg.jitterDeg) * DEG;
  const points: Vec2[] = [{ x: Math.sin(theta) * startR, z: Math.cos(theta) * startR }];
  const limit = arena.radius - 1;
  for (let i = 0; i < cfg.segments; i++) {
    const prev = points[points.length - 1]!;
    heading += jitter();
    const x = prev.x + Math.sin(heading) * segLen;
    const z = prev.z + Math.cos(heading) * segLen;
    if (Math.hypot(x, z) > limit) break;
    points.push({ x, z });
  }
  if (points.length < 3) return null;
  if (polylineDistance(points, 0, 0) < cfg.centerClear) return null;
  // Rifts that are sealing (or about to, to make room for this one) do not count.
  const others = state.rifts.filter((r) => !r.closing && r.phase !== "closing" && r.pair !== leaving).map((r) => r.points);
  others.push(mirror(points));
  return others.every((o) => polylineGap(points, o) >= cfg.minSeparation) ? points : null;
}

/** Opens a crack and its point-mirrored twin; the oldest pair starts closing if too many are open. */
function spawnRiftPair(ctx: Ctx): boolean {
  const { state } = ctx;
  const cfg = arena.suddenDeath.rifts;
  const open = [...new Set(state.rifts.filter((r) => !r.closing && r.phase !== "closing").map((r) => r.pair))];
  const oldest = open.length >= cfg.maxActivePairs ? Math.min(...open) : -1;
  let points: Vec2[] | null = null;
  for (let i = 0; i < RIFT_ATTEMPTS && !points; i++) points = riftCandidate(ctx, oldest);
  if (!points) return false;

  if (oldest >= 0) {
    for (const r of state.rifts) {
      if (r.pair !== oldest) continue;
      r.closing = true;
      // A quiet rift seals right away; an active one finishes its eruption first.
      if (r.phase === "dormant") {
        r.phase = "closing";
        r.time = r.total = cfg.closeTime;
      }
    }
  }
  const pair = state.suddenDeath.pairsSpawned;
  for (const pts of [points, mirror(points)]) {
    const rift: Rift = { id: state.nextId++, pair, closing: false, points: pts, phase: "warn", time: cfg.openWarn, total: cfg.openWarn, age: 0 };
    state.rifts.push(rift);
    ctx.events.push({ t: "riftOpen", id: rift.id });
  }
  return true;
}

function updateRifts(ctx: Ctx): void {
  const { state, dt } = ctx;
  const cfg = arena.suddenDeath.rifts;
  const sd = state.suddenDeath;
  if (state.roundTime >= sd.nextRiftAt) {
    if (spawnRiftPair(ctx)) {
      sd.pairsSpawned++;
      sd.nextRiftAt = state.roundTime + cfg.interval;
    } else sd.nextRiftAt = state.roundTime + RIFT_RETRY;
  }
  for (const r of state.rifts) {
    r.age += dt;
    r.time -= dt;
    if (r.time > 0) continue;
    if (r.phase === "warn") {
      r.phase = "erupt";
      r.time = r.total = cfg.cycle.erupt;
      ctx.events.push({ t: "riftErupt", id: r.id });
    } else if (r.phase === "erupt") {
      r.phase = r.closing ? "closing" : "dormant";
      r.time = r.total = r.closing ? cfg.closeTime : cfg.cycle.dormant;
    } else if (r.phase === "dormant") {
      r.phase = "warn";
      r.time = r.total = cfg.cycle.warn;
      ctx.events.push({ t: "riftWarn", id: r.id });
    }
  }
  state.rifts = state.rifts.filter((r) => !(r.phase === "closing" && r.time <= 0));
  const erupting = state.rifts.filter((r) => r.phase === "erupt");
  for (const u of state.units) {
    if (u.dead) continue;
    const airborne = offGround(u);
    const over = !airborne && erupting.some((r) => polylineDistance(r.points, u.x, u.z) < cfg.halfWidth + u.radius * rules.areaBodyFactor);
    if (!over) {
      // Reset, so stepping onto an erupting rift hurts immediately.
      u.riftTick = 0;
      continue;
    }
    u.riftTick -= dt;
    if (u.riftTick > 0) continue;
    u.riftTick = cfg.tickInterval;
    if (hurt(ctx, u, cfg.damage, null, { dot: true }) && cfg.slow) slow(ctx, u, cfg.slow.amount, cfg.slow.duration);
  }
}

export function updateSuddenDeath(ctx: Ctx): void {
  const { state, dt } = ctx;
  const cfg = arena.suddenDeath;
  const sd = state.suddenDeath;
  if (!sd.active) {
    if (state.config.mode === "training" || state.roundTime < cfg.startAt) return;
    startSuddenDeath(ctx);
  }
  sd.zoneRadius = Math.max(cfg.zone.minRadius, arena.radius - (state.roundTime - sd.startedAt) * cfg.zone.shrinkSpeed);
  for (const u of state.units) {
    if (u.kind !== "champion" || u.dead) continue;
    if (Math.hypot(u.x, u.z) <= sd.zoneRadius) {
      u.zoneTick = 0;
      continue;
    }
    u.zoneTick -= dt;
    if (u.zoneTick <= 0) {
      u.zoneTick = cfg.zone.tickInterval;
      hurt(ctx, u, cfg.zone.damage, null, { dot: true });
    }
  }
  updateRifts(ctx);
}

/** Is the point over a rift that is erupting or about to (within `lookahead` seconds)? */
export function riftDanger(state: MatchState, x: number, z: number, pad: number, lookahead: number): Rift | null {
  const cfg = arena.suddenDeath.rifts;
  for (const r of state.rifts) {
    const hot = r.phase === "erupt" || (r.phase === "warn" && r.time < lookahead);
    if (hot && polylineDistance(r.points, x, z) < cfg.halfWidth + pad) return r;
  }
  return null;
}
