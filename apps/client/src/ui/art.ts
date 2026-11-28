// Painted art served from assets/art/ (see CLAUDE.md, Conventions). Keyed by the ids used in content.
// An id without an entry falls back to the line icons in icons.ts, so new content works before its art exists.

const ABILITY_ICON_IDS = ["bolt", "orb", "blink", "ring", "shield", "wisp", "meteor", "cleave", "hook", "leap", "bash", "counter", "paw", "whirl"] as const;
const PORTRAIT_IDS = ["ember", "fang"] as const;

const index = (dir: string, ids: readonly string[]): Record<string, string> => Object.fromEntries(ids.map((id) => [id, `/art/${dir}/${id}.webp`]));

/** Ability icon id → square painted icon. */
export const ABILITY_ART: Record<string, string> = index("abilities", ABILITY_ICON_IDS);

/** Champion id → waist-up cutout on a transparent background. */
export const PORTRAITS: Record<string, string> = index("portraits", PORTRAIT_IDS);

/** Champion id → square close-up for the champion-select tile. */
export const TILES: Record<string, string> = index("tiles", PORTRAIT_IDS);
