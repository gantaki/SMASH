// Per-tick champion update: timers, movement, casting, channelling, collisions.

import { ABILITY_SLOTS, arena, getChampion, rules } from "@smash/content";
import { abilityOf, fire } from "./abilities.ts";
import { applyOnHit, damageObstaclesInArea, hittables, hurt, moveForced, pushCrates, slowFactor, targetPos } from "./combat.ts";
import type { Ctx } from "./context.ts";
import { obstaclePenetration } from "./geometry.ts";
import { angleDiff } from "./math.ts";
import { unitById, type ChampionUnit, type Unit } from "./state.ts";

const dec = (v: number, dt: number): number => (v > dt ? v - dt : 0);

function speedMultiplier(u: ChampionUnit): number {
  let m = 1;
  if (u.cast) m *= abilityOf(u, u.cast.slot)?.castMoveMultiplier ?? 1;
  m *= slowFactor(u);
  if (u.counter > 0 && u.counterSlot) {
    const a = abilityOf(u, u.counterSlot);
    if (a?.kind === "counter") m *= a.moveMultiplier;
  }
  if (u.channel) {
    const a = abilityOf(u, u.channel.slot);
    if (a?.kind === "channel") m *= a.moveMultiplier;
  }
  return m;
}

/** Moves the movement velocity toward the desired one. Near-instant by design: see rules.movement. */
function walk(ctx: Ctx, u: ChampionUnit): void {
  const { tuning } = ctx.state;
  const top = getChampion(u.champion).stats.moveSpeed * tuning.moveSpeed;
  const speed = top * speedMultiplier(u);
  const tx = u.move.x * speed;
  const tz = u.move.z * speed;
  const dx = tx - u.mvx;
  const dz = tz - u.mvz;
  const delta = Math.hypot(dx, dz);
  const stopping = tx === 0 && tz === 0;
  const time = stopping ? tuning.decelTime : tuning.accelTime;
  // A full reversal is twice the distance in velocity space but should not take twice as long.
  const reversing = tx * u.mvx + tz * u.mvz < 0;
  const maxDelta = time > 0 ? ((reversing ? 2 : 1) * top * ctx.dt) / time : Infinity;
  if (delta <= maxDelta) {
    u.mvx = tx;
    u.mvz = tz;
  } else {
    u.mvx += (dx / delta) * maxDelta;
    u.mvz += (dz / delta) * maxDelta;
  }
  u.x += u.mvx * ctx.dt;
  u.z += u.mvz * ctx.dt;
}

function land(ctx: Ctx, u: ChampionUnit, slot: NonNullable<ChampionUnit["leap"]>["slot"]): void {
  const a = abilityOf(u, slot);
  if (a?.kind !== "leap") return;
  const { radius, onHit, cratePush } = a.landing;
  for (const t of hittables(ctx, u.team)) {
    const pos = targetPos(ctx, t);
    if (Math.hypot(pos.x - u.x, pos.z - u.z) < radius + pos.radius * rules.areaBodyFactor) applyOnHit(ctx, t, onHit, u, u.x, u.z);
  }
  damageObstaclesInArea(ctx, u.x, u.z, radius, onHit.damage);
  if (cratePush) pushCrates(ctx, u.x, u.z, radius, cratePush, u);
  ctx.events.push({ t: "leapLand", unit: u.id, x: u.x, z: u.z, radius, abilityId: a.id });
}

export function updateChampion(ctx: Ctx, u: ChampionUnit): void {
  const { state, dt } = ctx;
  for (const s of ABILITY_SLOTS) u.cooldowns[s] = dec(u.cooldowns[s], dt);
  u.stun = dec(u.stun, dt);
  u.slow = dec(u.slow, dt);
  u.root = dec(u.root, dt);
  u.empowered = dec(u.empowered, dt);
  u.recovery = dec(u.recovery, dt);
  u.cancelLock = dec(u.cancelLock, dt);
  u.counter = dec(u.counter, dt);
  if (u.counter <= 0) u.counterSlot = null;
  if (u.shieldTime > 0) {
    u.shieldTime = dec(u.shieldTime, dt);
    if (u.shieldTime <= 0) u.shield = 0;
  }
  if (u.dead) {
    u.deadTime += dt;
    u.mvx = u.mvz = 0;
    return;
  }
  const fight = state.phase === "fight";
  if (fight) {
    u.energy = Math.min(rules.energy.max, u.energy + rules.energy.passivePerSecond * dt);
    if (u.burn > 0) {
      u.burn = dec(u.burn, dt);
      u.burnTick -= dt;
      if (u.burnTick <= 0) {
        u.burnTick += rules.burn.tickInterval;
        hurt(ctx, u, u.burnDps * rules.burn.tickInterval, unitById(state, u.burnSource) ?? null, { dot: true });
      }
    }
    if (u.dead) return;
  }

  if (u.forced) {
    u.mvx = u.mvz = 0;
    moveForced(ctx, u);
    if (u.dead) return;
  } else if (u.leap) {
    const L = u.leap;
    L.t += dt;
    const k = Math.min(1, L.t / L.duration);
    u.x = L.x0 + (L.x1 - L.x0) * k;
    u.z = L.z0 + (L.z1 - L.z0) * k;
    if (k >= 1) {
      u.leap = null;
      land(ctx, u, L.slot);
    }
  } else if (u.stun <= 0 && u.root <= 0 && fight) {
    walk(ctx, u);
  } else {
    u.mvx = u.mvz = 0;
  }

  if (u.cast) {
    u.cast.time -= dt;
    if (u.cast.time <= 0) {
      const slot = u.cast.slot;
      u.cast = null;
      fire(ctx, u, slot);
    }
  }

  if (u.channel) {
    const c = u.channel;
    const a = abilityOf(u, c.slot);
    if (a?.kind !== "channel") u.channel = null;
    else {
      c.time -= dt;
      c.tick -= dt;
      if (c.tick <= 0) {
        c.tick += a.tickInterval;
        for (const t of hittables(ctx, u.team)) {
          const pos = targetPos(ctx, t);
          if (Math.hypot(pos.x - u.x, pos.z - u.z) < a.radius + pos.radius * rules.areaBodyFactor) applyOnHit(ctx, t, a.onTick, u, u.x, u.z);
        }
        damageObstaclesInArea(ctx, u.x, u.z, a.radius, a.onTick.damage);
        ctx.events.push({ t: "channelTick", unit: u.id, x: u.x, z: u.z, radius: a.radius, abilityId: a.id });
      }
      if (c.time <= 0) {
        u.channel = null;
        ctx.events.push({ t: "channelEnd", unit: u.id });
      }
    }
  }

  if (u.stun <= 0) {
    const ax = u.aim.x - u.x;
    const az = u.aim.z - u.z;
    if (Math.hypot(ax, az) > 0.05) {
      const rate = u.cast ? rules.movement.castTurnRate : rules.movement.turnRate;
      u.face += angleDiff(Math.atan2(ax, az), u.face) * Math.min(1, dt * rate);
    }
  }
}

/** Pushes a unit out of obstacles, the orb and the arena wall. */
export function pushOut(ctx: Ctx, t: Unit): void {
  const { state } = ctx;
  for (const o of state.obstacles) {
    const pen = obstaclePenetration(o, t.x, t.z, t.radius);
    if (pen) {
      t.x += pen.nx * pen.depth;
      t.z += pen.nz * pen.depth;
    }
  }
  const orb = state.orb;
  if (orb.alive) {
    const dx = t.x - orb.x;
    const dz = t.z - orb.z;
    const d = Math.hypot(dx, dz);
    const m = orb.radius + t.radius;
    if (d < m) {
      t.x = orb.x + (d > 1e-4 ? dx / d : 1) * m;
      t.z = orb.z + (d > 1e-4 ? dz / d : 0) * m;
    }
  }
  const d = Math.hypot(t.x, t.z);
  const R = arena.radius - arena.wallMargin;
  if (d > R) {
    t.x *= R / d;
    t.z *= R / d;
  }
}

/** Champions push each other apart and everybody is kept out of solid things. Airborne champions are skipped. */
export function collide(ctx: Ctx): void {
  const list = ctx.state.units.filter((u): u is ChampionUnit => u.kind === "champion" && !u.dead && !u.leap);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!;
      const b = list[j]!;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      const m = a.radius + b.radius;
      if (d < m && d > 1e-4) {
        const o = (m - d) / 2;
        a.x -= (dx / d) * o;
        a.z -= (dz / d) * o;
        b.x += (dx / d) * o;
        b.z += (dz / d) * o;
      }
    }
  }
  for (const u of list) pushOut(ctx, u);
}
