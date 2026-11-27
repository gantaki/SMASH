// @smash/sim — deterministic game simulation shared by client and server.
// createMatch(config) → state; step(state, inputs) → events. See docs/GAME_DESIGN.md §5.1.

export * from "./math.ts";
export * from "./rng.ts";
export * from "./tick.ts";
export * from "./events.ts";
export * from "./state.ts";
export { step, trainingCommand, type TrainingCommand } from "./match.ts";
export { abilityOf, canAct, isReady } from "./abilities.ts";
export { currentSlow, isUnstoppable } from "./combat.ts";
export { blocker, clearLine, obstacleDistance, polylineDistance, reach } from "./geometry.ts";
export { runBotMatch, type BotMatchOptions, type MatchResult } from "./headless.ts";
