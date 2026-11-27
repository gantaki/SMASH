// Companion AI: follow the owner, attack by default, execute one command. Behaviour is driven by CompanionDef.

import { arena, getChampion, rules, type CompanionDef } from "@smash/content";
import { applyOnHit, hurt, moveForced } from "./combat.ts";
import type { Ctx } from "./context.ts";
import { clearLine, obstaclePenetration, reach } from "./geometry.ts";
import { angleDiff, type Vec2 } from "./math.ts";
import { spawnProjectile } from "./projectiles.ts";
import { championById, enemiesOf, followPoint, resetCompanion, unitById, type ChampionUnit, type CompanionUnit, type Unit } from "./state.ts";

// Path-finding and presentation helpers (not balance): how long to keep sliding around an obstacle, turn smoothing.
const SLIDE_TIME = 0.6;
const TURN_RATE = 12;

export const companionDef = (state: Ctx["state"], c: CompanionUnit): CompanionDef => {
  const owner = championById(state, c.owner)!;
  return getChampion(owner.champion).companion!;
};

export function commandCompanion(ctx: Ctx, c: CompanionUnit, owner: ChampionUnit, aim: Vec2): void {
  const def = companionDef(ctx.state, c);
  const t = reach(owner, aim, def.command.maxRange);
  c.mode = "go";
  c.tx = t.x;
  c.tz = t.z;
  c.target = -1;
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
  const d = Math.hypot(c.x, c.z);
  const R = arena.radius - arena.wallMargin;
  if (d > R) {
    c.x *= R / d;
    c.z *= R / d;
    nx -= c.x / R;
    nz -= c.z / R;
  }
  return { x: nx, z: nz };
}

export function updateCompanion(ctx: Ctx, c: CompanionUnit): void {
  const { state, dt } = ctx;
  const owner = championById(state, c.owner);
  if (!owner) return;
  const def = getChampion(owner.champion).companion!;
  const fight = state.phase === "fight";

  if (c.dead) {
    c.vx = c.vz = 0;
    if (fight) {
      c.respawn -= dt;
      if (c.respawn <= 0 && !owner.dead) {
        resetCompanion(c, owner);
        ctx.events.push({ t: "companionRespawn", unit: c.id });
      }
    }
    return;
  }
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
  if (owner.dead && c.mode !== "follow") {
    c.mode = "follow";
    c.target = -1;
  }

  switch (c.mode) {
    case "follow": {
      const p = followPoint(owner);
      gx = p.x;
      gz = p.z;
      if (!fight || owner.dead) break;
      if (def.attack.kind === "ranged") {
        if (c.attackTimer <= 0) {
          const t = nearestEnemy(ctx, c, enemies, def.attack.range, true);
          if (t) {
            shoot(ctx, c, def, t);
            c.attackTimer = def.attack.interval;
          }
        }
      } else {
        const guard = def.attack;
        const t = enemies.find((e) => e.kind === "champion" && Math.hypot(e.x - owner.x, e.z - owner.z) < guard.guardRange);
        if (t) {
          c.mode = "engage";
          c.modeTime = guard.guardTime;
          c.target = t.id;
        }
      }
      break;
    }
    case "go": {
      gx = c.tx;
      gz = c.tz;
      speed = def.commandSpeed;
      const cmd = def.command;
      if (cmd.kind === "pounce" && fight) {
        const t = enemies.find((e) => e.kind === "champion" && Math.hypot(e.x - c.x, e.z - c.z) < c.radius + e.radius + rules.companion.pounceTouchPad);
        if (t) {
          applyOnHit(ctx, t, cmd.onHit, c, c.x, c.z);
          c.face = Math.atan2(t.x - c.x, t.z - c.z);
          ctx.events.push({ t: "companionAttack", unit: c.id, target: t.id, heavy: true, x: t.x, z: t.z });
          c.mode = "engage";
          c.modeTime = cmd.engageTime;
          c.target = t.id;
          c.attackTimer = def.attack.interval;
          break;
        }
      }
      if (Math.hypot(c.x - c.tx, c.z - c.tz) < rules.companion.arriveDistance) {
        if (cmd.kind === "sentry") {
          c.mode = "sentry";
          c.modeTime = cmd.duration;
        } else {
          const t = nearestEnemy(
            ctx,
            c,
            enemies.filter((e) => e.kind === "champion"),
            cmd.searchRange,
            false,
          );
          if (t) {
            c.mode = "engage";
            c.modeTime = cmd.searchEngageTime;
            c.target = t.id;
          } else c.mode = "follow";
        }
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
      if (c.modeTime <= 0) c.mode = "follow";
      break;
    }
    case "engage": {
      target = c.target >= 0 ? unitById(state, c.target) : undefined;
      c.modeTime -= dt;
      const leash = def.attack.kind === "melee" ? def.attack.leash : Infinity;
      if (!target || target.dead || c.modeTime <= 0 || Math.hypot(c.x - owner.x, c.z - owner.z) > leash) {
        c.mode = "follow";
        c.target = -1;
        target = undefined;
        break;
      }
      gx = target.x;
      gz = target.z;
      speed = def.moveSpeed * rules.companion.engageSpeedFactor;
      if (fight && def.attack.kind === "melee" && c.attackTimer <= 0 && Math.hypot(target.x - c.x, target.z - c.z) < c.radius + target.radius + rules.companion.bitePad) {
        hurt(ctx, target, def.attack.damage, c);
        ctx.events.push({ t: "companionAttack", unit: c.id, target: target.id, heavy: false, x: target.x, z: target.z });
        c.attackTimer = def.attack.interval;
      }
      break;
    }
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
      stepLen = Math.min(d - stop, speed * state.tuning.moveSpeed * (c.slow > 0 ? 1 - c.slowAmount : 1) * dt);
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

  const mx = c.x - ox;
  const mz = c.z - oz;
  let ta: number | null = Math.hypot(mx, mz) > 0.01 * (dt * 60) ? Math.atan2(mx, mz) : null;
  if (target) ta = Math.atan2(target.x - c.x, target.z - c.z);
  if (ta !== null) c.face += angleDiff(ta, c.face) * Math.min(1, dt * TURN_RATE);
  finish();
}
