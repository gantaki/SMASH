// The tick: phases, input, systems in a fixed order, round and match flow.

import { rules, training, type AbilitySlot, type Tuning } from "@smash/content";
import { tryCast } from "./abilities.ts";
import { botInput } from "./bot.ts";
import { updateCompanion } from "./companions.ts";
import type { Ctx } from "./context.ts";
import type { SimEvent } from "./events.ts";
import { startSuddenDeath, stopSuddenDeath, updateOrb, updateSuddenDeath } from "./hazards.ts";
import { updateObstacles } from "./obstacles.ts";
import { updateGrounds, updateProjectiles } from "./projectiles.ts";
import { createRng } from "./rng.ts";
import { emptyInput, resetChampion, resetCompanion, startRound, type ChampionUnit, type MatchState, type PlayerInput, type Team } from "./state.ts";
import { TICK_DT } from "./tick.ts";
import { collide, updateChampion } from "./units.ts";

const finite = (v: number): number => (Number.isFinite(v) ? v : 0);

function applyInput(ctx: Ctx, u: ChampionUnit, input: PlayerInput): void {
  let mx = finite(input.move.x);
  let mz = finite(input.move.z);
  const l = Math.hypot(mx, mz);
  if (l > 1) {
    mx /= l;
    mz /= l;
  }
  u.move = { x: mx, z: mz };
  u.aim = { x: finite(input.aim.x), z: finite(input.aim.z) };
  const phase = ctx.state.phase;
  if (phase !== "fight" && phase !== "countdown") {
    u.buffer = null;
    return;
  }
  const pressed: AbilitySlot | undefined = input.press[input.press.length - 1];
  if (pressed) u.buffer = { slot: pressed, time: rules.inputBuffer };
  if (u.buffer) {
    if (tryCast(ctx, u, u.buffer.slot)) u.buffer = null;
    else {
      u.buffer.time -= ctx.dt;
      if (u.buffer.time <= 0) u.buffer = null;
    }
  } else if (input.holdPrimary) {
    tryCast(ctx, u, "primary");
  }
}

function dummyInput(state: MatchState, u: ChampionUnit): PlayerInput {
  const input = emptyInput();
  input.aim = { x: u.x + Math.sin(u.face), z: u.z + Math.cos(u.face) };
  const t = state.training;
  if (!t.dummyMoves) return input;
  t.dummyTime -= TICK_DT;
  if (t.dummyTime <= 0) {
    t.dummyTime = training.dummy.strafeInterval;
    t.dummyDir = t.dummyDir === 1 ? -1 : 1;
  }
  input.move = { x: t.dummyDir, z: 0 };
  return input;
}

function updateTraining(ctx: Ctx): void {
  const { state } = ctx;
  for (const u of state.units) {
    if (u.kind !== "champion") continue;
    if (u.dead) {
      if (u.deadTime < training.respawn) continue;
      const spawn = u.controller === "dummy" ? training.dummy.spawn : { x: u.x, z: u.z };
      const energy = u.energy;
      const cooldowns = u.cooldowns;
      resetChampion(u, spawn.x, spawn.z, u.face);
      u.energy = energy;
      u.cooldowns = cooldowns;
      ctx.events.push({ t: "respawn", unit: u.id });
    } else if (u.hp < u.maxHp && state.roundTime - u.lastHurtAt > training.dummy.regenDelay) {
      u.hp = u.maxHp;
    }
  }
}

function endRound(ctx: Ctx, winner: Team | -1): void {
  const { state } = ctx;
  state.phase = "roundEnd";
  state.phaseTime = rules.roundEndDelay;
  if (winner !== -1) state.score[winner]++;
  ctx.events.push({ t: "roundEnd", winner, score: [state.score[0], state.score[1]] });
  ctx.events.push({ t: "phase", phase: "roundEnd", round: state.round });
}

function updatePhase(ctx: Ctx): void {
  const { state, dt } = ctx;
  if (state.phase === "countdown") {
    state.phaseTime -= dt;
    const n = Math.ceil(state.phaseTime);
    if (n !== state.lastCount && n >= 1) {
      state.lastCount = n;
      ctx.events.push({ t: "countdown", n });
    }
    if (state.phaseTime <= 0) {
      state.phase = "fight";
      ctx.events.push({ t: "phase", phase: "fight", round: state.round });
    }
  } else if (state.phase === "fight") {
    state.roundTime += dt;
    updateOrb(ctx);
  } else if (state.phase === "roundEnd") {
    state.phaseTime -= dt;
    if (state.phaseTime > 0) return;
    const [a, b] = state.score;
    if (a >= rules.roundsToWin || b >= rules.roundsToWin) {
      state.phase = "matchEnd";
      state.winner = a > b ? 0 : 1;
      ctx.events.push({ t: "matchEnd", winner: state.winner, score: [a, b] });
      ctx.events.push({ t: "phase", phase: "matchEnd", round: state.round });
    } else {
      state.round++;
      startRound(state);
      ctx.events.push({ t: "phase", phase: "countdown", round: state.round });
    }
  }
}

/**
 * Advances the match by one fixed tick (TICK_DT). Mutates `state` in place and returns what happened.
 * `inputs[team]` is used for human-controlled champions; bots and the training dummy make their own.
 * Deterministic: the same state and inputs always give the same result.
 */
export function step(state: MatchState, inputs: readonly [PlayerInput | null, PlayerInput | null]): SimEvent[] {
  if (state.phase === "matchEnd") return [];
  const ctx: Ctx = { state, events: [], rng: createRng(state.rng), dt: TICK_DT };
  const dt = ctx.dt;
  state.tick++;
  updatePhase(ctx);

  const champs = state.units.filter((u): u is ChampionUnit => u.kind === "champion");
  const before = state.units.map((u) => ({ x: u.x, z: u.z }));

  for (const u of champs) {
    if (u.dead) continue;
    const input =
      u.controller === "human" ? (inputs[u.team] ?? emptyInput()) : u.controller === "bot" ? botInput(ctx, u) : dummyInput(state, u);
    applyInput(ctx, u, input);
  }
  for (const u of champs) updateChampion(ctx, u);
  for (const u of state.units) if (u.kind === "companion") updateCompanion(ctx, u);
  collide(ctx);
  updateObstacles(ctx);
  state.units.forEach((u, i) => {
    if (u.kind !== "champion") return;
    u.vx = (u.x - before[i]!.x) / dt;
    u.vz = (u.z - before[i]!.z) / dt;
  });
  updateProjectiles(ctx);
  updateGrounds(ctx);
  if (state.phase === "fight") updateSuddenDeath(ctx);

  if (state.config.mode === "training") updateTraining(ctx);
  else if (state.phase === "fight") {
    const dead = champs.filter((u) => u.dead);
    if (dead.length === champs.length) endRound(ctx, -1);
    else if (dead.length > 0) endRound(ctx, dead[0]!.team === 0 ? 1 : 0);
  }

  state.rng = ctx.rng.state();
  return ctx.events;
}

// ---------- training mode commands ----------

export type TrainingCommand =
  | { t: "resetCooldowns" }
  | { t: "fillEnergy" }
  | { t: "toggleDummyMove" }
  | { t: "toggleSuddenDeath" }
  | { t: "resetArena" }
  | { t: "setTuning"; tuning: Partial<Tuning> };

/** Debug helpers for the practice range. Ignored outside training mode. */
export function trainingCommand(state: MatchState, cmd: TrainingCommand): SimEvent[] {
  if (state.config.mode !== "training") return [];
  const ctx: Ctx = { state, events: [], rng: createRng(state.rng), dt: TICK_DT };
  const champs = state.units.filter((u): u is ChampionUnit => u.kind === "champion");
  switch (cmd.t) {
    case "resetCooldowns":
      for (const u of champs) for (const k of Object.keys(u.cooldowns) as AbilitySlot[]) u.cooldowns[k] = 0;
      break;
    case "fillEnergy":
      for (const u of champs) u.energy = rules.energy.max;
      break;
    case "toggleDummyMove":
      state.training.dummyMoves = !state.training.dummyMoves;
      break;
    case "toggleSuddenDeath":
      if (state.suddenDeath.active) stopSuddenDeath(state);
      else startSuddenDeath(ctx);
      break;
    case "resetArena": {
      const tuning = state.tuning;
      const dummyMoves = state.training.dummyMoves;
      startRound(state);
      state.tuning = tuning;
      state.training.dummyMoves = dummyMoves;
      for (const u of state.units) if (u.kind === "companion") resetCompanion(u, champs.find((c) => c.id === u.owner)!);
      break;
    }
    case "setTuning":
      Object.assign(state.tuning, cmd.tuning);
      break;
  }
  state.rng = ctx.rng.state();
  return ctx.events;
}
