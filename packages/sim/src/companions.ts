// Companions. A companion is not on the field until its owner commands it: it appears beside the owner, carries the
// command out (CompanionDef.command) and leaves. Killed while out, it cannot be summoned again for a while.

import { arena, getChampion, rules, type CompanionDef } from "@smash/content";
import { applyOnHit, hurt, movable, moveForced, slowFactor } from "./combat.ts";
import type { Ctx } from "./context.ts";
import { nearestSafe, rimPenetration, safeAt } from "./floor.ts";
import { clearLine, obstaclePenetration, reach } from "./geometry.ts";
import { angleDiff, type Vec2 } from "./math.ts";
import { spawnProjectile } from "./projectiles.ts";
import { championById, enemiesOf, offGround, resetCompanion, unitById, type ChampionUnit, type CompanionUnit, type Unit } from "./state.ts";

// Path-finding and presentation helpers (not balance): how long to keep sliding around an obstacle, turn smoothing.
const SLIDE_TIME = 0.6;
const TURN_RATE = 12;
/** A companion that has not reached its point in this many times the direct trip (plus a second) gives up: the way is cut off. */
const GO_PATIENCE = 2;
/** How far ahead of its centre a rolling companion looks for the edge of a hole (less than the gap kept to the arena wall). */
const ROLL_LOOK = 0.3;
/** Room a flying companion keeps between itself and an obstacle it was sent onto: the pad of the line-of-sight test. */
const SIGHT_PAD = 0.4;
/** Extra reach when a rolling companion runs into someone. */
const ROLL_PAD = 0.15;
/** Things pulled by a gravity well stop this close to it. */
const WELL_STOP = 0.8;

export const companionDef = (state: Ctx["state"], c: CompanionUnit): CompanionDef => {
  const owner = championById(state, c.owner)!;
  return getChampion(owner.champion).companion!;
};

/** The command is over (or the owner is dead): the companion leaves the field unharmed. */
function leave(ctx: Ctx, c: CompanionUnit): void {
  c.dead = true;
  c.forced = null;
  c.target = -1;
  c.vx = c.vz = 0;
  ctx.events.push({ t: "companionLeave", unit: c.id, x: c.x, z: c.z });
}

/** Summons the companion if it is not out yet, and sends it to the aim point. */
export function commandCompanion(ctx: Ctx, c: CompanionUnit, owner: ChampionUnit, aim: Vec2): void {
  const { state } = ctx;
  const def = companionDef(state, c);
  const cmd = def.command;
  if (c.dead) {
    resetCompanion(c, owner);
    // A walking companion does not appear over a hole.
    if (!def.flying && !safeAt(state, c.x, c.z)) {
      const p = safeAt(state, owner.x, owner.z) ? owner : (nearestSafe(state, owner.x, owner.z) ?? owner);
      c.x = p.x;
      c.z = p.z;
    }
    ctx.events.push({ t: "companionSummon", unit: c.id, x: c.x, z: c.z });
  }
  let t = reach(owner, aim, cmd.maxRange);
  c.target = -1;
  if (cmd.kind === "roll") {
    // A straight line from where it is, whatever lies on it.
    const dx = t.x - c.x;
    const dz = t.z - c.z;
    const d = Math.hypot(dx, dz);
    c.rollX = d > 0.05 ? dx / d : Math.sin(owner.face);
    c.rollZ = d > 0.05 ? dz / d : Math.cos(owner.face);
    c.travel = Math.max(cmd.minRange, d);
    c.bounces = 0;
    c.rolledOver = [];
    c.mode = "roll";
  } else {
    // A walking companion sent onto a hole goes to the nearest floor instead.
    if (!def.flying && !safeAt(state, t.x, t.z)) t = nearestSafe(state, t.x, t.z) ?? t;
    // A flying one can hold a point over anything, but from inside a wall or a pillar it would see nothing: it
    // takes the nearest spot beside it.
    if (def.flying) {
      for (const o of state.obstacles) {
        const pen = obstaclePenetration(o, t.x, t.z, c.radius + SIGHT_PAD);
        if (pen) t = { x: t.x + pen.nx * pen.depth, z: t.z + pen.nz * pen.depth };
      }
    }
    c.mode = "go";
    c.modeTime = (Math.hypot(t.x - c.x, t.z - c.z) / def.commandSpeed) * GO_PATIENCE + 1;
  }
  c.tx = t.x;
  c.tz = t.z;
  ctx.events.push({ t: "companionCommand", unit: c.id, x: t.x, z: t.z });
}

function nearestEnemy(ctx: Ctx, c: CompanionUnit, list: Unit[], range: number, needLine: boolean): Unit | null {
  let best: Unit | null = null;
  let bestScore = Infinity;
  for (const e of list) {
    const d = Math.hypot(e.x - c.x, e.z - c.z);
    if (d > range + e.radius || (needLine && !clearLine(ctx.state, c, e))) continue;
    const score = d - (e.kind === "champion" ? rules.companion.championPriority : 0);
    if (score < bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best;
}

function shoot(ctx: Ctx, c: CompanionUnit, def: CompanionDef, t: Unit): void {
  if (def.attack.kind !== "ranged") return;
  c.face = Math.atan2(t.x - c.x, t.z - c.z);
  spawnProjectile(ctx, c, def.attack.projectile, t.x - c.x, t.z - c.z, { offset: rules.projectile.companionMuzzleOffset });
  ctx.events.push({ t: "companionAttack", unit: c.id, target: t.id, heavy: false, x: c.x, z: c.z });
}

/** Pushes the companion out of obstacles and the arena wall; returns the summed push normal. */
function pushOut(ctx: Ctx, c: CompanionUnit, flying: boolean): Vec2 {
  let nx = 0;
  let nz = 0;
  if (!flying) {
    for (const o of ctx.state.obstacles) {
      const pen = obstaclePenetration(o, c.x, c.z, c.radius);
      if (!pen) continue;
      c.x += pen.nx * pen.depth;
      c.z += pen.nz * pen.depth;
      nx += pen.nx;
      nz += pen.nz;
    }
  }
  const wall = rimPenetration(ctx.state, c.x, c.z, arena.wallMargin);
  if (wall) {
    c.x += wall.nx * wall.depth;
    c.z += wall.nz * wall.depth;
    nx += wall.nx;
    nz += wall.nz;
  }
  return { x: nx, z: nz };
}

/** One tick of rolling: straight on, over whoever is in the way, bouncing off anything solid. */
function roll(ctx: Ctx, c: CompanionUnit, def: CompanionDef, enemies: Unit[]): void {
  const cmd = def.command;
  if (cmd.kind !== "roll") return;
  const step = Math.min(c.travel, def.commandSpeed * ctx.state.tuning.moveSpeed * slowFactor(c) * ctx.dt);
  // Like any walking companion it does not go off the floor by itself: at the edge of a hole it stops.
  if (safeAt(ctx.state, c.x, c.z) && !safeAt(ctx.state, c.x + c.rollX * (step + ROLL_LOOK), c.z + c.rollZ * (step + ROLL_LOOK))) {
    c.mode = "cover";
    c.modeTime = cmd.coverTime;
    return;
  }
  c.x += c.rollX * step;
  c.z += c.rollZ * step;
  c.travel -= step;
  if (ctx.state.phase === "fight") {
    for (const e of enemies) {
      if (c.rolledOver.includes(e.id) || (e.kind === "champion" && e.leap)) continue;
      if (Math.hypot(e.x - c.x, e.z - c.z) >= c.radius + e.radius + ROLL_PAD) continue;
      c.rolledOver.push(e.id);
      // Thrown the way the boulder rolls.
      applyOnHit(ctx, e, cmd.onHit, c, e.x - c.rollX, e.z - c.rollZ);
      ctx.events.push({ t: "companionAttack", unit: c.id, target: e.id, heavy: true, x: e.x, z: e.z });
    }
  }
  const n = pushOut(ctx, c, false);
  const nl = Math.hypot(n.x, n.z);
  let stop = c.travel <= 0;
  if (nl > 0) {
    const ux = n.x / nl;
    const uz = n.z / nl;
    const into = c.rollX * ux + c.rollZ * uz;
    if (into < 0) {
      if (c.bounces >= cmd.bounces) stop = true;
      else {
        c.rollX -= 2 * into * ux;
        c.rollZ -= 2 * into * uz;
        c.bounces++;
        c.travel += cmd.bounceExtra;
        stop = false;
        ctx.events.push({ t: "companionBounce", unit: c.id, x: c.x, z: c.z });
      }
    }
  }
  c.face = Math.atan2(c.rollX, c.rollZ);
  if (stop) {
    c.mode = "cover";
    c.modeTime = cmd.coverTime;
  }
}

/** One tick of a gravity well: enemies drift toward it, crates are flung at it. */
function well(ctx: Ctx, c: CompanionUnit, def: CompanionDef, owner: ChampionUnit, enemies: Unit[]): void {
  const cmd = def.command;
  if (cmd.kind !== "well" || ctx.state.phase !== "fight") return;
  for (const e of enemies) {
    if (!movable(e) || offGround(e)) continue;
    const dx = c.x - e.x;
    const dz = c.z - e.z;
    const d = Math.hypot(dx, dz);
    if (d >= cmd.radius || d <= WELL_STOP) continue;
    const move = Math.min(d - WELL_STOP, cmd.unitPull * ctx.dt);
    e.x += (dx / d) * move;
    e.z += (dz / d) * move;
    e.draggedBy = owner.id;
  }
  for (const o of ctx.state.obstacles) {
    if (o.kind !== "crate" || !o.alive) continue;
    const dx = c.x - o.x;
    const dz = c.z - o.z;
    const d = Math.hypot(dx, dz);
    if (d >= cmd.radius || d <= WELL_STOP) continue;
    o.vx = (dx / d) * cmd.cratePull;
    o.vz = (dz / d) * cmd.cratePull;
    o.pusher = owner.id;
    o.pusherTeam = owner.team;
  }
}

export function updateCompanion(ctx: Ctx, c: CompanionUnit): void {
  const { state, dt } = ctx;
  const owner = championById(state, c.owner);
  if (!owner) return;
  const def = getChampion(owner.champion).companion!;
  const fight = state.phase === "fight";

  if (c.dead) {
    c.vx = c.vz = 0;
    if (fight && c.respawn > 0) c.respawn = Math.max(0, c.respawn - dt);
    return;
  }
  if (owner.dead) return leave(ctx, c);
  c.stun = Math.max(0, c.stun - dt);
  c.slow = Math.max(0, c.slow - dt);
  c.root = Math.max(0, c.root - dt);
  c.attackTimer -= dt;
  const ox = c.x;
  const oz = c.z;
  const finish = () => {
    c.vx = (c.x - ox) / dt;
    c.vz = (c.z - oz) / dt;
  };

  if (c.forced) {
    moveForced(ctx, c);
    pushOut(ctx, c, def.flying);
    finish();
    return;
  }
  if (c.stun > 0) {
    finish();
    return;
  }

  const enemies = enemiesOf(state, c.team);
  let gx = c.x;
  let gz = c.z;
  let speed = def.moveSpeed;
  let target: Unit | undefined;

  switch (c.mode) {
    case "go": {
      gx = c.tx;
      gz = c.tz;
      speed = def.commandSpeed;
      const cmd = def.command;
      c.modeTime -= dt;
      if (c.modeTime <= 0) return leave(ctx, c);
      if (cmd.kind === "pounce" && fight) {
        const t = enemies.find((e) => e.kind === "champion" && Math.hypot(e.x - c.x, e.z - c.z) < c.radius + e.radius + rules.companion.pounceTouchPad);
        if (t) {
          applyOnHit(ctx, t, cmd.onHit, c, c.x, c.z);
          c.face = Math.atan2(t.x - c.x, t.z - c.z);
          ctx.events.push({ t: "companionAttack", unit: c.id, target: t.id, heavy: true, x: t.x, z: t.z });
          c.mode = "engage";
          c.modeTime = cmd.engageTime;
          c.target = t.id;
          c.attackTimer = def.attack.kind === "melee" ? def.attack.interval : 0;
          break;
        }
      }
      if (Math.hypot(c.x - c.tx, c.z - c.tz) < rules.companion.arriveDistance) {
        if (cmd.kind === "sentry") {
          c.mode = "sentry";
          c.modeTime = cmd.duration;
        } else if (cmd.kind === "well") {
          c.mode = "well";
          c.modeTime = cmd.duration;
          ctx.events.push({ t: "companionWell", unit: c.id, x: c.x, z: c.z, radius: cmd.radius, duration: cmd.duration });
        } else if (cmd.kind === "pounce") {
          const t = nearestEnemy(
            ctx,
            c,
            enemies.filter((e) => e.kind === "champion"),
            cmd.searchRange,
            false,
          );
          if (!t) return leave(ctx, c);
          c.mode = "engage";
          c.modeTime = cmd.searchEngageTime;
          c.target = t.id;
        } else return leave(ctx, c);
      }
      break;
    }
    case "sentry": {
      gx = c.tx;
      gz = c.tz;
      c.modeTime -= dt;
      const cmd = def.command;
      if (fight && cmd.kind === "sentry" && c.attackTimer <= 0) {
        const t = nearestEnemy(ctx, c, enemies, cmd.range, true);
        if (t) {
          shoot(ctx, c, def, t);
          c.attackTimer = cmd.interval;
        }
      }
      if (c.modeTime <= 0) return leave(ctx, c);
      break;
    }
    case "engage": {
      target = c.target >= 0 ? unitById(state, c.target) : undefined;
      c.modeTime -= dt;
      const leash = def.attack.kind === "melee" ? def.attack.leash : Infinity;
      if (!target || target.dead || c.modeTime <= 0 || Math.hypot(c.x - owner.x, c.z - owner.z) > leash) return leave(ctx, c);
      gx = target.x;
      gz = target.z;
      speed = def.moveSpeed * rules.companion.engageSpeedFactor;
      if (fight && def.attack.kind === "melee" && c.attackTimer <= 0 && Math.hypot(target.x - c.x, target.z - c.z) < c.radius + target.radius + rules.companion.bitePad) {
        hurt(ctx, target, def.attack.damage, c, { from: { x: c.x, z: c.z } });
        ctx.events.push({ t: "companionAttack", unit: c.id, target: target.id, heavy: false, x: target.x, z: target.z });
        c.attackTimer = def.attack.interval;
      }
      break;
    }
    case "roll":
      roll(ctx, c, def, enemies);
      finish();
      return;
    case "cover":
      c.modeTime -= dt;
      if (c.modeTime <= 0) return leave(ctx, c);
      pushOut(ctx, c, def.flying);
      finish();
      return;
    case "well":
      c.modeTime -= dt;
      well(ctx, c, def, owner, enemies);
      if (c.modeTime <= 0) return leave(ctx, c);
      finish();
      return;
  }

  let stepLen = 0;
  let sx = 0;
  let sz = 0;
  if (c.root <= 0) {
    const dx = gx - c.x;
    const dz = gz - c.z;
    const d = Math.hypot(dx, dz);
    const stop = target ? c.radius + target.radius + 0.1 : 0.05;
    if (d > stop) {
      stepLen = Math.min(d - stop, speed * state.tuning.moveSpeed * slowFactor(c) * dt);
      sx = dx / d;
      sz = dz / d;
      c.x += sx * stepLen;
      c.z += sz * stepLen;
    }
  }
  const n = pushOut(ctx, c, def.flying);
  const nl = Math.hypot(n.x, n.z);
  if (stepLen > 0 && nl > 0) {
    // Head-on into an obstacle: slide around it on the side that leads toward the goal.
    const ux = n.x / nl;
    const uz = n.z / nl;
    if (-(sx * ux + sz * uz) > 0.5) {
      if (c.slideTime <= 0) c.slideDir = -uz * (gx - c.x) + ux * (gz - c.z) >= 0 ? 1 : -1;
      c.slideTime = SLIDE_TIME;
      c.x += -uz * c.slideDir * stepLen;
      c.z += ux * c.slideDir * stepLen;
      pushOut(ctx, c, def.flying);
    }
  }
  if (c.slideTime > 0) c.slideTime -= dt;

  // A walking companion never steps off the floor by itself (it can still be thrown off, or have the floor drop
  // from under it). It walks along the edge of the hole until the way is clear, or gives up there.
  if (!def.flying && !safeAt(state, c.x, c.z) && safeAt(state, ox, oz)) {
    c.x = ox;
    c.z = oz;
    if (stepLen > 0) {
      for (const k of [1, -1]) {
        const px = ox - sz * k * stepLen;
        const pz = oz + sx * k * stepLen;
        if (!safeAt(state, px, pz)) continue;
        c.x = px;
        c.z = pz;
        pushOut(ctx, c, false);
        break;
      }
    }
    // A command to a spot it cannot reach ends at the edge.
    if (c.mode === "go" && c.x === ox && c.z === oz) return leave(ctx, c);
  }

  const mx = c.x - ox;
  const mz = c.z - oz;
  let ta: number | null = Math.hypot(mx, mz) > 0.01 * (dt * 60) ? Math.atan2(mx, mz) : null;
  if (target) ta = Math.atan2(target.x - c.x, target.z - c.z);
  if (ta !== null) c.face += angleDiff(ta, c.face) * Math.min(1, dt * TURN_RATE);
  finish();
}
