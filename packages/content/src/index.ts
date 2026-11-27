import { ember } from "./champions/ember.ts";
import { fang } from "./champions/fang.ts";
import type { Champion, ChampionId } from "./types.ts";

export * from "./types.ts";
export { arena, rules } from "./arena.ts";
export { ember, fang };

export const champions: Record<ChampionId, Champion> = { ember, fang };

export const championList: readonly Champion[] = Object.values(champions);
