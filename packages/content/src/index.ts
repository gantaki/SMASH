import { dummy } from "./champions/dummy.ts";
import { pyra } from "./champions/pyra.ts";
import { grakk } from "./champions/grakk.ts";
import { cairn } from "./champions/cairn.ts";
import { lune } from "./champions/lune.ts";
import type { Ability, Champion } from "./types.ts";

export * from "./types.ts";
export { arena, rules, defaultTuning } from "./arena.ts";
export { botDifficulty, BOT_DIFFICULTIES, training } from "./bots.ts";
export { wisp, hound, boulder, moon } from "./companions.ts";
export { pyra, grakk, cairn, lune, dummy };

/** Register a new champion here; everything else (sim, bots, UI) picks it up from this map. */
export const champions = { pyra, grakk, cairn, lune, dummy } satisfies Record<string, Champion>;

export type ChampionId = keyof typeof champions;

export const championList: readonly Champion[] = Object.values(champions);

/** Champions a player can pick. */
export const playableChampions: readonly Champion[] = championList.filter((c) => c.playable);

export const isChampionId = (id: string): id is ChampionId => Object.hasOwn(champions, id);

export const getChampion = (id: string): Champion => {
  const c = (champions as Record<string, Champion>)[id];
  if (!c) throw new Error(`Unknown champion: ${id}`);
  return c;
};

const abilityIndex = new Map<string, Ability>();
for (const c of championList) for (const a of Object.values(c.abilities)) if (a) abilityIndex.set(a.id, a);

/** Looks an ability up by its id ("pyra.fireBolt"). Presentation uses it to resolve events to data. */
export const abilityById = (id: string): Ability | undefined => abilityIndex.get(id);
