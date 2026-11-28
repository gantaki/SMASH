// Bot AI. Bots play through the same PlayerInput as humans: no cheating, same cooldowns and wind-ups.
// Movement comes from the champion's BotProfile; ability usage is decided per ability *kind*,
// so a new champion built from existing kinds gets a working bot for free.

import {
  ABILITY_SLOTS,
  arena,
  botDifficulty,
  getChampion,
  type Ability,
  type AbilitySlot,
  type BotDifficultyConfig,
} from "@smash/content";
import { abilityOf, canAct, isReady } from "./abilities.ts";
import type { Ctx } from "./context.ts";
import { dropTimeAt, floorTiles, nearestSafe, pathSolid, safeAt, tileAt, voidAlong } from "./floor.ts";
import { blocker, clearLine, obstaclePenetration, polylineDistance, reach, wallBehind } from "./geometry.ts";
import type { Vec2 } from "./math.ts";
import { champions, companionOf, emptyInput, type BotState, type ChampionUnit, type MatchState, type PlayerInput } from "./state.ts";

const EDGE_MARGIN = 3.5;
const OBSTACLE_MARGIN = 1.1;
const RIFT_MARGIN = 1.3;
const AIM_ERROR_SCALE = 0.22;
const DEG = Math.PI / 180;
const CANCEL_SLACK = 0.6;
const CANCEL_RATE = 12;
/** Energy above which a bot stops paying for companion commands and saves for the ultimate. */
const COMMAND_ENERGY_CAP = 60;
/** The turns (degrees) a bot tries, in this order, when the way it wants to go is not safe floor. */
const FLOOR_TURNS = [0, 35, -35, 70, -70, 110, -110, 150, -150, 180];
/** Standing on a tile that drops sooner than the bot can walk off it plus this margin: jump off. */
const FLOOR_PANIC = 0.25;
/** Slots tried for offence, most valuable first. */
const OFFENCE_ORDER: readonly AbilitySlot[] = ["ultimate", "e", "q", "secondary", "mobility", "primary"];

interface Target {
  x: number;
  z: number;
  vx: number;
  vz: number;
  radius: number;
}

function findSlot(b: ChampionUnit, pred: (a: Ability) => boolean): AbilitySlot | null {
  for (const s of ABILITY_SLOTS) {
    const a = abilityOf(b, s);
    if (a && pred(a) && isReady(b, s)) return s;
  }
  return null;
}

/** Aim point leading the target by `time` seconds, with the bot's current aim error. */
function leadAim(b: ChampionUnit, ai: BotState, D: BotDifficultyConfig, t: Target, time: number): Vec2 {
  const px = t.x + t.vx * time * D.lead;
  const pz = t.z + t.vz * time * D.lead;
  const dx = px - b.x;
  const dz = pz - b.z;
  const d = Math.hypot(dx, dz) || 1;
  const e = ai.aimError * d * AIM_ERROR_SCALE;
  return { x: px - (dz / d) * e, z: pz + (dx / d) * e };
}

/** Seconds from pressing the button to the effect reaching a target `dist` away. */
function timeToHit(a: Ability, dist: number, castScale: number, speedScale: number): number {
  const cast = (a.castTime ?? 0) * castScale;
  switch (a.kind) {
    case "projectile":
      return cast + dist / (a.speed * speedScale);
    case "groundAoe":
      return cast + a.delay;
    case "leap":
      return cast + a.duration;
    case "dash":
      return cast + (dist / a.maxRange) * a.duration;
    default:
      return cast;
  }
}

/** Seconds the path is predicted for, in steps of FLOOR_STEP. */
const FLOOR_HORIZON = 0.35;
const FLOOR_STEP = 0.05;
/** Half-width of the strip of floor a bot wants under its path: it does not cut the corner of a missing tile. */
const FLOOR_CLEARANCE = 0.45;

/**
 * How long (seconds, up to FLOOR_HORIZON) a bot stays on safe floor if it steers along `dir` from now on.
 * Follows the same acceleration model as walking (units.ts), so momentum toward a hole is taken into account.
 */
function safeTime(state: MatchState, b: ChampionUnit, dir: Vec2, top: number): number {
  const accel = state.tuning.accelTime > 0 ? top / state.tuning.accelTime : Infinity;
  let x = b.x;
  let z = b.z;
  let vx = b.mvx;
  let vz = b.mvz;
  for (let t = FLOOR_STEP; t <= FLOOR_HORIZON + 1e-9; t += FLOOR_STEP) {
    const dx = dir.x * top - vx;
    const dz = dir.z * top - vz;
    const dv = Math.hypot(dx, dz);
    const max = (dx * vx + dz * vz < 0 ? 2 : 1) * accel * FLOOR_STEP;
    const k = dv <= max ? 1 : max / dv;
    vx += dx * k;
    vz += dz * k;
    x += vx * FLOOR_STEP;
    z += vz * FLOOR_STEP;
    const v = Math.hypot(vx, vz);
    // The strip is as wide across the heading as it is ahead of it.
    const hx = v > 0.1 ? vx / v : dir.x;
    const hz = v > 0.1 ? vz / v : dir.z;
    const c = FLOOR_CLEARANCE;
    const ok =
      safeAt(state, x, z) && safeAt(state, x + hx * c, z + hz * c) && safeAt(state, x - hz * c, z + hx * c) && safeAt(state, x + hz * c, z - hx * c);
    if (!ok) return t - FLOOR_STEP;
  }
  return FLOOR_HORIZON;
}

/** Where to run from a tile that is about to drop: the nearest safe tile with a straight, open way to it (any safe tile if there is none). */
function escapeTile(state: MatchState, b: ChampionUnit): Vec2 | null {
  const byDistance = floorTiles
    .filter((_, i) => state.floor.hp[i]! > 0)
    .map((t) => ({ t, d: Math.hypot(t.x - b.x, t.z - b.z) }))
    .sort((p, q) => p.d - q.d);
  for (const { t } of byDistance.slice(0, 24)) {
    if (pathSolid(state, b.x, b.z, t.x, t.z) && !blocker(state, b, t)) return t;
  }
  return nearestSafe(state, b.x, b.z, true);
}

/**
 * Keeps a bot on the floor: turns the wanted direction away from holes, crumbling tiles and gaps in the wall,
 * and walks off a crumbling tile by the shortest way. `side` picks which way it turns first.
 */
function steerOnFloor(state: MatchState, b: ChampionUnit, move: Vec2, side: 1 | -1): Vec2 {
  if (!safeAt(state, b.x, b.z)) {
    // The tile under the bot is going: head for the nearest floor that is not, by a way that is floor and not walled off.
    const t = escapeTile(state, b);
    if (!t) return move;
    const d = Math.hypot(t.x - b.x, t.z - b.z) || 1;
    return { x: (t.x - b.x) / d, z: (t.z - b.z) / d };
  }
  const top = getChampion(b.champion).stats.moveSpeed * state.tuning.moveSpeed;
  const l = Math.hypot(move.x, move.z);
  const stop = { x: 0, z: 0 };
  if (l < 0.05) {
    // Standing still, or drifting to a stop: fine unless the drift ends in a hole.
    if (safeTime(state, b, stop, top) >= FLOOR_HORIZON) return move;
  }
  const base = l < 0.05 ? Math.atan2(-b.mvx, -b.mvz) : Math.atan2(move.x, move.z);
  let best = stop;
  let bestTime = l < 0.05 ? -1 : safeTime(state, b, stop, top) - 1e-6;
  for (const turn of FLOOR_TURNS) {
    const a = base + turn * DEG * side;
    const dir = { x: Math.sin(a), z: Math.cos(a) };
    const time = safeTime(state, b, dir, top);
    if (time >= FLOOR_HORIZON) return dir;
    if (time > bestTime) {
      bestTime = time;
      best = dir;
    }
  }
  // Nothing is safe for long: take whatever keeps the bot on the floor longest.
  return best;
}

export function botInput(ctx: Ctx, b: ChampionUnit): PlayerInput {
  const { state, rng, dt } = ctx;
  const input = emptyInput();
  input.aim = { ...b.aim };
  // The enemy this bot fights: the nearest one still standing.
  const foes = champions(state).filter((c) => c.team !== b.team && !c.dead);
  const p = foes.reduce<ChampionUnit | null>((best, c) => (!best || Math.hypot(c.x - b.x, c.z - b.z) < Math.hypot(best.x - b.x, best.z - b.z) ? c : best), null);
  if (state.phase !== "fight" || b.dead || !p) return input;

  const D = botDifficulty[state.config.players[b.slot]!.difficulty ?? "normal"];
  const ai = state.bots[b.slot]!;
  const profile = getChampion(b.champion).bot;
  const ranged = profile.style === "ranged";
  // A knockback travels its distance divided by the target's weight (combat.ts, knock).
  const shoveWeight = getChampion(p.champion).stats.weight;
  const press = (slot: AbilitySlot, aim: Vec2): PlayerInput => {
    input.press = [slot];
    input.aim = aim;
    return input;
  };
  /**
   * A blink, a leap or a charge toward `aim`, unless it would end on a hole or on a tile that is about to drop.
   * A charge stays on the ground, so the whole way has to be floor.
   */
  const jump = (slot: AbilitySlot, aim: Vec2): PlayerInput | null => {
    const a = abilityOf(b, slot);
    if (a?.kind !== "blink" && a?.kind !== "leap" && a?.kind !== "dash") return null;
    const land = reach(b, aim, a.maxRange);
    if (!safeAt(state, land.x, land.z)) return null;
    if (a.kind === "dash" && !pathSolid(state, b.x, b.z, land.x, land.z)) return null;
    return press(slot, aim);
  };
  /** The way the enemy would be shoved from here leads into the abyss: over a hole, or out through a gap in the wall. */
  const ringOut = (dist: number): boolean => voidAlong(state, p.x, p.z, nx, nz, dist);

  const dx = p.x - b.x;
  const dz = p.z - b.z;
  const d = Math.hypot(dx, dz) || 0.001;
  const nx = dx / d;
  const nz = dz / d;

  ai.think -= dt;
  if (ai.think <= 0) {
    ai.think = D.think * rng.range(0.7, 1.3);
    ai.aimError = rng.range(-1, 1) * D.aimError;
  }
  ai.strafeTime -= dt;
  if (ai.strafeTime <= 0) {
    ai.strafe = ai.strafe === 1 ? -1 : 1;
    ai.strafeTime = rng.range(0.5, 1.5);
  }

  // ---------- movement ----------
  let fx = 0;
  let fz = 0;
  const los = clearLine(state, b, p);
  if (ranged) {
    if (d > profile.keepRange.max + 1.5) {
      fx += nx;
      fz += nz;
    } else if (d < profile.keepRange.min + 1) {
      fx -= nx * 1.3;
      fz -= nz * 1.3;
    }
    const s = los ? 1 : 2.2;
    fx += -nz * ai.strafe * s;
    fz += nx * ai.strafe * s;
  } else {
    if (d > profile.keepRange.max) {
      fx += nx;
      fz += nz;
    }
    const s = d > 4 ? 0.45 : 0.9;
    fx += -nz * ai.strafe * s;
    fz += nx * ai.strafe * s;
  }
  // Stay away from the wall / the closing zone.
  const bc = Math.hypot(b.x, b.z) || 0.001;
  const lim = (state.suddenDeath.active ? state.suddenDeath.zoneRadius : arena.radius) - EDGE_MARGIN;
  if (bc > lim) {
    const k = (bc - lim) * 0.8 + 0.6;
    fx -= (b.x / bc) * k;
    fz -= (b.z / bc) * k;
  }
  for (const o of state.obstacles) {
    const pen = obstaclePenetration(o, b.x, b.z, b.radius + OBSTACLE_MARGIN);
    if (pen) {
      fx += pen.nx;
      fz += pen.nz;
    }
  }
  // Rifts: get off a crack that is erupting or about to.
  const riftCfg = arena.suddenDeath.rifts;
  for (const r of state.rifts) {
    const hot = r.phase === "erupt" || (r.phase === "warn" && r.total - r.time > D.reaction);
    if (!hot) continue;
    const pad = riftCfg.halfWidth + RIFT_MARGIN;
    if (polylineDistance(r.points, b.x, b.z) > pad) continue;
    // Numerical gradient of the distance field: the direction that leaves the crack fastest.
    const e = 0.3;
    const gx = polylineDistance(r.points, b.x + e, b.z) - polylineDistance(r.points, b.x - e, b.z);
    const gz = polylineDistance(r.points, b.x, b.z + e) - polylineDistance(r.points, b.x, b.z - e);
    const gl = Math.hypot(gx, gz);
    if (gl > 1e-4) {
      fx += (gx / gl) * 3;
      fz += (gz / gl) * 3;
    } else {
      fx += -nz * ai.strafe * 3;
      fz += nx * ai.strafe * 3;
    }
  }

  const acting = canAct(ctx, b);
  // The guard a bot raises against a hit it sees coming: a counter stance, or bracing. Not on a tile that is cracked
  // or about to drop: braced, it could not step off when the next ground strike takes the tile.
  const firm = state.floor.hp[tileAt(b.x, b.z)] === arena.floor.hp;
  const counterSlot = findSlot(b, (a) => a.kind === "counter" || (a.kind === "brace" && firm));
  const mobilitySlot = b.root > 0 ? null : findSlot(b, (a) => a.kind === "blink" || a.kind === "leap" || a.kind === "dash");
  const novaSlot = findSlot(b, (a) => a.kind === "nova");
  const hoverSlot = findSlot(b, (a) => a.kind === "hover");
  const swapSlot = b.root > 0 ? null : findSlot(b, (a) => a.kind === "swap");

  // ---------- dodge projectiles ----------
  ai.seen = ai.seen.filter((id) => state.projectiles.some((pr) => pr.id === id));
  for (const pr of state.projectiles) {
    if (pr.team === b.team || ai.seen.includes(pr.id)) continue;
    const rx = b.x - pr.x;
    const rz = b.z - pr.z;
    const v2 = pr.vx * pr.vx + pr.vz * pr.vz;
    const tca = (rx * pr.vx + rz * pr.vz) / v2;
    if (tca < 0 || tca > 0.9) continue;
    const cx = pr.x + pr.vx * tca - b.x;
    const cz = pr.z + pr.vz * tca - b.z;
    if (Math.hypot(cx, cz) > pr.radius + b.radius + 0.4 || pr.age < D.reaction * 0.5) continue;
    ai.seen.push(pr.id);
    if (rng.next() > D.dodge) continue;
    const vl = Math.sqrt(v2);
    let px = -pr.vz / vl;
    let pz = pr.vx / vl;
    if (px * cx + pz * cz > 0) {
      px = -px;
      pz = -pz;
    }
    ai.dodgeX = px;
    ai.dodgeZ = pz;
    ai.dodgeTime = 0.35;
    if (tca < 0.3 && acting) {
      if (counterSlot && rng.next() < 0.6) return press(counterSlot, p);
      if (mobilitySlot && rng.next() < 0.45) {
        const k = ranged ? -1 : 2;
        const away = jump(mobilitySlot, { x: b.x + px * 6 + nx * k, z: b.z + pz * 6 + nz * k });
        if (away) return away;
      }
    }
  }

  // ---------- react to the enemy winding up ----------
  if (p.cast) {
    if (!ai.castSeen) {
      ai.castSeen = true;
      if (rng.next() < D.dodge * 0.8) {
        const s = rng.next() < 0.5 ? 1 : -1;
        ai.dodgeX = -nz * s;
        ai.dodgeZ = nx * s;
        ai.dodgeTime = 0.5;
      }
    }
    const enemyAbility = abilityOf(p, p.cast.slot);
    const threatening = enemyAbility && enemyAbility.kind !== "groundAoe" && d < 12;
    if (counterSlot && acting && threatening && p.cast.time < 0.2 && rng.next() < D.dodge * 0.4) return press(counterSlot, p);
    // A heavy shot is being wound up from a distance: put a wall in its way.
    const wallSlot = findSlot(b, (a) => a.kind === "wall");
    const heavyShot = enemyAbility?.kind === "projectile" && p.cast.slot !== "primary";
    if (wallSlot && acting && heavyShot && d > 4.5 && rng.next() < D.dodge * dt * 12) return press(wallSlot, { x: b.x + nx * 2.4, z: b.z + nz * 2.4 });
    // A shove or a hook is coming: float through it.
    const moves = enemyAbility && "onHit" in enemyAbility && (enemyAbility.onHit.knockback || enemyAbility.onHit.pull);
    if (hoverSlot && acting && moves && d < 12 && p.cast.time < 0.2 && rng.next() < D.dodge * 0.5) return press(hoverSlot, p);
  } else ai.castSeen = false;
  // Someone is about to land on the bot: brace for it.
  if (p.leap && counterSlot && acting && abilityOf(b, counterSlot)?.kind === "brace") {
    const lands = Math.hypot(p.leap.x1 - b.x, p.leap.z1 - b.z) < 3 && p.leap.duration - p.leap.t < 0.3;
    if (lands && rng.next() < D.dodge) return press(counterSlot, p);
  }

  // ---------- leave ground markers ----------
  for (const g of state.grounds) {
    if (g.team === b.team) continue;
    const gx = b.x - g.x;
    const gz = b.z - g.z;
    const gd = Math.hypot(gx, gz);
    if (gd >= g.radius + b.radius + 0.4 || g.t <= D.reaction) continue;
    const ex = gd > 0.05 ? gx / gd : 1;
    const ez = gd > 0.05 ? gz / gd : 0;
    fx += ex * 3;
    fz += ez * 3;
    if (acting && mobilitySlot && g.delay - g.t < 0.35 && rng.next() < D.dodge * 0.15) {
      const away = jump(mobilitySlot, { x: b.x + ex * 6, z: b.z + ez * 6 });
      if (away) return away;
    }
  }

  // ---------- ranged champions peel when the enemy is on top of them ----------
  const shoveSlot = findSlot(b, (a) => a.kind === "cone" && !!a.onHit.knockback);
  if (ranged && d < 3.3 && acting) {
    const cone = shoveSlot ? abilityOf(b, shoveSlot) : undefined;
    if (shoveSlot && cone?.kind === "cone" && d < cone.range) {
      const reachK = cone.onHit.knockback!.distance / shoveWeight;
      if (rng.next() < D.dodge * dt * (ringOut(reachK) ? 30 : 10)) return press(shoveSlot, p);
    } else if (novaSlot) {
      const a = abilityOf(b, novaSlot)!;
      const reachK = a.kind === "nova" && a.onHit.knockback ? a.onHit.knockback.distance / shoveWeight : 0;
      const rate = ringOut(reachK) ? 30 : wallBehind(state, b, p, reachK) ? 16 : 8;
      if (rng.next() < D.dodge * dt * rate) return press(novaSlot, p);
    } else if (mobilitySlot && rng.next() < D.dodge * dt * 4) {
      const tx = b.x - nx * 7;
      const tz = b.z - nz * 7;
      const inside = Math.hypot(tx, tz) < arena.radius - 2;
      const away = jump(mobilitySlot, inside ? { x: tx, z: tz } : { x: b.x - nz * 7 * ai.strafe, z: b.z + nx * 7 * ai.strafe });
      if (away) return away;
    }
  }

  if (ai.dodgeTime > 0) {
    ai.dodgeTime -= dt;
    fx = fx * 0.35 + ai.dodgeX * 2.2;
    fz = fz * 0.35 + ai.dodgeZ * 2.2;
  }
  const fl = Math.hypot(fx, fz);
  if (fl > 0.05) input.move = { x: fx / fl, z: fz / fl };

  // ---------- stay on the floor ----------
  input.move = steerOnFloor(state, b, input.move, ai.strafe);
  const dropIn = dropTimeAt(state, b.x, b.z);
  if (dropIn < Infinity && acting && mobilitySlot) {
    // The tile underfoot is crumbling and walking will not make it: jump to the nearest floor.
    const t = nearestSafe(state, b.x, b.z);
    const speed = getChampion(b.champion).stats.moveSpeed * state.tuning.moveSpeed;
    if (t && (Math.hypot(t.x - b.x, t.z - b.z) / speed > dropIn - FLOOR_PANIC || !pathSolid(state, b.x, b.z, t.x, t.z))) {
      const away = jump(mobilitySlot, t);
      if (away) return away;
    }
  }
  if (dropIn < Infinity && acting && (swapSlot || hoverSlot)) {
    const t = nearestSafe(state, b.x, b.z);
    const speed = getChampion(b.champion).stats.moveSpeed * state.tuning.moveSpeed;
    if (t && Math.hypot(t.x - b.x, t.z - b.z) / speed > dropIn - FLOOR_PANIC) {
      // Walking will not make it. Trade places with the enemy, who gets the tile that is going; or float off it.
      const sw = swapSlot ? abilityOf(b, swapSlot) : undefined;
      if (swapSlot && sw?.kind === "swap" && d < sw.maxRange && safeAt(state, p.x, p.z) && clearLine(state, b, p)) return press(swapSlot, p);
      if (hoverSlot && dropIn < 0.4) return press(hoverSlot, t);
    }
  }

  // ---------- pick a target ----------
  let tgt: Target = p;
  let targetIsEnemy = true;
  const orb = state.orb;
  if (orb.alive) {
    const od = Math.hypot(orb.x - b.x, orb.z - b.z);
    if ((od < 12 && (d > 11 || orb.hp <= 15)) || (od < 3 && !ranged)) {
      tgt = { x: orb.x, z: orb.z, vx: 0, vz: 0, radius: orb.radius };
      targetIsEnemy = false;
    }
  }
  const enemyPet = companionOf(state, p);
  if (enemyPet && !enemyPet.dead && Math.hypot(enemyPet.x - b.x, enemyPet.z - b.z) < 3.5 && (ranged || d > 4)) {
    tgt = enemyPet;
    targetIsEnemy = false;
  }
  const td = Math.hypot(tgt.x - b.x, tgt.z - b.z);
  const castScale = state.tuning.castTime;
  const speedScale = state.tuning.projectileSpeed;

  // While winding up, keep tracking the target with the right lead for that ability.
  if (b.cast) {
    const a = abilityOf(b, b.cast.slot);
    const left = a ? timeToHit(a, td, 0, speedScale) + b.cast.time : 0;
    input.aim = leadAim(b, ai, D, tgt, left);
    // Cancel a wind-up that can no longer connect: the target walked out of a melee arc or behind stone.
    const wasted =
      (a?.kind === "cone" && td > a.range + tgt.radius + CANCEL_SLACK) ||
      (a?.kind === "projectile" && blocker(state, b, tgt)?.kind === "stone");
    if (wasted && b.cancelLock <= 0 && rng.next() < D.dodge * dt * CANCEL_RATE) input.cancel = true;
    return input;
  }
  input.aim = { x: tgt.x, z: tgt.z };

  // ---------- companion ----------
  const pet = companionOf(state, b);
  const cmdSlot = findSlot(b, (a) => a.kind === "companionCommand");
  const petDef = getChampion(b.champion).companion;
  if (pet && petDef) {
    // A companion is summoned by its command. It is paid from the first part of the bar; above the cap the bot saves
    // for the ultimate. One that is already out is left to finish what it is doing.
    const free = pet.dead && pet.respawn <= 0;
    if (cmdSlot && free && isReady(b, cmdSlot) && b.energy < COMMAND_ENERGY_CAP && rng.next() < dt * 0.9 * D.rate) {
      const cmd = petDef.command;
      if (cmd.kind === "sentry" && d < 12) return press(cmdSlot, { x: p.x - nz * 3 * ai.strafe, z: p.z + nx * 3 * ai.strafe });
      if (cmd.kind === "pounce" && d > 3 && d < cmd.maxRange) return press(cmdSlot, leadAim(b, ai, D, p, d / petDef.commandSpeed));
      // A boulder rolls straight: only over floor, and with a clear run at the enemy.
      if (cmd.kind === "roll" && d > 2.5 && d < cmd.maxRange && clearLine(state, b, p) && pathSolid(state, b.x, b.z, p.x, p.z)) {
        return press(cmdSlot, leadAim(b, ai, D, p, d / petDef.commandSpeed));
      }
      // A well goes just behind the enemy, to drag them away from where they want to be (and toward the bot's crates).
      if (cmd.kind === "well" && d < cmd.maxRange - 1) return press(cmdSlot, { x: p.x + nx * 1.5, z: p.z + nz * 1.5 });
    }
    // Hook to the companion while it holds the enemy.
    const hookSlot = findSlot(b, (a) => a.kind === "projectile" && a.throughCompanion?.kind === "pullCaster");
    const dry = pathSolid(state, b.x, b.z, pet.x, pet.z);
    if (hookSlot && acting && !pet.dead && pet.mode === "engage" && pet.target === p.id && d > 6 && dry && clearLine(state, b, pet) && rng.next() < dt * 2.5) {
      return press(hookSlot, { x: pet.x, z: pet.z });
    }
  }

  if (!acting) return input;

  // A crate held overhead: throw it as soon as there is a line to the target.
  if (b.held) {
    const liftSlot = ABILITY_SLOTS.find((sl) => abilityOf(b, sl)?.kind === "lift");
    if (liftSlot && !blocker(state, b, tgt) && rng.next() < dt * 8) return press(liftSlot, leadAim(b, ai, D, tgt, td / 17));
  }

  // ---------- offence, by ability kind ----------
  const block = blocker(state, b, tgt);
  const clear = !block;
  const breakable = !!block && block.kind === "wood" && td < 12;
  const controlled = p.stun > 0 || !!p.forced || !!p.cast || p.root > 0;
  for (const slot of OFFENCE_ORDER) {
    const a = abilityOf(b, slot);
    if (!a || !isReady(b, slot)) continue;
    const lead = (dist: number) => leadAim(b, ai, D, tgt, timeToHit(a, dist, castScale, speedScale));
    switch (a.kind) {
      case "groundAoe": {
        if (!targetIsEnemy || d > a.maxRange - (slot === "ultimate" ? 0.5 : 0)) break;
        const chance = slot === "ultimate" ? dt * 0.7 : dt * 0.5 * D.rate;
        if (controlled || (slot !== "ultimate" && p.slow > 0) || rng.next() < chance) return press(slot, lead(d));
        break;
      }
      case "projectile": {
        if (slot === "primary") {
          if ((clear || breakable) && td < a.range + 0.5) return press(slot, lead(td));
        } else if (a.onHit.pull) {
          // A hole between the two of them: the drag ends in it.
          const pit = targetIsEnemy && !pathSolid(state, p.x, p.z, b.x + nx * a.onHit.pull.stopDistance, b.z + nz * a.onHit.pull.stopDistance);
          if (targetIsEnemy && clear && d > 3.5 && d < a.range - 0.5 && rng.next() < dt * (pit ? 5 : 1.1) * D.rate) return press(slot, lead(d));
        } else if (clear && td < a.range - 1 && rng.next() < dt * 1.2 * D.rate) return press(slot, lead(td));
        break;
      }
      case "cone": {
        if (td > a.range + (slot === "primary" ? 0.2 : 0)) break;
        if (slot === "primary") return press(slot, { x: tgt.x, z: tgt.z });
        if (!targetIsEnemy) break;
        const kb = a.onHit.knockback;
        const shove = kb ? kb.distance / shoveWeight : 0;
        const slamChance = kb && (ringOut(shove) ? rng.next() < dt * 25 : wallBehind(state, b, p, shove) && rng.next() < dt * 6);
        if (p.cast || slamChance || rng.next() < dt * 1.2 * D.rate) return press(slot, { x: p.x, z: p.z });
        break;
      }
      case "leap": {
        // Gap closer for melee; ranged champions keep it for escapes.
        if (ranged || !targetIsEnemy || b.root > 0) break;
        if (d > 4.5 && d < a.maxRange + 0.5 && rng.next() < dt * 1.5 * D.rate) {
          const onto = jump(slot, lead(d));
          if (onto) return onto;
        }
        break;
      }
      case "channel": {
        if (targetIsEnemy && d < a.radius + 0.3) return press(slot, p);
        break;
      }
      case "wall": {
        // Behind the enemy, so that the next shove has something to drive them into.
        if (!targetIsEnemy || d > a.maxRange - 2.5 || rng.next() > dt * 0.6 * D.rate) break;
        return press(slot, { x: p.x + nx * 2.2, z: p.z + nz * 2.2 });
      }
      case "dash": {
        if (!targetIsEnemy || b.root > 0 || d > a.maxRange || d < 1.6) break;
        // As far as the floor allows: the charger stops where the charge ends, what it carries goes a little further.
        const run = [a.maxRange, (a.maxRange + d) / 2, d + 0.3].find((len) => {
          const end = { x: b.x + nx * len, z: b.z + nz * len };
          return safeAt(state, end.x, end.z) && pathSolid(state, b.x, b.z, end.x, end.z);
        });
        if (run === undefined) break;
        const carried = run - d + a.carry.beyond;
        const chance = ringOut(carried) ? dt * 25 : wallBehind(state, b, p, carried) ? dt * 6 : dt * 0.9 * D.rate;
        if (rng.next() < chance) return press(slot, { x: b.x + nx * run, z: b.z + nz * run });
        break;
      }
      case "brace": {
        // "Get off me": worth it when the shove at the end has somewhere to send them.
        if (!targetIsEnemy || d > a.radius - 0.4 || !firm) break;
        const shove = a.onHit.knockback ? a.onHit.knockback.distance / shoveWeight : 0;
        const chance = ringOut(shove) ? dt * 20 : wallBehind(state, b, p, shove) ? dt * 5 : dt * 0.7 * D.rate;
        if (rng.next() < chance) return press(slot, p);
        break;
      }
      case "line": {
        if (!targetIsEnemy || d > a.range - 0.5) break;
        if (controlled || p.slow > 0 || rng.next() < dt * 0.9 * D.rate) return press(slot, lead(d));
        break;
      }
      case "ring": {
        // Around both of them when they are close, so that every shove inside is a slam.
        if (!targetIsEnemy || d > a.radius * 1.4 || rng.next() > dt * 0.8) break;
        return press(slot, { x: (b.x + p.x) / 2, z: (b.z + p.z) / 2 });
      }
      case "lift": {
        if (rng.next() > dt * 1.5 * D.rate) break;
        // The nearest crate in reach.
        let crate: { x: number; z: number } | null = null;
        let best = a.range;
        for (const o of state.obstacles) {
          const od = Math.hypot(o.x - b.x, o.z - b.z);
          if (o.kind !== "crate" || !o.alive || od >= best) continue;
          best = od;
          crate = o;
        }
        if (crate) return press(slot, { x: crate.x, z: crate.z });
        break;
      }
      default:
        // blink, nova, counter, hover, swap and companion commands are used reactively above.
        break;
    }
  }
  return input;
}

// Re-exported for tests.
export type { BotState };
