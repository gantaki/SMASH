import type { CompanionDef } from "./types.ts";

export const wisp: CompanionDef = {
  id: "wisp",
  name: "Wisp",
  nameRu: "Огонёк",
  hp: 40,
  radius: 0.45,
  moveSpeed: 7,
  commandSpeed: 13,
  flying: true,
  follow: { angleDeg: 137, distance: 1.7 },
  attack: {
    kind: "ranged",
    interval: 1.3,
    range: 8,
    projectile: {
      speed: 12,
      range: 10,
      radius: 0.24,
      onHit: { damage: 4 },
      visual: { core: "#ffe8b0", glow: "#ff7a2b", size: 0.15 },
      cratePush: 1,
    },
  },
  command: { kind: "sentry", maxRange: 11, duration: 6, interval: 0.8, range: 9 },
  color: "#ff8a3a",
};

export const hound: CompanionDef = {
  id: "hound",
  name: "Hound",
  nameRu: "Гончая",
  hp: 55,
  radius: 0.5,
  moveSpeed: 7.2,
  commandSpeed: 11,
  flying: false,
  follow: { angleDeg: 137, distance: 1.7 },
  attack: { kind: "melee", interval: 1, damage: 5, guardRange: 4, guardTime: 2.5, leash: 14 },
  command: {
    kind: "pounce",
    maxRange: 11,
    onHit: { damage: 8, root: 0.8 },
    engageTime: 3,
    searchRange: 5,
    searchEngageTime: 2,
  },
  color: "#c9a04a",
};
