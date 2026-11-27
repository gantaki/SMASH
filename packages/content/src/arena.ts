import type { ArenaConfig, MatchRules } from "./types.ts";

export const arena: ArenaConfig = {
  radius: 20,
  spawns: [
    { x: 0, z: 10 },
    { x: 0, z: -10 },
  ],
  pillars: [
    { x: 7.5, z: 7.5, radius: 1.3 },
    { x: -7.5, z: 7.5, radius: 1.3 },
    { x: 7.5, z: -7.5, radius: 1.3 },
    { x: -7.5, z: -7.5, radius: 1.3 },
  ],
  orb: {
    spawnAt: 15,
    hp: 40,
    radius: 0.9,
    respawnDelay: 20,
    reward: { heal: 20, energy: 25 },
  },
  zone: {
    startAt: 70,
    shrinkSpeed: 0.5,
    minRadius: 5,
    damage: 5,
    tickInterval: 0.5,
  },
};

export const rules: MatchRules = {
  tickRate: 30,
  roundsToWin: 2,
  countdown: 3,
  roundEndDelay: 2.6,
  inputBuffer: 0.25,
  energy: { max: 100, perDamage: 0.55, passivePerSecond: 1.2 },
};
