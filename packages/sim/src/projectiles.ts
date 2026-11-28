// Projectiles and delayed ground effects.

import { arena, rules, type CompanionInteraction, type ProjectileSpec } from "@smash/content";
import { applyOnHit, damageFloor, damageObstacle, damageRim, damageStructuresInArea, hittables, movable, pull, pushCrates, targetPos } from "./combat.ts";
import type { Ctx } from "./context.ts";
import { rimPenetration } from "./floor.ts";
import { obstaclePenetration } from "./geometry.ts";
import { companionOf, creditOf, unitById, type Projectile, type Unit } from "./state.ts";
import type { ProjectileEndReason } from "./events.ts";

const DEG = Math.PI / 180;
/** Things dragged toward a point stop this close to it (numerical: they do not pile onto one spot). */
const DRAG_STOP = 0.3;

export interface ProjectileOptions {
  /** Distance from the shooter's centre at which the projectile appears. */
  offset: number;
  hook?: boolean;
  throughCompanion?: CompanionInteraction;
  abilityId?: string;
  /** Spawn point, if not the shooter's position. */
  from?: { x: number; z: number };
}

export function spawnProjectile(ctx: Ctx, owner: Unit, spec: ProjectileSpec, dirX: number, dirZ: number, opts: ProjectileOptions): Projectile {
  const { state } = ctx;
  let d = Math.hypot(dirX, dirZ);
  if (d < 0.01) {
    dirX = Math.sin(owner.face);
    dirZ = Math.cos(owner.face);
    d = 1;
  }
  dirX /= d;
  dirZ /= d;
  const from = opts.from ?? owner;
  const speed = spec.speed * state.tuning.projectileSpeed;
  const p: Projectile = {
    id: state.nextId++,
    owner: owner.id,
    credit: creditOf(state, owner)?.id ?? -1,
    team: owner.team,
    x: from.x + dirX * opts.offset,
    z: from.z + dirZ * opts.offset,
    vx: dirX * speed,
    vz: dirZ * speed,
    speed,
    range: spec.range,
    dist: 0,
    age: 0,
    radius: spec.radius,
    onHit: spec.onHit,
    visual: spec.visual,
    cratePush: spec.cratePush ?? 0,
    hook: !!opts.hook,
    throughCompanion: opts.throughCompanion ?? null,
    abilityId: opts.abilityId ?? null,
  };
  state.projectiles.push(p);
  ctx.events.push({ t: "projectileSpawn", id: p.id, owner: owner.id, abilityId: p.abilityId, x: p.x, z: p.z });
  return p;
}

function endProjectile(ctx: Ctx, index: number, reason: ProjectileEndReason): void {
  const p = ctx.state.projectiles[index]!;
  ctx.state.projectiles.splice(index, 1);
  ctx.events.push({ t: "projectileEnd", id: p.id, x: p.x, z: p.z, reason, heavy: !!p.visual.heavy, abilityId: p.abilityId, team: p.team });
}

export function updateProjectiles(ctx: Ctx): void {
  const { state, dt } = ctx;
  const cfg = rules.projectile;
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const p = state.projectiles[i]!;
    p.age += dt;
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    p.dist += p.speed * dt;
    if (p.dist > p.range) {
      endProjectile(ctx, i, "expired");
      continue;
    }
    // The arena wall stops it and takes the hit; through a gap it flies on over the abyss until its range runs out.
    const wall = rimPenetration(state, p.x, p.z, cfg.wallMargin);
    if (wall) {
      damageRim(ctx, wall.segment, p.onHit.damage, p.x, p.z);
      endProjectile(ctx, i, "blocked");
      continue;
    }
    const owner = unitById(state, p.owner);
    const credit = unitById(state, p.credit);

    // The caster's own companion: split or hook-to-companion.
    if (p.throughCompanion && owner?.kind === "champion" && p.dist > cfg.companionArmDistance) {
      const pet = companionOf(state, owner);
      if (pet && !pet.dead && Math.hypot(p.x - pet.x, p.z - pet.z) < p.radius + pet.radius + cfg.companionTouchPad) {
        const inter = p.throughCompanion;
        ctx.events.push({ t: "companionInteract", kind: inter.kind, unit: pet.id, x: pet.x, z: pet.z });
        if (inter.kind === "split") {
          const base = Math.atan2(p.vx, p.vz);
          const abilityId = p.abilityId ?? undefined;
          endProjectile(ctx, i, "split");
          for (let k = 0; k < inter.count; k++) {
            const a = base + (k - (inter.count - 1) / 2) * inter.spreadDeg * DEG;
            spawnProjectile(ctx, owner, inter.projectile, Math.sin(a), Math.cos(a), { offset: cfg.companionMuzzleOffset, from: pet, abilityId });
          }
        } else {
          pull(ctx, owner, pet.x, pet.z, inter.stopDistance, cfg.pullCasterDuration);
          endProjectile(ctx, i, "hook");
        }
        continue;
      }
    }

    let blocked = false;
    for (const o of state.obstacles) {
      if (!o.alive || !obstaclePenetration(o, p.x, p.z, p.radius)) continue;
      damageObstacle(ctx, o, p.onHit.damage);
      if (o.kind === "crate" && o.alive) {
        if (p.hook && owner) {
          // Yank the crate so that friction stops it just in front of the caster.
          const dx = owner.x - o.x;
          const dz = owner.z - o.z;
          const d = Math.hypot(dx, dz) || 1;
          const v = Math.sqrt(2 * rules.obstacles.crateFriction * Math.max(0, d - owner.radius - o.radius - cfg.hookCrateStop));
          o.vx = (dx / d) * v;
          o.vz = (dz / d) * v;
        } else {
          o.vx += (p.vx / p.speed) * p.cratePush;
          o.vz += (p.vz / p.speed) * p.cratePush;
        }
        o.pusher = p.credit;
        o.pusherTeam = p.team;
      }
      blocked = true;
      break;
    }
    if (blocked) {
      endProjectile(ctx, i, "blocked");
      continue;
    }

    let hit = false;
    for (const t of hittables(ctx, p.team)) {
      const pos = targetPos(ctx, t);
      if (Math.hypot(p.x - pos.x, p.z - pos.z) >= p.radius + pos.radius) continue;
      // Pulls drag the target to the caster, knockbacks push along the flight direction.
      const origin = p.onHit.pull && owner ? owner : { x: p.x - p.vx, z: p.z - p.vz };
      applyOnHit(ctx, t, p.onHit, credit ?? owner ?? null, origin.x, origin.z);
      hit = true;
      break;
    }
    if (hit) endProjectile(ctx, i, "hit");
  }
}

export function updateGrounds(ctx: Ctx): void {
  const { state, dt } = ctx;
  for (let i = state.grounds.length - 1; i >= 0; i--) {
    const g = state.grounds[i]!;
    g.t += dt;
    if (g.t < g.delay) {
      // A whirl: enemies inside are dragged toward the middle until it goes off.
      if (g.drag > 0) {
        for (const t of state.units) {
          if (t.team === g.team || t.dead || !movable(t) || (t.kind === "champion" && t.leap)) continue;
          const dx = g.x - t.x;
          const dz = g.z - t.z;
          const d = Math.hypot(dx, dz);
          if (d >= g.radius + t.radius * rules.areaBodyFactor || d < DRAG_STOP) continue;
          const move = Math.min(d - DRAG_STOP, g.drag * dt);
          t.x += (dx / d) * move;
          t.z += (dz / d) * move;
        }
      }
      continue;
    }
    const owner = unitById(state, g.owner) ?? null;
    for (const t of hittables(ctx, g.team)) {
      const pos = targetPos(ctx, t);
      if (Math.hypot(pos.x - g.x, pos.z - g.z) < g.radius + pos.radius * rules.areaBodyFactor) applyOnHit(ctx, t, g.onHit, owner, g.x, g.z);
    }
    damageStructuresInArea(ctx, g.x, g.z, g.radius, g.onHit.damage);
    damageFloor(ctx, g.x, g.z, g.floorRadius, g.floorDamage);
    if (g.cratePush && owner) pushCrates(ctx, g.x, g.z, g.radius, g.cratePush, owner);
    ctx.events.push({ t: "groundBurst", id: g.id, x: g.x, z: g.z, radius: g.radius, abilityId: g.abilityId, falling: g.falling });
    state.grounds.splice(i, 1);
  }
}
