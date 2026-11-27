// Arena events: the orb, and sudden death (shrinking zone + rifts that erupt like geysers).

import { arena, rules } from "@smash/content";
import { hurt, slow } from "./combat.ts";
import type { Ctx } from "./context.ts";
import { polylineDistance } from "./geometry.ts";
import { TAU, type Vec2 } from "./math.ts";
import type { MatchState, Rift } from "./state.ts";

const DEG = Math.PI / 180;
/** How far inside the current zone edge a rift may start (fraction of the zone radius). */
const RIFT_START_MIN = 0.55;
const RIFT_AIM_SPREAD = 0.6;

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

/** A crack from near the zone edge toward the middle, and its point-mirrored twin. */
function spawnRiftPair(ctx: Ctx): void {
  const { state, rng } = ctx;
  const cfg = arena.suddenDeath.rifts;
  const R = state.suddenDeath.zoneRadius;
  const theta = rng.range(0, TAU);
  const startR = rng.range(R * RIFT_START_MIN, R - 0.5);
  const points: Vec2[] = [{ x: Math.sin(theta) * startR, z: Math.cos(theta) * startR }];
  // Head roughly toward the centre, then wander.
  let heading = theta + Math.PI + rng.range(-RIFT_AIM_SPREAD, RIFT_AIM_SPREAD);
  const segLen = rng.range(cfg.length.min, cfg.length.max) / cfg.segments;
  const limit = arena.radius - 1;
  for (let i = 0; i < cfg.segments; i++) {
    const prev = points[points.length - 1]!;
    heading += rng.range(-cfg.jitterDeg, cfg.jitterDeg) * DEG;
    let x = prev.x + Math.sin(heading) * segLen;
    let z = prev.z + Math.cos(heading) * segLen;
    const d = Math.hypot(x, z);
    if (d > limit) {
      x *= limit / d;
      z *= limit / d;
    }
    points.push({ x, z });
  }
  for (const pts of [points, points.map((p) => ({ x: -p.x, z: -p.z }))]) {
    const rift: Rift = { id: state.nextId++, points: pts, phase: "warn", time: cfg.openWarn, total: cfg.openWarn, age: 0 };
    state.rifts.push(rift);
    ctx.events.push({ t: "riftOpen", id: rift.id });
  }
}

function updateRifts(ctx: Ctx): void {
  const { state, dt } = ctx;
  const cfg = arena.suddenDeath.rifts;
  const sd = state.suddenDeath;
  if (sd.pairsSpawned < cfg.maxPairs && state.roundTime >= sd.nextRiftAt) {
    spawnRiftPair(ctx);
    sd.pairsSpawned++;
    sd.nextRiftAt = state.roundTime + cfg.interval;
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
      r.phase = "dormant";
      r.time = r.total = cfg.cycle.dormant;
    } else {
      r.phase = "warn";
      r.time = r.total = cfg.cycle.warn;
      ctx.events.push({ t: "riftWarn", id: r.id });
    }
  }
  const erupting = state.rifts.filter((r) => r.phase === "erupt");
  for (const u of state.units) {
    if (u.dead) continue;
    const airborne = u.kind === "champion" && !!u.leap;
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
