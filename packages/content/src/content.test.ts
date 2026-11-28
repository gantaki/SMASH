import { describe, expect, it } from "vitest";
import { ABILITY_SLOTS, abilityById, arena, championList, playableChampions, rules, type Ability, type OnHit } from "./index.ts";

const validOnHit = (h: OnHit) => {
  expect(h.damage).toBeGreaterThanOrEqual(0);
  if (h.stun !== undefined) expect(h.stun).toBeGreaterThan(0);
  if (h.slow) {
    expect(h.slow.amount).toBeGreaterThan(0);
    expect(h.slow.amount).toBeLessThan(1);
  }
  if (h.knockback) expect(h.knockback.duration).toBeGreaterThan(0);
};

const onHits = (a: Ability): OnHit[] => {
  switch (a.kind) {
    case "projectile":
    case "groundAoe":
    case "nova":
      return [a.onHit];
    case "cone":
      return a.empoweredOnHit ? [a.onHit, a.empoweredOnHit] : [a.onHit];
    case "leap":
      return [a.landing.onHit];
    case "counter":
      return [a.punish];
    case "channel":
      return [a.onTick];
    default:
      return [];
  }
};

describe("champion content", () => {
  it("has unique champion and ability ids", () => {
    const ids = championList.flatMap((c) => [c.id, ...Object.values(c.abilities).map((a) => a!.id)]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids.filter((i) => i.includes("."))) expect(abilityById(id)?.id).toBe(id);
  });

  it("has at least two playable champions", () => {
    expect(playableChampions.length).toBeGreaterThanOrEqual(2);
  });

  for (const c of playableChampions) {
    describe(c.name, () => {
      it("fills every slot", () => {
        for (const slot of ABILITY_SLOTS) expect(c.abilities[slot], slot).toBeDefined();
        expect(c.abilities.companion!.kind).toBe("companionCommand");
        expect(c.companion).toBeDefined();
      });

      it("follows the slot roles: Q protects the caster, E is a strike or an area hit (design guide, §3)", () => {
        const q = c.abilities.q!;
        const e = c.abilities.e!;
        // New defensive or offensive ability kinds get added to these lists together with the kind.
        expect(q.kind === "counter" || (q.kind === "nova" && q.shield !== undefined), q.id).toBe(true);
        expect(e.kind === "cone" || e.kind === "groundAoe" || e.kind === "nova", e.id).toBe(true);
      });

      it("can move an enemy: at least one ability knocks back or pulls (knockback is the core mechanic, §2.3)", () => {
        const moves = ABILITY_SLOTS.some((slot) => onHits(c.abilities[slot]!).some((h) => h.knockback !== undefined || h.pull !== undefined));
        expect(moves, c.id).toBe(true);
      });

      it("uses energy for the ultimate, energy and a cooldown for the command, cooldowns for the rest", () => {
        for (const slot of ABILITY_SLOTS) {
          const a = c.abilities[slot]!;
          if (slot === "ultimate") {
            expect(a.energyCost).toBe(rules.energy.max);
            expect(a.cooldown).toBe(0);
          } else if (slot === "companion") {
            // A command costs a quarter of the bar and still has a cooldown.
            expect(a.energyCost).toBe(rules.energy.commandCost);
            expect(a.cooldown).toBeGreaterThan(0);
          } else {
            expect(a.energyCost).toBeUndefined();
            expect(a.cooldown).toBeGreaterThan(0);
          }
        }
      });

      it("has sane numbers", () => {
        expect(c.stats.hp).toBeGreaterThan(0);
        // Playtested band: about 6 m/s feels right; nobody slower than 5.5 or faster than 6.5.
        expect(c.stats.moveSpeed).toBeGreaterThanOrEqual(5.5);
        expect(c.stats.moveSpeed).toBeLessThanOrEqual(6.5);
        // Weight divides knockback distance: light 0.9, heavy 1.2. Outside this band a shove is either nothing or a ring-out.
        expect(c.stats.weight).toBeGreaterThanOrEqual(0.8);
        expect(c.stats.weight).toBeLessThanOrEqual(1.3);
        for (const slot of ABILITY_SLOTS) {
          const a = c.abilities[slot]!;
          if (a.castTime !== undefined) expect(a.castMoveMultiplier, a.id).toBeDefined();
          onHits(a).forEach(validOnHit);
          if (a.kind === "projectile") {
            expect(a.range).toBeLessThan(arena.radius * 2);
            // A projectile must not skip over a champion between two ticks.
            expect(a.speed / rules.tickRate).toBeLessThan(a.radius + c.stats.radius);
          }
        }
      });

      it("keeps every dangerous ability dodgeable (pillar: readable and dodgeable)", () => {
        // From the button press to the hit at mid range there must be time to react and step aside.
        const REACTION = 0.3;
        for (const slot of ["secondary", "e", "ultimate"] as const) {
          const a = c.abilities[slot]!;
          const cast = a.castTime ?? 0;
          if (a.kind === "projectile") expect(cast + a.range / 2 / a.speed, a.id).toBeGreaterThan(REACTION);
          if (a.kind === "groundAoe") expect(cast + a.delay, a.id).toBeGreaterThan(REACTION * 2);
        }
      });
    });
  }
});

describe("arena", () => {
  it("is point-symmetric", () => {
    for (const o of arena.obstacles) {
      expect(
        arena.obstacles.some((q) => q.kind === o.kind && Math.abs(q.x + o.x) < 1e-9 && Math.abs(q.z + o.z) < 1e-9),
        `${o.kind} at ${o.x},${o.z}`,
      ).toBe(true);
    }
  });

  it("keeps the orb inside the final zone", () => {
    expect(arena.suddenDeath.zone.minRadius).toBeGreaterThan(arena.orb.radius + 2);
  });
});
