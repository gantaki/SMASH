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
import { blocker, clearLine, obstaclePenetration, polylineDistance, wallBehind } from "./geometry.ts";
import type { Vec2 } from "./math.ts";
import { championOfTeam, companionOf, emptyInput, type BotState, type ChampionUnit, type PlayerInput } from "./state.ts";

const EDGE_MARGIN = 3.5;
const OBSTACLE_MARGIN = 1.1;
const RIFT_MARGIN = 1.3;
const AIM_ERROR_SCALE = 0.22;
const CANCEL_SLACK = 0.6;
const CANCEL_RATE = 12;
/** Energy above which a bot stops paying for companion commands and saves for the ultimate. */
const COMMAND_ENERGY_CAP = 60;
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
    default:
      return cast;
  }
}

export function botInput(ctx: Ctx, b: ChampionUnit): PlayerInput {
  const { state, rng, dt } = ctx;
  const input = emptyInput();
  input.aim = { ...b.aim };
  const p = championOfTeam(state, b.team === 0 ? 1 : 0);
  if (state.phase !== "fight" || b.dead || !p || p.dead) return input;

  const D = botDifficulty[state.config.players[b.team].difficulty ?? "normal"];
  const ai = state.bots[b.team];
  const profile = getChampion(b.champion).bot;
  const ranged = profile.style === "ranged";
  // A knockback travels its distance divided by the target's weight (combat.ts, knock).
  const shoveWeight = getChampion(p.champion).stats.weight;
  const press = (slot: AbilitySlot, aim: Vec2): PlayerInput => {
    input.press = [slot];
    input.aim = aim;
    return input;
  };

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
  const counterSlot = findSlot(b, (a) => a.kind === "counter");
  const mobilitySlot = b.root > 0 ? null : findSlot(b, (a) => a.kind === "blink" || a.kind === "leap");
  const novaSlot = findSlot(b, (a) => a.kind === "nova");

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
        return press(mobilitySlot, { x: b.x + px * 6 + nx * k, z: b.z + pz * 6 + nz * k });
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
  } else ai.castSeen = false;

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
      return press(mobilitySlot, { x: b.x + ex * 6, z: b.z + ez * 6 });
    }
  }

  // ---------- ranged champions peel when the enemy is on top of them ----------
  if (ranged && d < 3.3 && acting) {
    if (novaSlot) {
      const a = abilityOf(b, novaSlot)!;
      const reachK = a.kind === "nova" && a.onHit.knockback ? a.onHit.knockback.distance / shoveWeight : 0;
      if (rng.next() < D.dodge * dt * (wallBehind(state, b, p, reachK) ? 16 : 8)) return press(novaSlot, p);
    } else if (mobilitySlot && rng.next() < D.dodge * dt * 4) {
      const tx = b.x - nx * 7;
      const tz = b.z - nz * 7;
      const inside = Math.hypot(tx, tz) < arena.radius - 2;
      return press(mobilitySlot, inside ? { x: tx, z: tz } : { x: b.x - nz * 7 * ai.strafe, z: b.z + nx * 7 * ai.strafe });
    }
  }

  if (ai.dodgeTime > 0) {
    ai.dodgeTime -= dt;
    fx = fx * 0.35 + ai.dodgeX * 2.2;
    fz = fz * 0.35 + ai.dodgeZ * 2.2;
  }
  const fl = Math.hypot(fx, fz);
  if (fl > 0.05) input.move = { x: fx / fl, z: fz / fl };

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
  if (pet && !pet.dead && petDef) {
    // Commands are paid from the first part of the bar; above the cap the bot saves for the ultimate.
    if (cmdSlot && isReady(b, cmdSlot) && b.energy < COMMAND_ENERGY_CAP && rng.next() < dt * 0.9 * D.rate) {
      if (petDef.command.kind === "sentry" && d < 12) return press(cmdSlot, { x: p.x - nz * 3 * ai.strafe, z: p.z + nx * 3 * ai.strafe });
      if (petDef.command.kind === "pounce" && d > 3 && d < petDef.command.maxRange) return press(cmdSlot, leadAim(b, ai, D, p, d / petDef.commandSpeed));
    }
    // Hook to the companion while it holds the enemy.
    const hookSlot = findSlot(b, (a) => a.kind === "projectile" && a.throughCompanion?.kind === "pullCaster");
    if (hookSlot && acting && pet.mode === "engage" && pet.target === p.id && d > 6 && clearLine(state, b, pet) && rng.next() < dt * 2.5) {
      return press(hookSlot, { x: pet.x, z: pet.z });
    }
  }

  if (!acting) return input;

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
          if (targetIsEnemy && clear && d > 3.5 && d < a.range - 0.5 && rng.next() < dt * 1.1 * D.rate) return press(slot, lead(d));
        } else if (clear && td < a.range - 1 && rng.next() < dt * 1.2 * D.rate) return press(slot, lead(td));
        break;
      }
      case "cone": {
        if (td > a.range + (slot === "primary" ? 0.2 : 0)) break;
        if (slot === "primary") return press(slot, { x: tgt.x, z: tgt.z });
        if (!targetIsEnemy) break;
        const kb = a.onHit.knockback;
        const slamChance = kb && wallBehind(state, b, p, kb.distance / shoveWeight) && rng.next() < dt * 6;
        if (p.cast || slamChance || rng.next() < dt * 1.2 * D.rate) return press(slot, { x: p.x, z: p.z });
        break;
      }
      case "leap": {
        // Gap closer for melee; ranged champions keep it for escapes.
        if (ranged || !targetIsEnemy || b.root > 0) break;
        if (d > 4.5 && d < a.maxRange + 0.5 && rng.next() < dt * 1.5 * D.rate) return press(slot, lead(d));
        break;
      }
      case "channel": {
        if (targetIsEnemy && d < a.radius + 0.3) return press(slot, p);
        break;
      }
      default:
        // blink, nova, counter and companion commands are used reactively above.
        break;
    }
  }
  return input;
}

// Re-exported for tests.
export type { BotState };
