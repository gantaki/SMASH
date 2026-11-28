// Ability pipeline: tryCast → (wind-up) → fire → behaviour for the ability's kind.
// To add a mechanic: add a kind to packages/content/src/types.ts and one entry to `behaviors` below.

import {
  arena,
  botDifficulty,
  getChampion,
  rules,
  type Ability,
  type AbilityKind,
  type AbilitySlot,
  type LiftAbility,
  type SwapAbility,
} from "@smash/content";
import {
  applyOnHit,
  cancelCast,
  damageFloorTiles,
  damageObstacle,
  damageRim,
  damageStructuresInArea,
  hittables,
  movable,
  pushCrates,
  releaseHeld,
  removeObstacle,
  targetPos,
} from "./combat.ts";
import { commandCompanion } from "./companions.ts";
import type { Ctx } from "./context.ts";
import { rimPenetration, rimPoint, solidAt, tileAt } from "./floor.ts";
import { blocker, obstacleDistance, obstaclePenetration, reach, segmentHitsObstacle } from "./geometry.ts";
import { TAU, angleDiff, segmentDistance } from "./math.ts";
import { spawnProjectile } from "./projectiles.ts";
import { companionOf, enemiesOf, type ChampionUnit, type MatchState, type Obstacle, type Unit } from "./state.ts";

const DEG = Math.PI / 180;
/** Extra angle when testing obstacles against a cone (they are tested by their centre). */
const CONE_OBSTACLE_SLACK = 0.4;

type AbilityOf<K extends AbilityKind> = Extract<Ability, { kind: K }>;
type Behavior<K extends AbilityKind> = (ctx: Ctx, u: ChampionUnit, a: AbilityOf<K>, slot: AbilitySlot) => void;

export const abilityOf = (u: ChampionUnit, slot: AbilitySlot): Ability | undefined => getChampion(u.champion).abilities[slot];

/** Free to start a new ability (ignores cooldowns and costs). */
export function canAct(ctx: Ctx, u: ChampionUnit): boolean {
  if (u.dash || u.brace || u.hover > 0) return false;
  return ctx.state.phase === "fight" && !u.dead && u.stun <= 0 && !u.forced && !u.leap && !u.cast && !u.channel && u.recovery <= 0;
}

/** The crate a lift would pick up: the one nearest the cursor, close enough to it and to the caster. */
export function liftTarget(state: MatchState, u: ChampionUnit, a: LiftAbility): Obstacle | null {
  let best: Obstacle | null = null;
  let bestD = a.pickRadius;
  for (const o of state.obstacles) {
    if (o.kind !== "crate" || !o.alive) continue;
    const d = Math.hypot(o.x - u.aim.x, o.z - u.aim.z) - o.radius;
    if (d >= bestD || Math.hypot(o.x - u.x, o.z - u.z) > a.range) continue;
    bestD = d;
    best = o;
  }
  return best;
}

/**
 * What a swap would trade places with: the unit or crate nearest the cursor, within range and in plain sight.
 * Not a unit in the air, and not an enemy that cannot be moved (unstoppable, braced, floating).
 */
export function swapTarget(state: MatchState, u: ChampionUnit, a: SwapAbility): { unit: Unit | null; obstacle: Obstacle | null } | null {
  let unit: Unit | null = null;
  let obstacle: Obstacle | null = null;
  let bestD = a.pickRadius;
  const inReach = (t: { x: number; z: number }) => Math.hypot(t.x - u.x, t.z - u.z) <= a.maxRange;
  for (const t of state.units) {
    if (t === u || t.dead || (t.kind === "champion" && t.leap) || (t.team !== u.team && !movable(t))) continue;
    const d = Math.hypot(t.x - u.aim.x, t.z - u.aim.z) - t.radius;
    if (d >= bestD || !inReach(t) || blocker(state, u, t)) continue;
    bestD = d;
    unit = t;
  }
  for (const o of state.obstacles) {
    if (o.kind !== "crate" || !o.alive) continue;
    const d = Math.hypot(o.x - u.aim.x, o.z - u.aim.z) - o.radius;
    if (d >= bestD || !inReach(o)) continue;
    const between = blocker(state, u, o);
    if (between && between !== o) continue;
    bestD = d;
    unit = null;
    obstacle = o;
  }
  return unit || obstacle ? { unit, obstacle } : null;
}

/** Abilities that need something under the cursor do not start (and cost nothing) without it. */
function hasTarget(ctx: Ctx, u: ChampionUnit, a: Ability): boolean {
  if (a.kind === "lift") return !!liftTarget(ctx.state, u, a);
  if (a.kind === "swap") return !!swapTarget(ctx.state, u, a);
  return true;
}

/** Cooldown over and enough energy. */
export function isReady(u: ChampionUnit, slot: AbilitySlot): boolean {
  const a = abilityOf(u, slot);
  if (!a) return false;
  return u.cooldowns[slot] <= 0 && (!a.energyCost || u.energy >= a.energyCost);
}

const isMovement = (a: Ability): boolean => a.kind === "blink" || a.kind === "leap" || a.kind === "dash" || a.kind === "swap";

/** Starts an ability if possible. Returns true if it started (or fired, for instant abilities). */
export function tryCast(ctx: Ctx, u: ChampionUnit, slot: AbilitySlot): boolean {
  const a = abilityOf(u, slot);
  if (!a) return false;
  if (a.kind === "lift" && u.held) {
    // Second press: throw what is held. The cooldown has been running since the pick-up.
    if (!canAct(ctx, u)) return false;
    const dx = u.aim.x - u.x;
    const dz = u.aim.z - u.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.01) u.face = Math.atan2(dx, dz);
    releaseHeld(ctx, u, d > 0.01 ? dx / d : Math.sin(u.face), d > 0.01 ? dz / d : Math.cos(u.face), a.throwSpeed);
    return true;
  }
  if (!isReady(u, slot)) return false;
  if (a.kind === "companionCommand") {
    // Commands do not interrupt the champion: usable while casting or channelling.
    if (ctx.state.phase !== "fight" || u.dead || u.stun > 0 || u.forced || u.brace || u.hover > 0) return false;
    // A companion that was killed cannot be summoned until it has recovered.
    const pet = companionOf(ctx.state, u);
    if (!pet || pet.respawn > 0) return false;
    fire(ctx, u, slot);
    return true;
  }
  if (!canAct(ctx, u)) return false;
  if (isMovement(a) && u.root > 0) return false;
  if (!hasTarget(ctx, u, a)) return false;
  const castTime = (a.castTime ?? 0) * ctx.state.tuning.castTime;
  if (castTime > 0) {
    u.cast = { slot, time: castTime, total: castTime };
    ctx.events.push({ t: "castStart", unit: u.id, slot, abilityId: a.id });
  } else {
    fire(ctx, u, slot);
  }
  return true;
}

/**
 * The player aborts their own wind-up or channel. Nothing was paid for a wind-up (costs are paid on fire), so the
 * only price is the time spent and the cancel's own cooldown. A cancelled channel keeps what it already cost.
 */
export function cancelAction(ctx: Ctx, u: ChampionUnit): boolean {
  if (u.dead || u.cancelLock > 0 || (!u.cast && !u.channel)) return false;
  if (u.cast) cancelCast(ctx, u, "cancelled");
  else {
    u.channel = null;
    ctx.events.push({ t: "channelEnd", unit: u.id });
  }
  u.cancelLock = rules.cancelCast.cooldown;
  u.buffer = null;
  return true;
}

/** The wind-up is over (or there was none): pay the cost and run the behaviour. */
export function fire(ctx: Ctx, u: ChampionUnit, slot: AbilitySlot): void {
  const a = abilityOf(u, slot);
  if (!a) return;
  if (!hasTarget(ctx, u, a)) {
    // What it was aimed at is gone: nothing happens and nothing is paid.
    ctx.events.push({ t: "castCancel", unit: u.id, slot, abilityId: a.id, reason: "interrupted" });
    return;
  }
  if (a.energyCost) u.energy = Math.max(0, u.energy - a.energyCost);
  if (a.cooldown > 0) {
    const setup = ctx.state.config.players[u.slot]!;
    const botDelay = u.controller === "bot" && slot === "primary" ? botDifficulty[setup.difficulty ?? "normal"].primaryDelay : 0;
    u.cooldowns[slot] = a.cooldown * ctx.state.tuning.cooldown + botDelay;
  }
  if (a.kind !== "companionCommand") {
    u.recovery = a.recovery ?? 0;
    const dx = u.aim.x - u.x;
    const dz = u.aim.z - u.z;
    if (Math.hypot(dx, dz) > 0.01) u.face = Math.atan2(dx, dz);
  }
  const empowered = a.kind === "cone" && !!a.empoweredOnHit && u.empowered > 0;
  ctx.events.push({ t: "abilityFire", unit: u.id, slot, abilityId: a.id, x: u.x, z: u.z, aimX: u.aim.x, aimZ: u.aim.z, empowered });
  (behaviors[a.kind] as Behavior<AbilityKind>)(ctx, u, a, slot);
}

const behaviors: { [K in AbilityKind]: Behavior<K> } = {
  projectile(ctx, u, a) {
    spawnProjectile(ctx, u, a, u.aim.x - u.x, u.aim.z - u.z, {
      offset: rules.projectile.muzzleOffset,
      hook: a.hook,
      throughCompanion: a.throughCompanion,
      abilityId: a.id,
    });
  },

  groundAoe(ctx, u, a) {
    const p = reach(u, u.aim, a.maxRange);
    const id = ctx.state.nextId++;
    ctx.state.grounds.push({
      id,
      owner: u.id,
      team: u.team,
      x: p.x,
      z: p.z,
      radius: a.radius,
      delay: a.delay,
      t: 0,
      onHit: a.onHit,
      floorDamage: a.floorDamage,
      floorRadius: a.floorRadius ?? a.radius,
      drag: a.drag ?? 0,
      cratePush: a.cratePush ?? 0,
      falling: !!a.falling,
      abilityId: a.id,
    });
    ctx.events.push({ t: "groundSpawn", id, x: p.x, z: p.z, radius: a.radius, abilityId: a.id });
  },

  cone(ctx, u, a) {
    const empowered = !!a.empoweredOnHit && u.empowered > 0;
    if (a.empoweredOnHit) u.empowered = 0;
    const onHit = empowered && a.empoweredOnHit ? a.empoweredOnHit : a.onHit;
    const half = a.halfAngleDeg * DEG;
    for (const t of hittables(ctx, u.team)) {
      const pos = targetPos(ctx, t);
      const dx = pos.x - u.x;
      const dz = pos.z - u.z;
      const d = Math.hypot(dx, dz);
      if (d > a.range + pos.radius) continue;
      if (d > 0.3 && Math.abs(angleDiff(Math.atan2(dx, dz), u.face)) > half + Math.atan2(pos.radius, d)) continue;
      if (applyOnHit(ctx, t, onHit, u, u.x, u.z) && t !== "orb") {
        ctx.events.push({ t: "meleeHit", source: u.id, target: t.id, abilityId: a.id, empowered });
      }
    }
    for (const o of ctx.state.obstacles) {
      if (!o.alive || obstacleDistance(o, u.x, u.z) > a.range) continue;
      const ox = o.x - u.x;
      const oz = o.z - u.z;
      if (Math.abs(angleDiff(Math.atan2(ox, oz), u.face)) > half + CONE_OBSTACLE_SLACK) continue;
      damageObstacle(ctx, o, onHit.damage);
      if (o.kind === "crate" && o.alive && a.cratePush) {
        const d = Math.hypot(ox, oz) || 1;
        o.vx = (ox / d) * a.cratePush;
        o.vz = (oz / d) * a.cratePush;
        o.pusher = u.id;
        o.pusherTeam = u.team;
      }
    }
    // The arena wall, section by section: the swing reaches the nearest point of a section.
    if (Math.hypot(u.x, u.z) + a.range > arena.radius) {
      for (let segment = 0; segment < ctx.state.rim.length; segment++) {
        if (ctx.state.rim[segment]! <= 0) continue;
        const p = rimPoint(segment, u.x, u.z);
        if (Math.hypot(p.x - u.x, p.z - u.z) > a.range) continue;
        if (Math.abs(angleDiff(Math.atan2(p.x - u.x, p.z - u.z), u.face)) > half) continue;
        damageRim(ctx, segment, onHit.damage, p.x, p.z);
      }
    }
  },

  blink(ctx, u, a) {
    const p = reach(u, u.aim, a.maxRange);
    for (const o of ctx.state.obstacles) {
      const pen = obstaclePenetration(o, p.x, p.z, u.radius);
      if (pen) {
        p.x += pen.nx * pen.depth;
        p.z += pen.nz * pen.depth;
      }
    }
    ctx.events.push({ t: "blink", unit: u.id, fromX: u.x, fromZ: u.z, toX: p.x, toZ: p.z });
    u.x = p.x;
    u.z = p.z;
    u.mvx = u.mvz = 0;
  },

  leap(_ctx, u, a, slot) {
    const p = reach(u, u.aim, a.maxRange);
    u.leap = { slot, x0: u.x, z0: u.z, x1: p.x, z1: p.z, t: 0, duration: a.duration };
    u.mvx = u.mvz = 0;
  },

  nova(ctx, u, a) {
    if (a.shield) {
      u.shield = a.shield.amount;
      u.shieldTime = a.shield.duration;
      ctx.events.push({ t: "status", unit: u.id, status: "shield", duration: a.shield.duration });
    }
    for (const t of enemiesOf(ctx.state, u.team)) {
      if (Math.hypot(t.x - u.x, t.z - u.z) < a.radius + t.radius * rules.areaBodyFactor) applyOnHit(ctx, t, a.onHit, u, u.x, u.z);
    }
    damageStructuresInArea(ctx, u.x, u.z, a.radius, a.onHit.damage);
    if (a.cratePush) pushCrates(ctx, u.x, u.z, a.radius, a.cratePush, u);
    ctx.events.push({ t: "nova", unit: u.id, x: u.x, z: u.z, radius: a.radius, abilityId: a.id });
  },

  counter(ctx, u, a, slot) {
    u.counter = a.duration;
    u.counterSlot = slot;
    ctx.events.push({ t: "status", unit: u.id, status: "counter", duration: a.duration });
  },

  channel(_ctx, u, a, slot) {
    u.channel = { slot, time: a.duration, tick: 0 };
  },

  wall(ctx, u, a) {
    const p = reach(u, u.aim, a.maxRange);
    const dx = p.x - u.x;
    const dz = p.z - u.z;
    const facing = Math.hypot(dx, dz) > 0.2 ? Math.atan2(dx, dz) : u.face;
    raiseWall(ctx, u, a.id, p.x, p.z, facing, a.halfWidth, a.halfDepth, a.hp, a.duration);
    // The oldest one crumbles when there are too many.
    const mine = ctx.state.obstacles.filter((o) => o.kind === "wall" && o.owner === u.id && o.source === a.id);
    for (const old of mine.slice(0, Math.max(0, mine.length - a.maxActive))) {
      ctx.events.push({ t: "wallExpire", id: old.id, x: old.x, z: old.z });
      removeObstacle(ctx, old);
    }
  },

  dash(_ctx, u, a, slot) {
    const p = reach(u, u.aim, a.maxRange);
    let dx = p.x - u.x;
    let dz = p.z - u.z;
    let d = Math.hypot(dx, dz);
    if (d < 0.2) {
      dx = Math.sin(u.face);
      dz = Math.cos(u.face);
      d = 1;
    }
    const speed = a.maxRange / a.duration;
    u.dash = { slot, vx: (dx / d) * speed, vz: (dz / d) * speed, time: Math.max(a.minRange, Math.hypot(p.x - u.x, p.z - u.z)) / speed, hit: false };
    u.mvx = u.mvz = 0;
  },

  brace(ctx, u, a, slot) {
    u.brace = { slot, time: a.duration };
    u.mvx = u.mvz = 0;
    ctx.events.push({ t: "status", unit: u.id, status: "brace", duration: a.duration });
  },

  line(ctx, u, a) {
    let dx = u.aim.x - u.x;
    let dz = u.aim.z - u.z;
    const d = Math.hypot(dx, dz);
    dx = d > 0.01 ? dx / d : Math.sin(u.face);
    dz = d > 0.01 ? dz / d : Math.cos(u.face);
    const from = { x: u.x, z: u.z };
    const to = { x: u.x + dx * a.range, z: u.z + dz * a.range };
    for (const t of hittables(ctx, u.team)) {
      const pos = targetPos(ctx, t);
      if (segmentDistance(pos, from, to) < a.halfWidth + pos.radius * rules.areaBodyFactor) applyOnHit(ctx, t, a.onHit, u, u.x, u.z);
    }
    for (const o of ctx.state.obstacles) {
      if (!o.alive || !segmentHitsObstacle(o, from, to, a.halfWidth)) continue;
      if (o.kind === "wall" && o.owner === u.id && a.shatter) {
        // The caster's own wall bursts: shards fly from it in every direction.
        const { radius, onHit } = a.shatter;
        ctx.events.push({ t: "wallShatter", id: o.id, x: o.x, z: o.z, radius, abilityId: a.id });
        removeObstacle(ctx, o);
        for (const t of hittables(ctx, u.team)) {
          const pos = targetPos(ctx, t);
          if (Math.hypot(pos.x - o.x, pos.z - o.z) < radius + pos.radius * rules.areaBodyFactor) applyOnHit(ctx, t, onHit, u, o.x, o.z);
        }
        if (a.cratePush) pushCrates(ctx, o.x, o.z, radius, a.cratePush, u);
        continue;
      }
      damageObstacle(ctx, o, a.onHit.damage);
      if (o.kind === "crate" && o.alive && a.cratePush) {
        o.vx = dx * a.cratePush;
        o.vz = dz * a.cratePush;
        o.pusher = u.id;
        o.pusherTeam = u.team;
      }
    }
    // Where the line runs into the arena wall, that section takes the hit.
    const tiles = new Set<number>();
    for (let s = 0; s <= a.range; s += LINE_STEP) {
      const x = u.x + dx * s;
      const z = u.z + dz * s;
      const wall = rimPenetration(ctx.state, x, z, 0);
      if (wall) {
        damageRim(ctx, wall.segment, a.onHit.damage, x, z);
        break;
      }
      // It strikes the ground: every tile under the line.
      for (const side of [-1, 0, 1]) {
        const tile = tileAt(x - dz * side * a.halfWidth * LINE_SPREAD, z + dx * side * a.halfWidth * LINE_SPREAD);
        if (tile >= 0) tiles.add(tile);
      }
    }
    // Not the tile the caster stands on: the shock starts in front of him.
    tiles.delete(tileAt(u.x, u.z));
    damageFloorTiles(ctx, [...tiles], a.floorDamage);
    ctx.events.push({ t: "line", unit: u.id, x0: from.x, z0: from.z, x1: to.x, z1: to.z, halfWidth: a.halfWidth, abilityId: a.id });
  },

  ring(ctx, u, a) {
    const p = reach(u, u.aim, a.maxRange);
    // Wide enough for neighbouring pieces to meet.
    const halfWidth = a.radius * Math.tan(Math.PI / a.segments) + a.halfDepth;
    for (let k = 0; k < a.segments; k++) {
      const angle = (k * TAU) / a.segments;
      const x = p.x + Math.sin(angle) * a.radius;
      const z = p.z + Math.cos(angle) * a.radius;
      // Only where there is floor to stand on: near the edge the arena wall closes the ring, a hole leaves a gap.
      if (solidAt(ctx.state, x, z)) raiseWall(ctx, u, a.id, x, z, angle, halfWidth, a.halfDepth, a.hp, a.duration);
    }
    const id = ctx.state.nextId++;
    ctx.state.arenas.push({ id, owner: u.id, x: p.x, z: p.z, radius: a.radius, time: a.duration, slamMultiplier: a.slamMultiplier });
    ctx.events.push({ t: "ringRaise", id, x: p.x, z: p.z, radius: a.radius, duration: a.duration, abilityId: a.id });
  },

  lift(ctx, u, a) {
    const o = liftTarget(ctx.state, u, a);
    if (!o) return;
    o.heldBy = u.id;
    o.alive = false;
    o.vx = o.vz = 0;
    u.held = { id: o.id, time: a.holdTime };
    ctx.events.push({ t: "lift", unit: u.id, obstacle: o.id, x: o.x, z: o.z });
  },

  swap(ctx, u, a) {
    const target = swapTarget(ctx.state, u, a);
    if (!target) return;
    const t = target.unit ?? target.obstacle;
    if (!t) return;
    const ax = u.x;
    const az = u.z;
    u.x = t.x;
    u.z = t.z;
    t.x = ax;
    t.z = az;
    u.mvx = u.mvz = 0;
    if (target.unit) {
      if (target.unit.kind === "champion") target.unit.mvx = target.unit.mvz = 0;
      // Being moved interrupts an enemy, like any forced movement.
      if (target.unit.team !== u.team) cancelCast(ctx, target.unit);
    } else if (target.obstacle) {
      target.obstacle.vx = target.obstacle.vz = 0;
    }
    ctx.events.push({ t: "swap", unit: u.id, target: target.unit?.id ?? -1, obstacle: target.obstacle?.id ?? -1, ax, az, bx: u.x, bz: u.z });
  },

  hover(ctx, u, a, slot) {
    u.hover = a.duration;
    u.hoverSlot = slot;
    ctx.events.push({ t: "status", unit: u.id, status: "hover", duration: a.duration });
  },

  companionCommand(ctx, u) {
    const pet = companionOf(ctx.state, u);
    if (pet && pet.respawn <= 0) commandCompanion(ctx, pet, u, u.aim);
  },
};

/** A line ability's footprint on the floor: sampled every LINE_STEP meters, across LINE_SPREAD of its half-width. */
const LINE_STEP = 0.4;
const LINE_SPREAD = 0.7;

/** Stands a wall up at (x, z), its long side across the direction `facing` (radians). */
function raiseWall(ctx: Ctx, u: ChampionUnit, source: string, x: number, z: number, facing: number, halfWidth: number, halfDepth: number, hp: number, duration: number): Obstacle {
  const o: Obstacle = {
    id: ctx.state.nextId++,
    kind: "wall",
    shape: "box",
    x,
    z,
    radius: Math.hypot(halfWidth, halfDepth),
    halfWidth,
    halfDepth,
    // The box's long axis is (cos rot, sin rot); across the facing direction (sin f, cos f) that is rot = -f.
    rot: -facing,
    alive: true,
    fallen: false,
    hp,
    maxHp: hp,
    homeX: x,
    homeZ: z,
    vx: 0,
    vz: 0,
    pusher: -1,
    pusherTeam: -1,
    spin: 0,
    temp: duration,
    owner: u.id,
    source,
    heldBy: -1,
  };
  ctx.state.obstacles.push(o);
  ctx.events.push({ t: "wallRaise", id: o.id, x, z });
  return o;
}
