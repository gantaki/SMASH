// Drawn art served from assets/art/ (style: docs/ART_STYLE.md, recipe: assets/art/README.md). Keyed by the ids used in content.
// An id without an entry falls back to the line icons in icons.ts, so new content works before its art exists.

const ABILITY_ICON_IDS = [
  ...["bolt", "orb", "blink", "ring", "shield", "wisp", "meteor"],
  ...["cleave", "hook", "leap", "bash", "counter", "paw", "whirl"],
  ...["maul", "wall", "ram", "stoneskin", "shatter", "boulder", "colosseum"],
  ...["shard", "lift", "swap", "float", "surge", "moon", "maelstrom"],
] as const;
const PORTRAIT_IDS = ["ember", "fang", "rook", "tide"] as const;

const index = (dir: string, ids: readonly string[]): Record<string, string> => Object.fromEntries(ids.map((id) => [id, `/art/${dir}/${id}.webp`]));

/** Ability icon id → square drawn icon. */
export const ABILITY_ART: Record<string, string> = index("abilities", ABILITY_ICON_IDS);

/** Champion id → waist-up cutout on a transparent background. */
export const PORTRAITS: Record<string, string> = index("portraits", PORTRAIT_IDS);

/** Champion id → square close-up for the champion-select tile. */
export const TILES: Record<string, string> = index("tiles", PORTRAIT_IDS);

/** Play mode → drawn icon for the menu's mode buttons. */
export const MODE_ART: Record<"duel" | "duel2" | "online" | "training", string> = {
  duel: "/art/ui/mode-duel.webp",
  // 2v2 shares the crossed swords until it has an icon of its own.
  duel2: "/art/ui/mode-duel.webp",
  online: "/art/ui/mode-online.webp",
  training: "/art/ui/mode-training.webp",
};
