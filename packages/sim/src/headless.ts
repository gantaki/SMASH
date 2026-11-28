// Runs matches without a renderer: bot-vs-bot batches for balance checks and scripted scenarios for tests.

import type { BotDifficulty } from "@smash/content";
import type { SimEvent } from "./events.ts";
import { step } from "./match.ts";
import { createMatch, type MatchState } from "./state.ts";
import { TICK_DT } from "./tick.ts";

export interface MatchResult {
  winner: 0 | 1 | -1;
  score: [number, number];
  /** Fight time of each finished round, seconds. */
  roundTimes: number[];
  /** Damage dealt to champions, by the dealing team; index 2 = environment (zone, rifts). */
  damage: [number, number, number];
  /** Damage dealt by rifts and the zone alone is damage[2]; rounds that reached sudden death: */
  suddenDeathRounds: number;
  /**
   * Champions that went into the abyss: shoved or dragged there by the enemy (`pushed`), or on their own
   * (`unforced`: walked off, jumped in, or the floor dropped from under them).
   */
  falls: { pushed: number; unforced: number };
  /** Floor tiles that dropped and sections of the arena wall that went, over the whole match. */
  tilesDropped: number;
  rimBroken: number;
  ticks: number;
  events: Record<string, number>;
}

export interface BotMatchOptions {
  seed: number;
  champions: readonly [string, string];
  difficulty?: BotDifficulty | readonly [BotDifficulty, BotDifficulty];
  /** Safety cap in simulated seconds. */
  maxSeconds?: number;
  onEvent?: (e: SimEvent, state: MatchState) => void;
}

export function runBotMatch(opts: BotMatchOptions): MatchResult {
  const diff = opts.difficulty ?? "normal";
  const [d0, d1] = typeof diff === "string" ? [diff, diff] : diff;
  const state = createMatch({
    seed: opts.seed,
    mode: "duel",
    players: [
      { champion: opts.champions[0], controller: "bot", difficulty: d0 },
      { champion: opts.champions[1], controller: "bot", difficulty: d1 },
    ],
  });
  const result: MatchResult = { winner: -1, score: [0, 0], roundTimes: [], damage: [0, 0, 0], suddenDeathRounds: 0, falls: { pushed: 0, unforced: 0 }, tilesDropped: 0, rimBroken: 0, ticks: 0, events: {} };
  const champion = new Set(state.units.filter((u) => u.kind === "champion").map((u) => u.id));
  const teamOf = new Map(state.units.map((u) => [u.id, u.team]));
  const maxTicks = Math.round((opts.maxSeconds ?? 900) / TICK_DT);
  while (state.phase !== "matchEnd" && result.ticks < maxTicks) {
    const roundTime = state.roundTime;
    for (const e of step(state, [null, null])) {
      result.events[e.t] = (result.events[e.t] ?? 0) + 1;
      if (e.t === "damage" && e.targetKind === "champion") result.damage[e.source < 0 ? 2 : (teamOf.get(e.source) ?? 2)] += e.amount;
      if (e.t === "roundEnd") result.roundTimes.push(Math.max(roundTime, state.roundTime));
      if (e.t === "suddenDeath") result.suddenDeathRounds++;
      if (e.t === "fall" && champion.has(e.unit)) result.falls[e.by >= 0 ? "pushed" : "unforced"]++;
      if (e.t === "floorDrop") result.tilesDropped += e.tiles.length;
      if (e.t === "rimBreak") result.rimBroken++;
      opts.onEvent?.(e, state);
    }
    result.ticks++;
  }
  result.winner = state.winner;
  result.score = [state.score[0], state.score[1]];
  return result;
}
