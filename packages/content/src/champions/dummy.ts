import type { Champion } from "../types.ts";

/** Training target. No abilities; the sim heals it back up (see training config). */
export const dummy: Champion = {
  id: "dummy",
  // Not a hero: a plain label in the interface's language, like everything else that is not a hero's name.
  name: "Манекен",
  roleRu: "Тренировочная цель",
  blurbRu: "Стоит или ходит из стороны в сторону. Восстанавливает здоровье.",
  playable: false,
  stats: { hp: 300, moveSpeed: 4.2, radius: 0.7, weight: 1 },
  color: "#c9b28f",
  particles: ["#e6d5b8", "#7a5a3a"],
  bot: { style: "melee", keepRange: { min: 0, max: 0 } },
  abilities: {},
};
