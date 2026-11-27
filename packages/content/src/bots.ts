import type { BotDifficulty, BotDifficultyConfig, TrainingConfig } from "./types.ts";

export const botDifficulty: Record<BotDifficulty, BotDifficultyConfig> = {
  easy: { reaction: 0.5, aimError: 0.55, dodge: 0.2, think: 0.5, lead: 0.3, rate: 0.5, primaryDelay: 0.45 },
  normal: { reaction: 0.3, aimError: 0.28, dodge: 0.5, think: 0.3, lead: 0.7, rate: 0.8, primaryDelay: 0.15 },
  hard: { reaction: 0.15, aimError: 0.1, dodge: 0.82, think: 0.16, lead: 0.95, rate: 1.1, primaryDelay: 0 },
};

export const BOT_DIFFICULTIES: readonly BotDifficulty[] = ["easy", "normal", "hard"];

export const training: TrainingConfig = {
  respawn: 2.5,
  dummy: {
    regenDelay: 3,
    strafeInterval: 1.4,
    spawn: { x: 0, z: -4 },
  },
};
