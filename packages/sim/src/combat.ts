// Damage, status effects, forced movement and slams. Every hit in the game goes through hurt().

import { arena, getChampion, rules, type OnHit } from "@smash/content";
import type { Ctx } from "./context.ts";
import { floorTiles, rimPenetration, rimPoint, tileAt } from "./floor.ts";
import { obstacleDistance, obstaclePenetration } from "./geometry.ts";
import { championById, creditOf, unitById, type ChampionUnit, type CompanionUnit, type Obstacle, type Unit } from "./state.ts";

export type Target = Unit | "orb";

/** Gap left between a champion and the crate it puts down or throws (numerical, so they do not start overlapped). */
const HELD_GAP = 0.15;

export interface HurtOptions {
  /** Damage over time, zone, slams, counter punish: cannot be countered and does not shake the screen. */
  dot?: boolean;
  /** Where the hit physically comes from, if it has a direction. Reported in the damage event for presentation. */
  from?: { x: number; z: number };
}

const fighting = (ctx: Ctx): boolean => ctx.state.phase === "fight";

/** Units that crowd control can affect right now. */
export const controllable = (u: Unit): boolean => !u.dead && !(u.kind === "champion" && isUnstoppable(u));

/** Units that can be shoved, dragged or carried right now: controllable, and not floating. */
export const movable = (u: Unit): boolean => controllable(u) && !(u.kind === "champion" && u.hover > 0);

export function isUnstoppable(u: ChampionUnit): boolean {
  if (u.brace) return true;
  if (!u.channel) return false;
  const a = getChampion(u.champion).abilities[u.channel.slot];
  return a?.kind === "channel" && a.unstoppable;
}

export function cancelCast(ctx: Ctx, u: Unit, reason: "cancelled" | "interrupted" = "interrupted"): void {
  if (u.kind !== "champion" || !u.cast) return;
  const a = getChampion(u.champion).abilities[u.cast.slot];
  ctx.events.push({ t: "castCancel", unit: u.id, slot: u.cast.slot, abilityId: a?.id ?? "", reason });
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
  const origin = opts.from ? { fromX: opts.from.x, fromZ: opts.from.z } : {};

  if (target === "orb") {
    const orb = state.orb;
    if (!orb.alive) return false;
    orb.hp -= damage;
    orb.lastHitter = creditId;
    events.push({ t: "damage", target: -1, targetKind: "orb", source: creditId, amount: damage, absorbed: 0, x: orb.x, z: orb.z, dot, ...origin });
    if (orb.hp <= 0) breakOrb(ctx);
    return true;
  }

  if (target.dead) return false;

  if (target.kind === "companion") {
    target.hp -= damage;
    events.push({ t: "damage", target: target.id, targetKind: "companion", source: creditId, amount: damage, absorbed: 0, x: target.x, z: target.z, dot, ...origin });
    if (credit && credit.team !== target.team) addEnergy(credit, damage * rules.energy.perCompanionDamage);
    if (target.hp <= 0) companionDie(ctx, target, credit);
    return true;
  }

  // Braced: nothing gets through.
  if (target.brace) return false;

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
  events.push({ t: "damage", target: target.id, targetKind: "champion", source: creditId, amount: damage, absorbed, x: target.x, z: target.z, dot, ...origin });
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
    hurt(ctx, source, a.punish.damage, t, { dot: true, from: { x: t.x, z: t.z } });
  }
}

function companionDie(ctx: Ctx, c: CompanionUnit, credit: ChampionUnit | undefined): void {
  c.hp = 0;
  c.dead = true;
  c.respawn = rules.companion.respawn;
  c.forced = null;
  c.target = -1;
  ctx.events.push({ t: "companionDeath", unit: c.id, killer: credit?.id ?? -1 });
  if (credit && credit.team !== c.team) {
    addEnergy(credit, rules.companion.killEnergy);
    ctx.events.push({ t: "energy", unit: credit.id, amount: rules.companion.killEnergy });
  }
}

/** Kills a unit outright (a fall into the abyss): no shield, counter or health pool stands in the way. */
export function kill(ctx: Ctx, u: Unit, creditId: number): void {
  if (u.dead) return;
  u.hp = 0;
  if (u.kind === "companion") companionDie(ctx, u, championById(ctx.state, creditId));
  else die(ctx, u);
}

/** Puts the crate a champion holds back on the field in front of it; `speed` > 0 throws it along (dx, dz). */
export function releaseHeld(ctx: Ctx, u: ChampionUnit, dx = Math.sin(u.face), dz = Math.cos(u.face), speed = 0): void {
  const held = u.held;
  u.held = null;
  const o = held ? ctx.state.obstacles.find((q) => q.id === held.id) : undefined;
  if (!o || o.heldBy !== u.id) return;
  o.heldBy = -1;
  o.alive = true;
  const reach = u.radius + o.radius + HELD_GAP;
  o.x = u.x + dx * reach;
  o.z = u.z + dz * reach;
  o.vx = dx * speed;
  o.vz = dz * speed;
  o.pusher = speed > 0 ? u.id : -1;
  o.pusherTeam = speed > 0 ? u.team : -1;
  ctx.events.push({ t: "release", unit: u.id, obstacle: o.id, x: o.x, z: o.z, thrown: speed > 0 });
}

function die(ctx: Ctx, u: ChampionUnit): void {
  u.dead = true;
  u.deadTime = 0;
  cancelCast(ctx, u);
  releaseHeld(ctx, u);
  u.channel = null;
  u.forced = null;
  u.leap = null;
  u.dash = null;
  u.brace = null;
  u.hover = 0;
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
  if (t.kind === "champion") t.dash = null;
  t.stun = Math.max(t.stun, duration);
  cancelCast(ctx, t);
  ctx.events.push({ t: "status", unit: t.id, status: "stun", duration });
}

/** How strong the unit's slow is right now (0..1). A fading snare wears off linearly. */
export const currentSlow = (u: Unit): number =>
  u.slow <= 0 ? 0 : u.slowFading && u.slowTotal > 0 ? u.slowAmount * (u.slow / u.slowTotal) : u.slowAmount;

/** Move speed multiplier from slows. */
export const slowFactor = (u: Unit): number => 1 - currentSlow(u);

/** Slows do not stack: the stronger one at the moment of the hit wins, so a light snare never replaces a heavy slow. */
export function slow(ctx: Ctx, t: Unit, amount: number, duration: number, fading = false): void {
  if (!controllable(t)) return;
  const now = currentSlow(t);
  if (amount < now) return;
  // Re-applying an equal flat slow keeps whichever lasts longer.
  t.slow = !fading && !t.slowFading && amount === now ? Math.max(t.slow, duration) : duration;
  t.slowAmount = amount;
  t.slowTotal = t.slow;
  t.slowFading = fading;
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

/**
 * Knockback along (nx, nz). Hitting an obstacle or the arena wall on the way is a slam; where the wall is gone,
 * or over a hole in the floor, the target goes into the abyss instead (terrain.ts).
 */
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
  /** Carried rather than shoved (a charge): the distance is not divided by the target's weight. */
  carried = false,
): void {
  if (!movable(t)) return;
  if (t.kind === "champion") t.dash = null;
  const weight = t.kind === "champion" && !carried ? getChampion(t.champion).stats.weight : 1;
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

/**
 * Drags `t` toward the point, stopping `stopDistance` short of it. Pulls do not slam, but a drag over a hole is a fall.
 * `source`: champion credited if it is (-1 when a champion pulls itself).
 */
export function pull(ctx: Ctx, t: Unit, toX: number, toZ: number, stopDistance: number, duration: number, source = -1): void {
  if (!movable(t)) return;
  if (t.kind === "champion") t.dash = null;
  const dx = toX - t.x;
  const dz = toZ - t.z;
  const d = Math.hypot(dx, dz) || 1;
  const go = Math.max(0, d - stopDistance);
  t.forced = { vx: ((dx / d) * go) / duration, vz: ((dz / d) * go) / duration, time: duration, kind: "pull", source, slamStun: 0, slamDamage: 0 };
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
      slam(ctx, t, pen.nx, pen.nz, o, -1);
      return;
    }
    const wall = rimPenetration(ctx.state, t.x, t.z, arena.wallMargin);
    if (wall) {
      t.x += wall.nx * wall.depth;
      t.z += wall.nz * wall.depth;
      slam(ctx, t, wall.nx, wall.nz, null, wall.segment);
      return;
    }
  }
  if (f.time <= 0) t.forced = null;
}

/** `rimSegment`: the section of the arena wall that was hit, or -1 when it was an obstacle. */
function slam(ctx: Ctx, t: Unit, nx: number, nz: number, obstacle: Obstacle | null, rimSegment: number): void {
  const f = t.forced!;
  t.forced = null;
  const source = f.source >= 0 ? (unitById(ctx.state, f.source) ?? null) : null;
  // The body breaks what it is thrown into: the next shove the same way may go through.
  if (obstacle) damageObstacle(ctx, obstacle, rules.slam.structureDamage);
  if (rimSegment >= 0) damageRim(ctx, rimSegment, rules.slam.structureDamage, t.x - nx * t.radius, t.z - nz * t.radius);
  if (obstacle?.kind === "crate") {
    obstacle.vx -= nx * rules.slam.crateImpulse;
    obstacle.vz -= nz * rules.slam.crateImpulse;
    obstacle.pusher = f.source;
    obstacle.pusherTeam = source ? source.team : -1;
  }
  ctx.events.push({ t: "slam", unit: t.id, x: t.x - nx * t.radius, z: t.z - nz * t.radius });
  stun(ctx, t, f.slamStun);
  // Inside a Colosseum the wall hits back harder.
  let factor = 1;
  for (const a of ctx.state.arenas) if (Math.hypot(t.x - a.x, t.z - a.z) < a.radius) factor = Math.max(factor, a.slamMultiplier);
  hurt(ctx, t, (rules.slam.damage + f.slamDamage) * factor, source, { dot: true });
}

/**
 * Applies an ability's on-hit data to a target. (ox, oz) is where the hit comes from: knockback pushes away from it,
 * pull drags toward it. Returns false if the hit did not land (see hurt()).
 */
export function applyOnHit(ctx: Ctx, target: Target, onHit: OnHit, source: Unit | null, ox: number, oz: number, opts: HurtOptions = {}): boolean {
  if (!hurt(ctx, target, onHit.damage, source, { ...opts, from: opts.from ?? { x: ox, z: oz } })) return false;
  if (target === "orb") return true;
  if (onHit.stun) stun(ctx, target, onHit.stun);
  if (onHit.slow) slow(ctx, target, onHit.slow.amount, onHit.slow.duration, onHit.slow.fading);
  if (onHit.root) root(ctx, target, onHit.root);
  if (onHit.burn) burn(ctx, target, onHit.burn.dps, onHit.burn.duration, source);
  if (onHit.pull) pull(ctx, target, ox, oz, onHit.pull.stopDistance, onHit.pull.duration, creditOf(ctx.state, source ?? undefined)?.id ?? -1);
  if (onHit.knockback) {
    const dx = target.x - ox;
    const dz = target.z - oz;
    const d = Math.hypot(dx, dz) || 1;
    const k = onHit.knockback;
    knock(ctx, target, dx / d, dz / d, k.distance, k.duration, source, k.slamStun, k.slamDamage);
  }
  return true;
}

// ---------- the arena taking damage ----------

/** Walls, pillars and crates lose health and break. Nothing is rebuilt during a round; a raised wall is taken off the field. */
export function damageObstacle(ctx: Ctx, o: Obstacle, damage: number): void {
  if (!o.alive || !fighting(ctx)) return;
  o.hp -= damage;
  if (o.hp <= 0) {
    o.alive = false;
    o.hp = 0;
    o.vx = o.vz = 0;
    ctx.events.push({ t: "obstacleBreak", id: o.id, kind: o.kind, x: o.x, z: o.z });
    if (o.kind === "wall") removeObstacle(ctx, o);
  } else {
    ctx.events.push({ t: "obstacleHit", id: o.id, kind: o.kind, x: o.x, z: o.z });
  }
}

/** Takes a raised wall off the field for good. */
export function removeObstacle(ctx: Ctx, o: Obstacle): void {
  o.alive = false;
  ctx.state.obstacles = ctx.state.obstacles.filter((q) => q !== o);
}

/** A section of the arena wall takes damage at (x, z). A broken section is a gap for the rest of the round. */
export function damageRim(ctx: Ctx, segment: number, damage: number, x: number, z: number): void {
  const rim = ctx.state.rim;
  if (rim[segment]! <= 0 || !fighting(ctx)) return;
  rim[segment] = Math.max(0, rim[segment]! - damage);
  if (rim[segment] === 0) ctx.events.push({ t: "rimBreak", segment, x, z, fell: false });
  else ctx.events.push({ t: "rimHit", segment, x, z });
}

/**
 * Something struck the ground: every tile with its centre inside the blast takes the damage (and the tile right
 * under it, however small the blast). A tile that runs out of health starts to crumble and drops a moment later.
 */
export function damageFloor(ctx: Ctx, x: number, z: number, radius: number, damage: number): void {
  const under = tileAt(x, z);
  const tiles: number[] = [];
  for (let i = 0; i < floorTiles.length; i++) {
    const t = floorTiles[i]!;
    if (i === under || Math.hypot(t.x - x, t.z - z) < radius) tiles.push(i);
  }
  damageFloorTiles(ctx, tiles, damage);
}

/** The named tiles take damage (a ground strike with a shape of its own, like a line). */
export function damageFloorTiles(ctx: Ctx, tiles: readonly number[], damage: number): void {
  if (damage <= 0 || !fighting(ctx)) return;
  const floor = ctx.state.floor;
  const cracked: number[] = [];
  const broken: number[] = [];
  for (const i of tiles) {
    if (floor.hp[i]! <= 0) continue;
    floor.hp[i] = Math.max(0, floor.hp[i]! - damage);
    if (floor.hp[i] === 0) {
      floor.crumbling.push({ tile: i, time: arena.floor.crumbleTime });
      broken.push(i);
    } else cracked.push(i);
  }
  if (cracked.length) ctx.events.push({ t: "floorCrack", tiles: cracked });
  if (broken.length) ctx.events.push({ t: "floorCrumble", tiles: broken });
}

// ---------- area helpers ----------

/** Everything `team` can damage: living enemy champions and companions, plus the orb. */
export function hittables(ctx: Ctx, team: 0 | 1): Target[] {
  const list: Target[] = ctx.state.units.filter((u) => u.team !== team && !u.dead);
  if (ctx.state.orb.alive) list.push("orb");
  return list;
}

export const targetPos = (ctx: Ctx, t: Target): { x: number; z: number; radius: number } => (t === "orb" ? ctx.state.orb : t);

/** Damages what stands within `radius` of a point: walls, pillars, crates and sections of the arena wall. */
export function damageStructuresInArea(ctx: Ctx, x: number, z: number, radius: number, damage: number): void {
  for (const o of ctx.state.obstacles) {
    if (o.alive && obstacleDistance(o, x, z) < radius) damageObstacle(ctx, o, damage);
  }
  if (Math.hypot(x, z) + radius <= arena.radius) return;
  for (let segment = 0; segment < ctx.state.rim.length; segment++) {
    if (ctx.state.rim[segment]! <= 0) continue;
    const p = rimPoint(segment, x, z);
    if (Math.hypot(p.x - x, p.z - z) < radius) damageRim(ctx, segment, damage, p.x, p.z);
  }
}

/** Sends crates within `radius` flying away from a point. */
export function pushCrates(ctx: Ctx, x: number, z: number, radius: number, speed: number, pusher: Unit): void {
  const credit = creditOf(ctx.state, pusher);
  for (const c of ctx.state.obstacles) {
    if (c.kind !== "crate" || !c.alive) continue;
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
