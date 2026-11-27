import { describe, expect, it } from "vitest";
import { ABILITY_SLOTS, arena, championList, type OnHit } from "./index.ts";

const validOnHit = (h: OnHit) => {
  expect(h.damage).toBeGreaterThanOrEqual(0);
  if (h.stun !== undefined) expect(h.stun).toBeGreaterThan(0);
  if (h.slow) expect(h.slow.amount).toBeGreaterThan(0);
  if (h.slow) expect(h.slow.amount).toBeLessThan(1);
};

describe("champion content", () => {
  it("has unique champion and ability ids", () => {
    const ids = championList.flatMap((c) => [c.id, ...ABILITY_SLOTS.map((s) => c.abilities[s].id)]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const c of championList) {
    describe(c.name, () => {
      it("fills every slot with an ability of that slot", () => {
        for (const slot of ABILITY_SLOTS) expect(c.abilities[slot].slot).toBe(slot);
      });

      it("uses energy for the ultimate and cooldowns for the rest", () => {
        for (const slot of ABILITY_SLOTS) {
          const a = c.abilities[slot];
          if (slot === "ultimate") {
            expect(a.energyCost).toBe(100);
            expect(a.cooldown).toBe(0);
          } else {
            expect(a.energyCost).toBeUndefined();
            expect(a.cooldown).toBeGreaterThan(0);
          }
        }
      });

      it("has sane numbers", () => {
        expect(c.hp).toBeGreaterThan(0);
        expect(c.moveSpeed).toBeGreaterThan(0);
        for (const slot of ABILITY_SLOTS) {
          const a = c.abilities[slot];
          if (a.castTime !== undefined) expect(a.castMoveMultiplier).toBeDefined();
          if ("onHit" in a) validOnHit(a.onHit);
          if (a.kind === "projectile") expect(a.range).toBeLessThan(arena.radius * 2);
        }
      });
    });
  }
});
