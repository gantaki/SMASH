// Ability pipeline: tryCast → (wind-up) → fire → behaviour for the ability's kind.
// To add a mechanic: add a kind to packages/content/src/types.ts and one entry to `behaviors` below.

import { botDifficulty, getChampion, rules, type Ability, type AbilityKind, type AbilitySlot } from "@smash/content";
import { applyOnHit, cancelCast, damageObstacle, hittables, pushCrates, targetPos } from "./combat.ts";
import { commandCompanion } from "./companions.ts";
import type { Ctx } from "./context.ts";
import { obstacleDistance, obstaclePenetration, reach } from "./geometry.ts";
import { angleDiff } from "./math.ts";
import { spawnProjectile } from "./projectiles.ts";
import { companionOf, enemiesOf, type ChampionUnit } from "./state.ts";

const DEG = Math.PI / 180;
/** Extra angle when testing obstacles against a cone (they are tested by their centre). */
const CONE_OBSTACLE_SLACK = 0.4;

type AbilityOf<K extends AbilityKind> = Extract<Ability, { kind: K }>;
type Behavior<K extends AbilityKind> = (ctx: Ctx, u: ChampionUnit, a: AbilityOf<K>, slot: AbilitySlot) => void;

export const abilityOf = (u: ChampionUnit, slot: AbilitySlot): Ability | undefined => getChampion(u.champion).abilities[slot];

/** Free to start a new ability (ignores cooldowns and costs). */
export function canAct(ctx: Ctx, u: ChampionUnit): boolean {
  return ctx.state.phase === "fight" && !u.dead && u.stun <= 0 && !u.forced && !u.leap && !u.cast && !u.channel && u.recovery <= 0;
}

/** Cooldown over and enough energy. */
export function isReady(u: ChampionUnit, slot: AbilitySlot): boolean {
  const a = abilityOf(u, slot);
  if (!a) return false;
  return u.cooldowns[slot] <= 0 && (!a.energyCost || u.energy >= a.energyCost);
}

const isMovement = (a: Ability): boolean => a.kind === "blink" || a.kind === "leap";

/** Starts an ability if possible. Returns true if it started (or fired, for instant abilities). */
export function tryCast(ctx: Ctx, u: ChampionUnit, slot: AbilitySlot): boolean {
  const a = abilityOf(u, slot);
  if (!a || !isReady(u, slot)) return false;
  if (a.kind === "companionCommand") {
    // Commands do not interrupt the champion: usable while casting or channelling.
    if (ctx.state.phase !== "fight" || u.dead || u.stun > 0 || u.forced) return false;
    const pet = companionOf(ctx.state, u);
    if (!pet || pet.dead) return false;
    fire(ctx, u, slot);
    return true;
  }
  if (!canAct(ctx, u)) return false;
  if (isMovement(a) && u.root > 0) return false;
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
  if (a.energyCost) u.energy = Math.max(0, u.energy - a.energyCost);
  if (a.cooldown > 0) {
    const setup = ctx.state.config.players[u.team];
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
      if (!o.alive || o.kind === "stone" || obstacleDistance(o, u.x, u.z) > a.range) continue;
      const ox = o.x - u.x;
      const oz = o.z - u.z;
      if (Math.abs(angleDiff(Math.atan2(ox, oz), u.face)) > half + CONE_OBSTACLE_SLACK) continue;
      if (o.kind === "wood") damageObstacle(ctx, o, onHit.damage);
      else if (a.cratePush) {
        const d = Math.hypot(ox, oz) || 1;
        o.vx = (ox / d) * a.cratePush;
        o.vz = (oz / d) * a.cratePush;
        o.pusher = u.id;
        o.pusherTeam = u.team;
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

  companionCommand(ctx, u) {
    const pet = companionOf(ctx.state, u);
    if (pet && !pet.dead) commandCompanion(ctx, pet, u, u.aim);
  },
};
