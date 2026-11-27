// Damage, status effects, forced movement and slams. Every hit in the game goes through hurt().

import { arena, getChampion, rules, type OnHit } from "@smash/content";
import type { Ctx } from "./context.ts";
import { obstaclePenetration } from "./geometry.ts";
import { championById, creditOf, unitById, type ChampionUnit, type Obstacle, type Unit } from "./state.ts";

export type Target = Unit | "orb";

export interface HurtOptions {
  /** Damage over time, zone, slams, counter punish: cannot be countered and does not shake the screen. */
  dot?: boolean;
}

const fighting = (ctx: Ctx): boolean => ctx.state.phase === "fight";

/** Units that crowd control can affect right now. */
export const controllable = (u: Unit): boolean => !u.dead && !(u.kind === "champion" && isUnstoppable(u));

export function isUnstoppable(u: ChampionUnit): boolean {
  if (!u.channel) return false;
  const a = getChampion(u.champion).abilities[u.channel.slot];
  return a?.kind === "channel" && a.unstoppable;
}

export function cancelCast(ctx: Ctx, u: Unit): void {
  if (u.kind !== "champion" || !u.cast) return;
  const a = getChampion(u.champion).abilities[u.cast.slot];
  ctx.events.push({ t: "castCancel", unit: u.id, slot: u.cast.slot, abilityId: a?.id ?? "" });
  u.cast = null;
}

function addEnergy(u: ChampionUnit, amount: number): void {
  u.energy = Math.min(rules.energy.max, u.energy + amount);
}

/**
 * Deals damage. Returns false if nothing happened (dead target, round not running, or the hit was countered),
 * in which case on-hit effects must not be applied.
 */
export function hurt(ctx: Ctx, target: Target, damage: number, source: Unit | null, opts: HurtOptions = {}): boolean {
  const { state, events } = ctx;
  if (!fighting(ctx)) return false;
  const credit = creditOf(state, source ?? undefined);
  const creditId = credit?.id ?? -1;
  const dot = !!opts.dot;

  if (target === "orb") {
    const orb = state.orb;
    if (!orb.alive) return false;
    orb.hp -= damage;
    orb.lastHitter = creditId;
    events.push({ t: "damage", target: -1, targetKind: "orb", source: creditId, amount: damage, absorbed: 0, x: orb.x, z: orb.z, dot });
    if (orb.hp <= 0) breakOrb(ctx);
    return true;
  }

  if (target.dead) return false;

  if (target.kind === "companion") {
    target.hp -= damage;
    events.push({ t: "damage", target: target.id, targetKind: "companion", source: creditId, amount: damage, absorbed: 0, x: target.x, z: target.z, dot });
    if (credit && credit.team !== target.team) addEnergy(credit, damage * rules.energy.perCompanionDamage);
    if (target.hp <= 0) {
      target.hp = 0;
      target.dead = true;
      target.respawn = rules.companion.respawn;
      target.forced = null;
      target.target = -1;
      events.push({ t: "companionDeath", unit: target.id, killer: creditId });
      if (credit && credit.team !== target.team) {
        addEnergy(credit, rules.companion.killEnergy);
        events.push({ t: "energy", unit: credit.id, amount: rules.companion.killEnergy });
      }
    }
    return true;
  }

  if (target.counter > 0 && !dot && source && source !== target) {
    counterHit(ctx, target, source);
    return false;
  }

  let absorbed = 0;
  if (target.shield > 0) {
    absorbed = Math.min(target.shield, damage);
    target.shield -= absorbed;
    damage -= absorbed;
    if (target.shield <= 0) target.shieldTime = 0;
  }
  target.hp -= damage;
  target.lastHurtAt = state.roundTime;
  events.push({ t: "damage", target: target.id, targetKind: "champion", source: creditId, amount: damage, absorbed, x: target.x, z: target.z, dot });
  if (credit && credit !== target) addEnergy(credit, damage * rules.energy.perDamage);
  if (target.hp <= 0) {
    target.hp = 0;
    die(ctx, target);
  }
  return true;
}

function counterHit(ctx: Ctx, t: ChampionUnit, source: Unit): void {
  const a = t.counterSlot ? getChampion(t.champion).abilities[t.counterSlot] : undefined;
  t.counter = 0;
  t.counterSlot = null;
  ctx.events.push({ t: "counter", unit: t.id, attacker: source.id });
  if (a?.kind !== "counter") return;
  t.empowered = a.empowerDuration;
  ctx.events.push({ t: "status", unit: t.id, status: "empowered", duration: a.empowerDuration });
  if (!source.dead && Math.hypot(source.x - t.x, source.z - t.z) < a.punishRange) {
    if (a.punish.stun) stun(ctx, source, a.punish.stun);
    hurt(ctx, source, a.punish.damage, t, { dot: true });
  }
}

function die(ctx: Ctx, u: ChampionUnit): void {
  u.dead = true;
  u.deadTime = 0;
  cancelCast(ctx, u);
  u.channel = null;
  u.forced = null;
  u.leap = null;
  u.buffer = null;
  ctx.events.push({ t: "death", unit: u.id });
}

function breakOrb(ctx: Ctx): void {
  const { state, events } = ctx;
  const orb = state.orb;
  orb.alive = false;
  orb.nextAt = state.roundTime + arena.orb.respawnDelay;
  const winner = championById(state, orb.lastHitter);
  if (winner && !winner.dead) {
    winner.hp = Math.min(winner.maxHp, winner.hp + arena.orb.reward.heal);
    addEnergy(winner, arena.orb.reward.energy);
  }
  events.push({ t: "orbBreak", by: winner && !winner.dead ? winner.id : -1, heal: arena.orb.reward.heal, energy: arena.orb.reward.energy });
}

// ---------- status effects ----------

export function stun(ctx: Ctx, t: Unit, duration: number): void {
  if (!controllable(t)) return;
  t.stun = Math.max(t.stun, duration);
  cancelCast(ctx, t);
  ctx.events.push({ t: "status", unit: t.id, status: "stun", duration });
}

export function slow(ctx: Ctx, t: Unit, amount: number, duration: number): void {
  if (!controllable(t)) return;
  t.slowAmount = amount;
  t.slow = Math.max(t.slow, duration);
  ctx.events.push({ t: "status", unit: t.id, status: "slow", duration });
}

export function root(ctx: Ctx, t: Unit, duration: number): void {
  if (!controllable(t)) return;
  t.root = Math.max(t.root, duration);
  ctx.events.push({ t: "status", unit: t.id, status: "root", duration });
}

export function burn(ctx: Ctx, t: Unit, dps: number, duration: number, source: Unit | null): void {
  if (t.kind !== "champion" || t.dead) return;
  t.burn = duration;
  t.burnDps = dps;
  t.burnSource = creditOf(ctx.state, source ?? undefined)?.id ?? -1;
  t.burnTick = rules.burn.tickInterval;
  ctx.events.push({ t: "status", unit: t.id, status: "burn", duration });
}

/** Knockback along (nx, nz). Hitting an obstacle or the arena wall on the way is a slam. */
export function knock(
  ctx: Ctx,
  t: Unit,
  nx: number,
  nz: number,
  distance: number,
  duration: number,
  source: Unit | null,
  slamStun = 0,
  slamDamage = 0,
): void {
  if (!controllable(t)) return;
  const weight = t.kind === "champion" ? getChampion(t.champion).stats.weight : 1;
  const d = distance / weight;
  t.forced = {
    vx: (nx * d) / duration,
    vz: (nz * d) / duration,
    time: duration,
    kind: "knock",
    source: creditOf(ctx.state, source ?? undefined)?.id ?? -1,
    slamStun: slamStun || rules.slam.stun,
    slamDamage,
  };
  cancelCast(ctx, t);
}

/** Drags `t` toward the point, stopping `stopDistance` short of it. Pulls do not slam. */
export function pull(ctx: Ctx, t: Unit, toX: number, toZ: number, stopDistance: number, duration: number): void {
  if (!controllable(t)) return;
  const dx = toX - t.x;
  const dz = toZ - t.z;
  const d = Math.hypot(dx, dz) || 1;
  const go = Math.max(0, d - stopDistance);
  t.forced = { vx: ((dx / d) * go) / duration, vz: ((dz / d) * go) / duration, time: duration, kind: "pull", source: -1, slamStun: 0, slamDamage: 0 };
  cancelCast(ctx, t);
}

/** Advances a knockback/pull by one tick. */
export function moveForced(ctx: Ctx, t: Unit): void {
  const f = t.forced;
  if (!f) return;
  t.x += f.vx * ctx.dt;
  t.z += f.vz * ctx.dt;
  f.time -= ctx.dt;
  if (f.kind === "knock") {
    for (const o of ctx.state.obstacles) {
      const pen = obstaclePenetration(o, t.x, t.z, t.radius);
      if (!pen) continue;
      t.x += pen.nx * pen.depth;
      t.z += pen.nz * pen.depth;
      slam(ctx, t, pen.nx, pen.nz, o);
      return;
    }
    const d = Math.hypot(t.x, t.z);
    const R = arena.radius - arena.wallMargin;
    if (d > R) {
      t.x *= R / d;
      t.z *= R / d;
      slam(ctx, t, -t.x / R, -t.z / R, null);
      return;
    }
  }
  if (f.time <= 0) t.forced = null;
}

function slam(ctx: Ctx, t: Unit, nx: number, nz: number, obstacle: Obstacle | null): void {
  const f = t.forced!;
  t.forced = null;
  const source = f.source >= 0 ? (unitById(ctx.state, f.source) ?? null) : null;
  if (obstacle?.kind === "wood") damageObstacle(ctx, obstacle, rules.slam.woodDamage);
  if (obstacle?.kind === "crate") {
    obstacle.vx -= nx * rules.slam.crateImpulse;
    obstacle.vz -= nz * rules.slam.crateImpulse;
    obstacle.pusher = f.source;
    obstacle.pusherTeam = source ? source.team : -1;
  }
  ctx.events.push({ t: "slam", unit: t.id, x: t.x - nx * t.radius, z: t.z - nz * t.radius });
  stun(ctx, t, f.slamStun);
  hurt(ctx, t, rules.slam.damage + f.slamDamage, source, { dot: true });
}

/**
 * Applies an ability's on-hit data to a target. (ox, oz) is where the hit comes from: knockback pushes away from it,
 * pull drags toward it. Returns false if the hit did not land (see hurt()).
 */
export function applyOnHit(ctx: Ctx, target: Target, onHit: OnHit, source: Unit | null, ox: number, oz: number, opts: HurtOptions = {}): boolean {
  if (!hurt(ctx, target, onHit.damage, source, opts)) return false;
  if (target === "orb") return true;
  if (onHit.stun) stun(ctx, target, onHit.stun);
  if (onHit.slow) slow(ctx, target, onHit.slow.amount, onHit.slow.duration);
  if (onHit.root) root(ctx, target, onHit.root);
  if (onHit.burn) burn(ctx, target, onHit.burn.dps, onHit.burn.duration, source);
  if (onHit.pull) pull(ctx, target, ox, oz, onHit.pull.stopDistance, onHit.pull.duration);
  if (onHit.knockback) {
    const dx = target.x - ox;
    const dz = target.z - oz;
    const d = Math.hypot(dx, dz) || 1;
    const k = onHit.knockback;
    knock(ctx, target, dx / d, dz / d, k.distance, k.duration, source, k.slamStun, k.slamDamage);
  }
  return true;
}

// ---------- obstacles taking damage ----------

export function damageObstacle(ctx: Ctx, o: Obstacle, damage: number): void {
  if (o.kind !== "wood" || !o.alive || !fighting(ctx)) return;
  o.hp -= damage;
  if (o.hp <= 0) {
    o.alive = false;
    o.hp = 0;
    o.respawn = rules.obstacles.woodRespawn;
    ctx.events.push({ t: "obstacleBreak", id: o.id, x: o.x, z: o.z });
  } else {
    ctx.events.push({ t: "obstacleHit", id: o.id, x: o.x, z: o.z });
  }
}

// ---------- area helpers ----------

/** Everything `team` can damage: living enemy champions and companions, plus the orb. */
export function hittables(ctx: Ctx, team: 0 | 1): Target[] {
  const list: Target[] = ctx.state.units.filter((u) => u.team !== team && !u.dead);
  if (ctx.state.orb.alive) list.push("orb");
  return list;
}

export const targetPos = (ctx: Ctx, t: Target): { x: number; z: number; radius: number } => (t === "orb" ? ctx.state.orb : t);

/** Damages wood walls within `radius` of a point. */
export function damageObstaclesInArea(ctx: Ctx, x: number, z: number, radius: number, damage: number): void {
  for (const o of ctx.state.obstacles) {
    if (!o.alive || o.kind !== "wood") continue;
    const co = Math.cos(o.rot);
    const si = Math.sin(o.rot);
    const lx = (x - o.x) * co + (z - o.z) * si;
    const lz = -(x - o.x) * si + (z - o.z) * co;
    const ex = lx - Math.max(-o.halfWidth, Math.min(o.halfWidth, lx));
    const ez = lz - Math.max(-o.halfDepth, Math.min(o.halfDepth, lz));
    if (Math.hypot(ex, ez) < radius) damageObstacle(ctx, o, damage);
  }
}

/** Sends crates within `radius` flying away from a point. */
export function pushCrates(ctx: Ctx, x: number, z: number, radius: number, speed: number, pusher: Unit): void {
  const credit = creditOf(ctx.state, pusher);
  for (const c of ctx.state.obstacles) {
    if (c.kind !== "crate") continue;
    const dx = c.x - x;
    const dz = c.z - z;
    const d = Math.hypot(dx, dz) || 1;
    if (d >= radius + c.radius) continue;
    c.vx = (dx / d) * speed;
    c.vz = (dz / d) * speed;
    c.pusher = credit?.id ?? -1;
    c.pusherTeam = pusher.team;
  }
}
