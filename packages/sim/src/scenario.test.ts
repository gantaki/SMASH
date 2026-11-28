// Scripted scenarios: each gameplay rule gets a small deterministic situation (CLAUDE.md rule 5).
import { describe, expect, it } from "vitest";
import { arena, boulder, ember, fang, hound, moon, rook, rules, tide, training, wisp, type AbilitySlot } from "@smash/content";
import {
  TICK_DT,
  championOfSlot,
  championOfTeam,
  companionOf,
  createMatch,
  currentSlow,
  polylineDistance,
  emptyInput,
  floorTiles,
  rimSegmentAt,
  runBotMatch,
  solidAt,
  step,
  tileAt,
  trainingCommand,
  type ChampionUnit,
  type MatchMode,
  type MatchState,
  type PlayerInput,
  type SimEvent,
} from "./index.ts";

interface Scene {
  state: MatchState;
  a: ChampionUnit;
  b: ChampionUnit;
  events: SimEvent[];
  inputs: [PlayerInput, PlayerInput];
  /** Advances `seconds`, keeping the current inputs (presses are sent once). */
  run(seconds: number): SimEvent[];
  press(team: 0 | 1, slot: AbilitySlot, aimX: number, aimZ: number): void;
}

/** Two human-controlled champions, countdown skipped, companions parked far away unless asked for. */
function scene(champA = "ember", champB = "fang", opts: { mode?: MatchMode; companions?: boolean } = {}): Scene {
  const state = createMatch({
    seed: 7,
    mode: opts.mode ?? "duel",
    players: [
      { champion: champA, controller: "human" },
      { champion: champB, controller: opts.mode === "training" ? "dummy" : "human" },
    ],
  });
  const inputs: [PlayerInput, PlayerInput] = [emptyInput(), emptyInput()];
  const events: SimEvent[] = [];
  const s: Scene = {
    state,
    a: championOfTeam(state, 0),
    b: championOfTeam(state, 1),
    events,
    inputs,
    run(seconds) {
      const out: SimEvent[] = [];
      for (let i = 0, n = Math.round(seconds / TICK_DT); i < n; i++) {
        out.push(...step(state, inputs));
        inputs[0].press = [];
        inputs[1].press = [];
      }
      events.push(...out);
      return out;
    },
    press(team, slot, aimX, aimZ) {
      inputs[team].press = [slot];
      inputs[team].aim = { x: aimX, z: aimZ };
    },
  };
  s.inputs[0].aim = { x: s.b.x, z: s.b.z };
  s.inputs[1].aim = { x: s.a.x, z: s.a.z };
  if (state.phase === "countdown") s.run(rules.countdown + TICK_DT);
  expect(state.phase).toBe("fight");
  if (!opts.companions) {
    for (const u of state.units) {
      if (u.kind === "companion") {
        u.dead = true;
        u.respawn = 1e9;
      }
    }
  }
  return s;
}

/** Puts a companion on the field as if it had just been summoned (tests then set what it is doing). */
const out = <T extends { dead: boolean; respawn: number }>(c: T): T => {
  c.dead = false;
  c.respawn = 0;
  return c;
};

const place = (u: { x: number; z: number }, x: number, z: number) => {
  u.x = x;
  u.z = z;
};
const of = <T extends SimEvent["t"]>(events: SimEvent[], t: T) => events.filter((e): e is Extract<SimEvent, { t: T }> => e.t === t);

describe("determinism", () => {
  it("replays a bot match identically from the same seed", () => {
    const a = runBotMatch({ seed: 99, champions: ["ember", "fang"] });
    const b = runBotMatch({ seed: 99, champions: ["ember", "fang"] });
    expect(a).toEqual(b);
    expect(a.winner).not.toBe(-1);
  });

  it("continues identically from a JSON copy of the state (snapshot / rollback ready)", () => {
    const mk = () =>
      createMatch({ seed: 5, mode: "duel", players: [{ champion: "ember", controller: "bot" }, { champion: "fang", controller: "bot" }] });
    const live = mk();
    for (let i = 0; i < 900; i++) step(live, [null, null]);
    const copy = JSON.parse(JSON.stringify(live)) as MatchState;
    for (let i = 0; i < 900; i++) {
      step(live, [null, null]);
      step(copy, [null, null]);
    }
    expect(copy).toEqual(live);
  });
});

describe("movement", () => {
  it("reaches top speed within the acceleration time and stops within the deceleration time", () => {
    const s = scene();
    place(s.a, 0, 14);
    s.inputs[0].move = { x: 1, z: 0 };
    s.run(rules.movement.accelTime + 2 * TICK_DT);
    expect(s.a.vx).toBeCloseTo(ember.stats.moveSpeed, 3);
    s.inputs[0].move = { x: 0, z: 0 };
    s.run(rules.movement.decelTime + 2 * TICK_DT);
    expect(s.a.vx).toBe(0);
  });

  it("moves at the same speed in every direction, diagonals included", () => {
    const s = scene();
    place(s.a, 0, 14);
    s.inputs[0].move = { x: 1, z: 1 };
    s.run(0.5);
    expect(Math.hypot(s.a.vx, s.a.vz)).toBeCloseTo(ember.stats.moveSpeed, 3);
  });

  it("slows down while winding up and cannot move while stunned", () => {
    const s = scene();
    place(s.a, 0, 14);
    s.inputs[0].move = { x: 1, z: 0 };
    s.press(0, "secondary", 0, -10);
    s.run(0.3);
    expect(s.a.cast?.slot).toBe("secondary");
    expect(s.a.vx).toBeCloseTo(ember.stats.moveSpeed * ember.abilities.secondary!.castMoveMultiplier!, 3);
    s.a.stun = 1;
    s.run(0.1);
    expect(s.a.vx).toBe(0);
  });
});

describe("casting", () => {
  it("fires after the wind-up, and starts the cooldown only then", () => {
    const s = scene();
    const bolt = ember.abilities.primary!;
    s.press(0, "primary", s.b.x, s.b.z);
    s.run(bolt.castTime! - 2 * TICK_DT);
    expect(s.state.projectiles).toHaveLength(0);
    expect(s.a.cooldowns.primary).toBe(0);
    s.run(4 * TICK_DT);
    expect(s.state.projectiles).toHaveLength(1);
    expect(s.a.cooldowns.primary).toBeGreaterThan(0);
  });

  it("is interrupted by a stun without spending the cooldown or the energy", () => {
    const s = scene();
    s.a.energy = 100;
    s.press(0, "ultimate", 0, 0);
    s.run(0.1);
    expect(s.a.cast?.slot).toBe("ultimate");
    s.a.stun = 0.5;
    s.a.cast = null;
    s.run(1);
    expect(s.state.grounds).toHaveLength(0);
    expect(s.a.energy).toBeGreaterThanOrEqual(100);
  });

  it("buffers a press made slightly too early", () => {
    const s = scene();
    s.a.cooldowns.mobility = rules.inputBuffer - 0.05;
    const before = { x: s.a.x, z: s.a.z };
    s.press(0, "mobility", 5, 10);
    s.run(rules.inputBuffer);
    expect(Math.hypot(s.a.x - before.x, s.a.z - before.z)).toBeGreaterThan(3);
  });
});

describe("cancelling a cast", () => {
  it("aborts the wind-up for free, then cannot cancel again for a moment", () => {
    const s = scene();
    s.press(0, "secondary", 0, -10);
    s.run(0.2);
    expect(s.a.cast?.slot).toBe("secondary");
    s.inputs[0].cancel = true;
    const ev = s.run(TICK_DT);
    s.inputs[0].cancel = false;
    expect(of(ev, "castCancel")[0]?.reason).toBe("cancelled");
    expect(s.a.cast).toBeNull();
    s.run(1);
    expect(s.state.projectiles).toHaveLength(0);
    expect(s.a.cooldowns.secondary).toBe(0);

    // The cancel itself is on cooldown: a second wind-up started right away cannot be cancelled.
    s.a.cancelLock = rules.cancelCast.cooldown;
    s.press(0, "secondary", 0, -10);
    s.run(0.1);
    s.inputs[0].cancel = true;
    s.run(TICK_DT);
    s.inputs[0].cancel = false;
    expect(s.a.cast?.slot).toBe("secondary");
  });

  it("stops a channel but does not refund it", () => {
    const s = scene("fang", "ember");
    s.a.energy = 100;
    s.press(0, "ultimate", 0, 0);
    s.run(0.3);
    expect(s.a.channel).not.toBeNull();
    s.inputs[0].cancel = true;
    s.run(TICK_DT);
    expect(s.a.channel).toBeNull();
    expect(s.a.energy).toBeLessThan(5);
  });

  it("reports stuns as interruptions, not cancels", () => {
    const s = scene("fang", "ember");
    place(s.a, 5, 10);
    place(s.b, 5, 8);
    s.press(1, "secondary", 5, 10);
    s.run(0.1);
    s.press(0, "e", 5, 8);
    const ev = s.run(0.5);
    expect(of(ev, "castCancel").map((e) => e.reason)).toEqual(["interrupted"]);
  });
});

describe("slows", () => {
  it("a fading snare starts at full strength and wears off linearly", () => {
    const s = scene("fang", "ember");
    const cleave = fang.abilities.primary!;
    if (cleave.kind !== "cone" || !cleave.onHit.slow) throw new Error("expected a cone with a slow");
    const { amount, duration } = cleave.onHit.slow;
    place(s.a, 5, 14);
    place(s.b, 5, 12);
    s.press(0, "primary", 5, 0);
    s.run(cleave.castTime! + TICK_DT);
    expect(s.b.slowFading).toBe(true);
    expect(currentSlow(s.b)).toBeCloseTo(amount, 1);
    s.run(duration / 2);
    expect(currentSlow(s.b)).toBeCloseTo(amount / 2, 1);
    s.inputs[1].move = { x: 1, z: 0 };
    s.run(duration / 2 + 0.2);
    expect(currentSlow(s.b)).toBe(0);
    expect(s.b.vx).toBeCloseTo(ember.stats.moveSpeed, 3);
  });

  it("a light snare does not replace a heavier slow", () => {
    const s = scene("fang", "ember");
    place(s.a, 5, 14);
    place(s.b, 5, 12);
    Object.assign(s.b, { slow: 1.5, slowAmount: 0.5, slowTotal: 1.5, slowFading: false });
    s.press(0, "primary", 5, 0);
    s.run(0.4);
    expect(s.b.hp).toBeLessThan(s.b.maxHp);
    expect(s.b.slowFading).toBe(false);
    expect(currentSlow(s.b)).toBe(0.5);
  });
});

describe("projectiles", () => {
  it("fly at the ability's speed and hit for its damage", () => {
    const s = scene();
    place(s.a, 5.1, 6);
    place(s.b, 5.1, -4);
    const bolt = ember.abilities.primary!;
    if (bolt.kind !== "projectile") throw new Error("expected projectile");
    s.press(0, "primary", 5.1, -4);
    const ev = s.run(bolt.castTime! + 10 / bolt.speed + 0.1);
    const hit = of(ev, "damage").filter((e) => e.target === s.b.id);
    expect(hit).toHaveLength(1);
    expect(hit[0]!.amount).toBe(bolt.onHit.damage);
    expect(s.a.energy).toBeGreaterThan(bolt.onHit.damage * rules.energy.perDamage);
  });

  it("are stopped by stone pillars", () => {
    const s = scene();
    place(s.a, 7.5, 12);
    place(s.b, 7.5, 3);
    s.press(0, "primary", 7.5, 3);
    const ev = s.run(1.5);
    expect(of(ev, "projectileEnd").map((e) => e.reason)).toEqual(["blocked"]);
    expect(s.b.hp).toBe(s.b.maxHp);
  });

  it("break wood walls, which stay broken until the next round", () => {
    const s = scene();
    place(s.a, 0, 9);
    place(s.b, 12, -12);
    const wall = s.state.obstacles.find((o) => o.kind === "wood" && o.z === 5)!;
    s.inputs[0].holdPrimary = true;
    s.inputs[0].aim = { x: 0, z: 5 };
    s.run(5);
    expect(wall.alive).toBe(false);
    // Nothing is rebuilt during a round (wood used to come back after 20 s).
    s.inputs[0].holdPrimary = false;
    s.run(25);
    expect(wall.alive).toBe(false);
    s.b.hp = 1;
    place(s.b, 0, 3);
    s.press(0, "primary", 0, 3);
    s.run(1 + rules.roundEndDelay + 0.2);
    expect(s.state.round).toBe(2);
    expect(wall.alive).toBe(true);
    expect(wall.hp).toBe(wall.maxHp);
  });

  it("split into three when Ember's Fireball passes through her Wisp", () => {
    const s = scene("ember", "fang", { companions: true });
    place(s.a, -10, 14);
    place(s.b, 10, -14);
    const wisp = out(companionOf(s.state, s.a)!);
    wisp.mode = "sentry";
    wisp.modeTime = 99;
    wisp.tx = -10;
    wisp.tz = 10;
    place(wisp, -10, 10);
    s.press(0, "secondary", -10, 0);
    const ev = s.run(1.2);
    expect(of(ev, "companionInteract")[0]?.kind).toBe("split");
    // The Fireball itself plus the three shards.
    expect(of(ev, "projectileSpawn").filter((e) => e.owner === s.a.id)).toHaveLength(4);
  });

  it("pull Fang to his Hound when the Harpoon hits it", () => {
    const s = scene("fang", "ember", { companions: true });
    place(s.a, 0, 14);
    place(s.b, 14, -10);
    const hound = out(companionOf(s.state, s.a)!);
    hound.mode = "cover";
    hound.modeTime = 99;
    place(hound, 0, 8);
    s.press(0, "secondary", 0, 8);
    s.run(1.2);
    expect(Math.hypot(s.a.x - hound.x, s.a.z - hound.z)).toBeLessThan(2.2);
  });
});

describe("energy and weight", () => {
  it("a companion command needs a quarter of the energy bar, spends it and starts its cooldown", () => {
    const s = scene("ember", "fang", { companions: true });
    place(s.a, 0, 10);
    place(s.b, 0, -10);
    const fired = (ev: SimEvent[]) => of(ev, "abilityFire").filter((e) => e.unit === s.a.id && e.slot === "companion");

    s.a.energy = rules.energy.commandCost - 5;
    s.press(0, "companion", 0, 4);
    expect(fired(s.run(0.1))).toHaveLength(0);
    expect(s.a.cooldowns.companion).toBe(0);

    s.a.energy = rules.energy.commandCost + 5;
    s.press(0, "companion", 0, 4);
    expect(fired(s.run(0.1))).toHaveLength(1);
    expect(s.a.energy).toBeGreaterThanOrEqual(5);
    expect(s.a.energy).toBeLessThan(6);
    expect(s.a.cooldowns.companion).toBeGreaterThan(0);

    // Enough energy again, but the cooldown still holds the command back.
    s.a.energy = rules.energy.max;
    s.press(0, "companion", 0, 4);
    expect(fired(s.run(0.1))).toHaveLength(0);
    expect(s.a.energy).toBe(rules.energy.max);
  });

  it("the same shove moves a heavy champion less than a light one", () => {
    const bash = fang.abilities.e!;
    if (bash.kind !== "cone" || !bash.onHit.knockback) throw new Error("expected a knockback cone");
    const distance = bash.onHit.knockback.distance;
    // Out in the open: nothing to slam into.
    const shove = (target: "ember" | "fang") => {
      const s = scene("fang", target);
      place(s.a, 2, 10);
      place(s.b, 2, 12);
      s.press(0, "e", 2, 12);
      const ev = s.run(1);
      expect(of(ev, "slam")).toHaveLength(0);
      return s.b.z - 12;
    };
    const light = shove("ember");
    const heavy = shove("fang");
    expect(ember.stats.weight).toBeLessThan(fang.stats.weight);
    expect(Math.abs(light - distance / ember.stats.weight)).toBeLessThan(0.15);
    expect(Math.abs(heavy - distance / fang.stats.weight)).toBeLessThan(0.15);
    expect(heavy).toBeLessThan(light);
  });
});

describe("damage events", () => {
  it("say where a projectile hit came from: a point behind it on its path", () => {
    const s = scene();
    place(s.a, 5.1, 6);
    place(s.b, 5.1, -4);
    s.press(0, "primary", 5.1, -4);
    const hit = of(s.run(1.2), "damage").find((e) => e.target === s.b.id)!;
    expect(hit.source).toBe(s.a.id);
    expect(hit.fromX).toBeCloseTo(5.1);
    // The bolt flew toward -z, so its origin is on the +z side of the target.
    expect(hit.fromZ!).toBeGreaterThan(hit.z);
  });

  it("report a companion's bite from the companion, while its owner gets the credit", () => {
    const s = scene("fang", "ember", { companions: true });
    // Owner to the left of the victim, hound on its right (within the hound's leash).
    place(s.a, -2, -2);
    place(s.b, 6, -2);
    const hound = out(companionOf(s.state, s.a)!);
    Object.assign(hound, { x: 7.2, z: -2, mode: "engage", modeTime: 5, target: s.b.id, attackTimer: 0 });
    const bite = of(s.run(0.3), "damage").find((e) => e.target === s.b.id)!;
    expect(bite.source).toBe(s.a.id);
    expect(Math.hypot(bite.fromX! - hound.x, bite.fromZ! - hound.z)).toBeLessThan(0.5);
    // The hit came from the far side of the victim, not from the owner's side.
    expect(bite.fromX!).toBeGreaterThan(bite.x);
    expect(s.a.x).toBeLessThan(bite.x);
  });

  it("carry no origin for damage without a direction", () => {
    const s = scene();
    Object.assign(s.b, { burn: 1, burnDps: 4, burnTick: 0, burnSource: s.a.id });
    const tick = of(s.run(0.2), "damage").find((e) => e.target === s.b.id)!;
    expect(tick.dot).toBe(true);
    expect(tick.fromX).toBeUndefined();
    expect(tick.fromZ).toBeUndefined();
  });
});

describe("melee and control", () => {
  it("Cleave hits what is in front of Fang, not behind him", () => {
    const s = scene("fang", "ember");
    place(s.a, 0, 14);
    place(s.b, 0, 12);
    s.press(0, "primary", 0, 0);
    s.run(0.5);
    expect(s.b.hp).toBe(s.b.maxHp - 14);
    s.run(0.5);
    s.press(0, "primary", 0, 20);
    s.inputs[0].aim = { x: 0, z: 20 };
    s.run(0.5);
    expect(s.b.hp).toBe(s.b.maxHp - 14);
  });

  it("Shield Bash into the arena wall is a slam: longer stun and extra damage", () => {
    const s = scene("fang", "ember");
    const edge = arena.radius - arena.wallMargin;
    place(s.a, 0, edge - 2.4);
    place(s.b, 0, edge - 0.5);
    s.press(0, "e", 0, edge);
    const ev = s.run(0.6);
    expect(of(ev, "slam")).toHaveLength(1);
    expect(s.b.hp).toBe(s.b.maxHp - 10 - (rules.slam.damage + 10));
    expect(s.b.stun).toBeGreaterThan(0.6);
  });

  it("Counter negates the hit, stuns the attacker and empowers the next Cleave", () => {
    const s = scene("fang", "ember");
    place(s.a, 5, 10);
    place(s.b, 5, 4);
    s.press(0, "q", 5, 4);
    s.press(1, "primary", 5, 10);
    const ev = s.run(0.9);
    expect(of(ev, "counter")).toHaveLength(1);
    expect(s.a.hp).toBe(s.a.maxHp);
    expect(s.b.stun).toBeGreaterThan(0);
    expect(s.a.empowered).toBeGreaterThan(0);
  });

  it("Ring of Fire explodes after its delay and stuns", () => {
    const s = scene();
    place(s.a, 0, 8);
    place(s.b, 0, 0.5);
    const ring = ember.abilities.e!;
    if (ring.kind !== "groundAoe") throw new Error("expected groundAoe");
    s.press(0, "e", 0, 0.5);
    s.run(ring.castTime! + ring.delay - 0.1);
    expect(s.b.hp).toBe(s.b.maxHp);
    s.run(0.2);
    expect(s.b.hp).toBe(s.b.maxHp - ring.onHit.damage);
    expect(s.b.stun).toBeGreaterThan(0);
  });

  it("a rooted champion cannot use mobility but can still attack", () => {
    const s = scene("fang", "ember");
    place(s.a, 0, 14);
    place(s.b, 0, 12);
    s.a.root = 1;
    s.press(0, "mobility", 0, 0);
    s.run(0.2);
    expect(s.a.leap).toBeNull();
    s.press(0, "primary", 0, 0);
    s.run(0.5);
    expect(s.b.hp).toBeLessThan(s.b.maxHp);
  });

  it("Whirlwind makes Fang unstoppable", () => {
    const s = scene("fang", "ember");
    place(s.a, 0, 10);
    place(s.b, 0, 8);
    s.a.energy = 100;
    s.press(0, "ultimate", 0, 8);
    s.run(0.1);
    s.press(1, "q", 0, 10);
    s.run(0.2);
    expect(s.a.forced).toBeNull();
    expect(s.a.channel).not.toBeNull();
  });
});

describe("rounds", () => {
  it("ends the round when a champion dies and the match at two wins", () => {
    const s = scene();
    for (let round = 1; round <= 2; round++) {
      s.b.hp = 1;
      s.b.burn = 1;
      s.b.burnDps = 10;
      s.b.burnTick = 0;
      const ev = s.run(0.2);
      expect(of(ev, "roundEnd")[0]?.winner).toBe(0);
      s.run(rules.roundEndDelay + rules.countdown + 0.1);
    }
    expect(s.state.phase).toBe("matchEnd");
    expect(s.state.winner).toBe(0);
  });

  it("replays the round without scoring when both champions die in the same tick", () => {
    const s = scene();
    for (const u of [s.a, s.b]) {
      u.hp = 1;
      u.burn = 1;
      u.burnDps = 10;
      u.burnTick = 0;
    }
    const ev = s.run(0.2);
    expect(of(ev, "roundEnd")[0]?.winner).toBe(-1);
    expect(s.state.score).toEqual([0, 0]);
    s.run(rules.roundEndDelay + 0.1);
    expect(s.state.phase).toBe("countdown");
  });

  it("spawns the orb and rewards the last hitter", () => {
    const s = scene();
    s.state.roundTime = arena.orb.spawnAt;
    s.run(0.1);
    expect(s.state.orb.alive).toBe(true);
    s.a.hp = 100;
    s.state.orb.hp = 1;
    place(s.a, 4, 4);
    place(s.b, 15, -10);
    s.press(0, "primary", 0, 0);
    const ev = s.run(1);
    expect(of(ev, "orbBreak")[0]?.by).toBe(s.a.id);
    expect(s.a.hp).toBe(100 + arena.orb.reward.heal);
    expect(s.state.orb.alive).toBe(false);
  });
});

describe("sudden death", () => {
  const cfg = arena.suddenDeath;

  it("starts at the configured time, shrinks the zone and hurts outside it", () => {
    const s = scene();
    place(s.a, 0, arena.radius - arena.wallMargin);
    s.state.roundTime = cfg.startAt - 0.05;
    const ev = s.run(0.2);
    expect(of(ev, "suddenDeath")).toHaveLength(1);
    s.run(10);
    expect(s.state.suddenDeath.zoneRadius).toBeCloseTo(arena.radius - 10.15 * cfg.zone.shrinkSpeed, 1);
    const zoneHits = of(s.events, "damage").filter((e) => e.target === s.a.id && e.source === -1);
    expect(zoneHits.length).toBeGreaterThanOrEqual(10);
  });

  it("opens rifts in point-symmetric pairs", () => {
    const s = scene();
    s.state.roundTime = cfg.startAt;
    s.run(cfg.rifts.firstAfter + cfg.rifts.interval + 0.2);
    expect(s.state.rifts).toHaveLength(4);
    const [r0, r1] = s.state.rifts;
    r0!.points.forEach((p, i) => {
      expect(r1!.points[i]!.x).toBeCloseTo(-p.x);
      expect(r1!.points[i]!.z).toBeCloseTo(-p.z);
    });
  });

  it("keeps the centre free of rifts and never has more than the allowed number open", () => {
    const s = scene();
    place(s.a, 0, 2);
    place(s.b, 0, -2);
    s.state.roundTime = cfg.startAt;
    let most = 0;
    for (let i = 0; i < 80; i++) {
      // Keep both champions alive so the round (and the rifts) keep going.
      s.a.hp = s.a.maxHp;
      s.b.hp = s.b.maxHp;
      s.run(1);
      const open = s.state.rifts.filter((r) => !r.closing && r.phase !== "closing");
      most = Math.max(most, open.length);
      for (const r of s.state.rifts) expect(polylineDistance(r.points, 0, 0)).toBeGreaterThanOrEqual(cfg.rifts.centerClear - 1e-9);
    }
    expect(most).toBe(cfg.rifts.maxActivePairs * 2);
    // Old rifts really go away: far fewer exist than were ever opened.
    expect(s.state.suddenDeath.pairsSpawned).toBeGreaterThan(cfg.rifts.maxActivePairs * 3);
    expect(s.state.rifts.length).toBeLessThanOrEqual((cfg.rifts.maxActivePairs + 1) * 2);
  });

  it("a rift only hurts while erupting, and only who stands over the crack", () => {
    const s = scene();
    s.state.roundTime = cfg.startAt;
    place(s.a, 0, 3);
    place(s.b, 0, -3);
    s.run(cfg.rifts.firstAfter + 0.1);
    const rift = s.state.rifts[0]!;
    // Lay the crack under champion A; B stands 6 m away from it.
    rift.points = [
      { x: -3, z: 3 },
      { x: 3, z: 3 },
    ];
    s.state.rifts.length = 1;
    expect(rift.phase).toBe("warn");
    s.run(rift.time - 0.1);
    expect(s.a.hp).toBe(s.a.maxHp);
    const ev = s.run(0.2 + cfg.rifts.cycle.erupt);
    expect(of(ev, "riftErupt")).toHaveLength(1);
    expect(s.a.hp).toBeLessThanOrEqual(s.a.maxHp - cfg.rifts.damage * 2);
    expect(s.b.hp).toBe(s.b.maxHp);
    const hp = s.a.hp;
    s.run(cfg.rifts.cycle.dormant - 0.2);
    expect(rift.phase).toBe("dormant");
    expect(s.a.hp).toBe(hp);
  });
});

describe("destructible arena", () => {
  /** Knocks a tile out at once (no crumbling): a hole. */
  const hole = (s: Scene, x: number, z: number) => {
    s.state.floor.hp[tileAt(x, z)] = 0;
  };
  const intact = (s: Scene) => s.state.floor.hp.every((hp) => hp === arena.floor.hp);
  const ring = ember.abilities.e!;
  if (ring.kind !== "groundAoe") throw new Error("expected groundAoe");

  it("lays the floor out in rings: every point of the arena is on exactly one tile, point-symmetrically", () => {
    const f = arena.floor;
    expect(f.tilesPerRing % 2).toBe(0);
    expect(floorTiles).toHaveLength(1 + (f.tilesPerRing * f.rings * (f.rings + 1)) / 2);
    floorTiles.forEach((t, i) => {
      expect(tileAt(t.x, t.z)).toBe(i);
      const mirror = floorTiles[tileAt(-t.x, -t.z)]!;
      expect(mirror.x).toBeCloseTo(-t.x, 9);
      expect(mirror.z).toBeCloseTo(-t.z, 9);
    });
    expect(tileAt(0, arena.radius + 0.01)).toBe(-1);
    expect(tileAt(arena.radius - 0.01, 0)).toBeGreaterThan(0);
    // Two tiles of the outer ring under every section of the arena wall.
    const outer = floorTiles.filter((t) => t.ring === f.rings);
    expect(outer).toHaveLength(arena.rim.segments * 2);
    const perSection = new Map<number, number>();
    for (const t of outer) perSection.set(rimSegmentAt(t.x, t.z), (perSection.get(rimSegmentAt(t.x, t.z)) ?? 0) + 1);
    expect([...perSection.values()].every((n) => n === 2)).toBe(true);
  });

  it("a ground blast cracks the floor; a second one breaks it, the tiles hang for a moment, then drop with whoever stands on them", () => {
    const s = scene();
    place(s.a, 0, 12);
    place(s.b, 0, 4);
    const under = tileAt(0, 4);
    s.press(0, "e", 0, 4);
    const first = s.run(ring.castTime! + ring.delay + 0.1);
    expect(of(first, "floorCrack")[0]!.tiles).toContain(under);
    expect(s.state.floor.hp[under]).toBe(arena.floor.hp - ring.floorDamage);
    expect(of(first, "floorCrumble")).toHaveLength(0);

    s.a.cooldowns.e = 0;
    s.b.stun = 0;
    s.press(0, "e", 0, 4);
    const second = s.run(ring.castTime! + ring.delay + 0.1);
    expect(of(second, "floorCrumble")[0]!.tiles).toContain(under);
    expect(s.state.floor.hp[under]).toBe(0);
    // Broken, but still there: this is the telegraph.
    expect(solidAt(s.state, 0, 4)).toBe(true);
    expect(s.b.dead).toBe(false);

    const drop = s.run(arena.floor.crumbleTime);
    expect(of(drop, "floorDrop")[0]!.tiles).toContain(under);
    expect(solidAt(s.state, 0, 4)).toBe(false);
    expect(of(drop, "fall").map((e) => e.unit)).toEqual([s.b.id]);
    expect(s.b.dead).toBe(true);
    expect(of(drop, "roundEnd")[0]!.winner).toBe(0);
  });

  it("there is time to walk off a crumbling tile", () => {
    const s = scene();
    place(s.a, 0, 12);
    place(s.b, 0, 4);
    hole(s, 0, 4);
    s.state.floor.crumbling.push({ tile: tileAt(0, 4), time: arena.floor.crumbleTime });
    s.inputs[1].move = { x: 1, z: 0 };
    const ev = s.run(arena.floor.crumbleTime + 0.2);
    expect(of(ev, "floorDrop")).toHaveLength(1);
    expect(s.b.dead).toBe(false);
  });

  it("only what strikes the ground hurts the floor: projectiles, melee, novas and channels do not", () => {
    const cases: [string, string, AbilitySlot][] = [
      ["ember", "fang", "primary"],
      ["ember", "fang", "secondary"],
      ["ember", "fang", "q"],
      ["fang", "ember", "primary"],
      ["fang", "ember", "e"],
      ["fang", "ember", "ultimate"],
    ];
    for (const [caster, target, slot] of cases) {
      const s = scene(caster, target);
      place(s.a, -5, 3);
      place(s.b, -5, 1);
      s.a.energy = rules.energy.max;
      s.press(0, slot, -5, 1);
      const ev = s.run(3);
      expect(of(ev, "abilityFire"), `${caster} ${slot}`).toHaveLength(1);
      expect(s.b.hp, `${caster} ${slot}`).toBeLessThan(s.b.maxHp);
      expect(intact(s), `${caster} ${slot}`).toBe(true);
    }
  });

  it("a leap landing strikes the ground: the third one on the same spot goes through", () => {
    const s = scene("fang", "ember");
    const leap = fang.abilities.mobility!;
    if (leap.kind !== "leap") throw new Error("expected leap");
    place(s.b, 10, -10);
    const broke: boolean[] = [];
    for (let i = 0; i < 3; i++) {
      place(s.a, 0, 9);
      s.a.cooldowns.mobility = 0;
      s.press(0, "mobility", 0, 4);
      broke.push(of(s.run(leap.duration + 0.1), "floorCrumble").length > 0);
    }
    expect(broke).toEqual([false, false, true]);
  });

  it("a projectile hits the arena wall, breaks its section, and the next one flies out through the gap", () => {
    const s = scene();
    const bolt = ember.abilities.primary!;
    if (bolt.kind !== "projectile") throw new Error("expected projectile");
    // Straight at the middle of a section, from 6 m away.
    const section = 2;
    const a = (section * Math.PI * 2) / arena.rim.segments;
    const at = (r: number) => ({ x: Math.sin(a) * r, z: Math.cos(a) * r });
    place(s.a, at(12).x, at(12).z);
    place(s.b, -10, -10);
    expect(rimSegmentAt(at(18).x, at(18).z)).toBe(section);
    s.state.rim[section] = bolt.onHit.damage + 1;
    s.press(0, "primary", at(30).x, at(30).z);
    const hit = s.run(0.8);
    expect(of(hit, "rimHit")[0]!.segment).toBe(section);
    expect(of(hit, "projectileEnd")[0]!.reason).toBe("blocked");
    expect(s.state.rim[section]).toBe(1);

    s.press(0, "primary", at(30).x, at(30).z);
    const broke = s.run(0.8);
    expect(of(broke, "rimBreak")[0]).toMatchObject({ segment: section, fell: false });
    expect(s.state.rim[section]).toBe(0);

    s.press(0, "primary", at(30).x, at(30).z);
    const through = of(s.run(1.2), "projectileEnd")[0]!;
    expect(through.reason).toBe("expired");
    expect(Math.hypot(through.x, through.z)).toBeGreaterThan(arena.radius);
    expect(intact(s)).toBe(true);
  });

  it("a slam damages the wall section; with the section gone the same shove is a ring-out, credited to the pusher", () => {
    const edge = arena.radius - arena.wallMargin;
    const bash = (prepare: (s: Scene) => void) => {
      const s = scene("fang", "ember");
      place(s.a, 0.5, edge - 2.4);
      place(s.b, 0.5, edge - 0.5);
      prepare(s);
      s.press(0, "e", 0.5, edge);
      return { s, ev: s.run(0.6) };
    };
    const section = rimSegmentAt(0.5, edge);
    const wall = bash(() => {});
    expect(of(wall.ev, "slam")).toHaveLength(1);
    expect(wall.s.state.rim[section]).toBe(arena.rim.hp - rules.slam.structureDamage);
    expect(wall.s.b.dead).toBe(false);

    const gap = bash((s) => {
      s.state.rim[section] = 0;
    });
    expect(of(gap.ev, "slam")).toHaveLength(0);
    expect(of(gap.ev, "fall")[0]).toMatchObject({ unit: gap.s.b.id, by: gap.s.a.id });
    expect(gap.s.b.dead).toBe(true);
    expect(of(gap.ev, "roundEnd")[0]!.winner).toBe(0);
  });

  it("a knockback or a pull across a hole ends in it; a shield does not help", () => {
    const s = scene("fang", "ember");
    place(s.a, 4, 2);
    place(s.b, 4, 4);
    s.b.shield = 100;
    s.b.shieldTime = 5;
    hole(s, 4, 6.3);
    s.press(0, "e", 4, 4);
    const ev = s.run(0.6);
    expect(of(ev, "fall")[0]).toMatchObject({ unit: s.b.id, by: s.a.id });
    expect(s.b.dead).toBe(true);

    const h = scene("fang", "ember");
    place(h.a, -5, 1);
    place(h.b, -5, 9);
    hole(h, -5, 5);
    h.press(0, "secondary", -5, 9);
    const pulled = h.run(1.5);
    expect(of(pulled, "fall")[0]).toMatchObject({ unit: h.b.id, by: h.a.id });
  });

  it("a leap carries over a hole, but coming down in one is a fall (and no landing blow)", () => {
    const over = scene("fang", "ember");
    place(over.a, 0, 12);
    place(over.b, 10, -10);
    hole(over, 0, 9);
    over.press(0, "mobility", 0, 5.5);
    const ev = over.run(1);
    expect(of(ev, "leapLand")).toHaveLength(1);
    expect(over.a.dead).toBe(false);

    const into = scene("fang", "ember");
    place(into.a, 0, 12);
    place(into.b, 0.5, 6);
    hole(into, 0, 7);
    into.press(0, "mobility", 0, 7);
    const down = into.run(1);
    expect(of(down, "leapLand")).toHaveLength(0);
    expect(of(down, "fall")[0]).toMatchObject({ unit: into.a.id, by: -1 });
    expect(into.b.hp).toBe(into.b.maxHp);
    expect(of(down, "roundEnd")[0]!.winner).toBe(1);
  });

  it("walking or blinking onto a hole is a fall too", () => {
    const s = scene();
    place(s.a, 0, 12);
    hole(s, 0, 10);
    s.inputs[0].move = { x: 0, z: -1 };
    expect(of(s.run(0.8), "fall")[0]!.unit).toBe(s.a.id);

    const b = scene();
    place(b.a, 0, 12);
    hole(b, 0, 7);
    b.press(0, "mobility", 0, 7);
    expect(of(b.run(0.2), "fall")[0]!.unit).toBe(b.a.id);
  });

  it("pillars can be broken, and pillars, walls and crates go down with the floor under them", () => {
    const s = scene();
    const pillar = s.state.obstacles.find((o) => o.kind === "stone" && o.x > 0 && o.z > 0)!;
    place(s.a, 7.5, 13);
    place(s.b, -10, -10);
    pillar.hp = 5;
    s.press(0, "primary", 7.5, 7.5);
    const ev = s.run(0.8);
    expect(of(ev, "obstacleBreak")[0]!.id).toBe(pillar.id);
    expect(pillar.alive).toBe(false);

    const other = s.state.obstacles.find((o) => o.kind === "stone" && o.x < 0 && o.z > 0)!;
    const wood = s.state.obstacles.find((o) => o.kind === "wood")!;
    const crate = s.state.obstacles.find((o) => o.kind === "crate")!;
    for (const o of [other, wood, crate]) hole(s, o.x, o.z);
    const fell = of(s.run(0.1), "obstacleFall").map((e) => e.id);
    expect(fell.sort()).toEqual([other.id, wood.id, crate.id].sort());
    expect([other, wood, crate].every((o) => o.fallen && !o.alive)).toBe(true);
    expect(wood.alive).toBe(false);
  });

  it("a section of the arena wall goes with the floor it stands on", () => {
    const s = scene();
    place(s.a, 0, 5);
    place(s.b, 0, -5);
    const section = 4;
    const tiles = floorTiles.map((t, i) => ({ t, i })).filter(({ t }) => t.ring === arena.floor.rings && rimSegmentAt(t.x, t.z) === section);
    s.state.floor.hp[tiles[0]!.i] = 0;
    s.state.floor.crumbling.push({ tile: tiles[0]!.i, time: 0.05 });
    expect(of(s.run(0.2), "rimBreak")).toHaveLength(0);
    s.state.floor.hp[tiles[1]!.i] = 0;
    s.state.floor.crumbling.push({ tile: tiles[1]!.i, time: 0.05 });
    expect(of(s.run(0.2), "rimBreak")[0]).toMatchObject({ segment: section, fell: true });
    expect(s.state.rim[section]).toBe(0);
  });

  it("a flying companion does not care about holes; a walking one falls in when thrown, but will not walk in", () => {
    const e = scene("ember", "fang", { companions: true });
    const wisp = out(companionOf(e.state, e.a)!);
    const hound = out(companionOf(e.state, e.b)!);
    Object.assign(wisp, { mode: "sentry", modeTime: 99, tx: 3, tz: 12 });
    Object.assign(hound, { mode: "cover", modeTime: 99 });
    place(e.a, 0, 12);
    place(e.b, 0, -12);
    place(wisp, 3, 12);
    place(hound, 3, -12);
    hole(e, 3, 12);
    hole(e, 3, -12);
    const ev = e.run(0.1);
    expect(of(ev, "fall").map((f) => f.unit)).toEqual([hound.id]);
    expect(hound.dead).toBe(true);
    expect(wisp.dead).toBe(false);

    // A moat between Fang and the point the Hound is sent to: it stops at the edge.
    const f = scene("fang", "ember", { companions: true });
    const dog = companionOf(f.state, f.a)!;
    place(f.a, 0, 12);
    place(f.b, -12, -8);
    floorTiles.forEach((t, i) => {
      if (t.ring === 6) f.state.floor.hp[i] = 0;
    });
    f.a.energy = rules.energy.max;
    f.press(0, "companion", 0, 5);
    const sent = f.run(3);
    expect(of(sent, "companionCommand")).toHaveLength(1);
    expect(of(sent, "fall")).toHaveLength(0);
    // It gave up at the edge and left, unharmed: it can be summoned again.
    expect(of(sent, "companionLeave")).toHaveLength(1);
    expect(dog.respawn).toBe(0);
  });

  it("a bot does not walk into a moat to reach its enemy", () => {
    const state = createMatch({
      seed: 3,
      mode: "duel",
      players: [
        { champion: "fang", controller: "bot", difficulty: "hard" },
        { champion: "ember", controller: "human" },
      ],
    });
    const bot = championOfTeam(state, 0);
    const still = emptyInput();
    still.aim = { x: 0, z: 0 };
    for (let i = 0; i < Math.round((rules.countdown + 0.1) / TICK_DT); i++) step(state, [null, still]);
    // Three rings gone: a moat about 4 m wide between the bot and the enemy in the middle.
    floorTiles.forEach((t, i) => {
      if (t.ring >= 3 && t.ring <= 5) state.floor.hp[i] = 0;
    });
    expect(solidAt(state, bot.x, bot.z)).toBe(true);
    const enemy = championOfTeam(state, 1);
    enemy.x = 0;
    enemy.z = 0;
    const falls: SimEvent[] = [];
    for (let i = 0; i < Math.round(12 / TICK_DT); i++) {
      // The target stands in the middle and does nothing; keep it alive so the round goes on.
      enemy.hp = enemy.maxHp;
      falls.push(...of(step(state, [null, still]), "fall"));
    }
    // (What it does do is drag or shove the enemy into the moat: those falls are the enemy's.)
    expect(falls.filter((e) => e.t === "fall" && e.unit === bot.id)).toHaveLength(0);
    expect(bot.dead).toBe(false);
  });

  it("is whole again when the next round starts", () => {
    const s = scene();
    hole(s, 0, 0);
    s.state.rim[3] = 0;
    const pillar = s.state.obstacles.find((o) => o.kind === "stone")!;
    hole(s, pillar.x, pillar.z);
    s.run(0.1);
    expect(pillar.fallen).toBe(true);
    s.b.hp = 1;
    place(s.a, 0, 12);
    place(s.b, 0, 8);
    s.press(0, "primary", 0, 8);
    s.run(1 + rules.roundEndDelay + 0.2);
    expect(s.state.round).toBe(2);
    expect(intact(s)).toBe(true);
    expect(s.state.floor.crumbling).toHaveLength(0);
    expect(s.state.rim.every((hp) => hp === arena.rim.hp)).toBe(true);
    expect(pillar.alive && !pillar.fallen).toBe(true);
  });
});

describe("crates", () => {
  it("take damage from what hits them, break, and stay broken", () => {
    const s = scene();
    const crate = s.state.obstacles.find((o) => o.kind === "crate" && o.x > 3 && o.z === 0)!;
    place(s.a, crate.x, 6);
    place(s.b, -12, -12);
    const bolt = ember.abilities.primary!;
    if (bolt.kind !== "projectile") throw new Error("expected projectile");
    crate.hp = bolt.onHit.damage + 1;
    s.press(0, "primary", crate.x, 0);
    const first = s.run(0.8);
    expect(of(first, "obstacleHit")[0]).toMatchObject({ id: crate.id, kind: "crate" });
    expect(crate.alive).toBe(true);
    // Still pushed by the hit, as before.
    expect(crate.z).toBeLessThan(0);
    s.press(0, "primary", crate.x, crate.z);
    expect(of(s.run(0.8), "obstacleBreak")[0]).toMatchObject({ id: crate.id, kind: "crate" });
    s.run(25);
    expect(crate.alive).toBe(false);
  });
});

describe("companions are summoned", () => {
  it("is not on the field until commanded, appears beside its owner, does its job and leaves", () => {
    const s = scene("ember", "fang", { companions: true });
    const pet = companionOf(s.state, s.a)!;
    place(s.a, -4.5, 12);
    place(s.b, -4.5, 2);
    expect(pet.dead).toBe(true);
    s.a.energy = rules.energy.max;
    s.press(0, "companion", -4.5, 7);
    const ev = s.run(0.1);
    expect(of(ev, "companionSummon")).toHaveLength(1);
    expect(pet.dead).toBe(false);
    expect(Math.hypot(pet.x - s.a.x, pet.z - s.a.z)).toBeLessThan(3);
    if (wisp.command.kind !== "sentry") throw new Error("expected sentry");
    const rest = s.run(wisp.command.duration + 2);
    expect(of(rest, "companionAttack").length).toBeGreaterThan(0);
    expect(of(rest, "companionLeave")).toHaveLength(1);
    expect(pet.dead).toBe(true);
    expect(pet.respawn).toBe(0);
  });

  it("cannot be summoned for a while after it is killed, and is away again when the next round starts", () => {
    const s = scene("fang", "ember", { companions: true });
    const pet = companionOf(s.state, s.a)!;
    place(s.a, -4.5, 13);
    place(s.b, -4.5, 3);
    s.a.energy = rules.energy.max;
    s.press(0, "companion", -4.5, 8);
    s.run(0.1);
    // Hold it still in the line of fire.
    Object.assign(pet, { x: -4.5, z: 8, mode: "cover", modeTime: 99, hp: 1 });
    s.press(1, "primary", -4.5, 8);
    const ev = s.run(0.8);
    expect(of(ev, "companionDeath")).toHaveLength(1);
    expect(pet.respawn).toBeGreaterThan(rules.companion.respawn - 1);
    s.a.cooldowns.companion = 0;
    s.a.energy = rules.energy.max;
    s.press(0, "companion", -4.5, 8);
    expect(of(s.run(0.2), "companionSummon")).toHaveLength(0);
    pet.respawn = 0.05;
    s.run(0.1);
    s.press(0, "companion", -4.5, 8);
    expect(of(s.run(0.2), "companionSummon")).toHaveLength(1);
    expect(hound.command.kind).toBe("pounce");
  });
});

describe("2v2", () => {
  const four = (controller: "human" | "bot" = "human") =>
    createMatch({
      seed: 11,
      mode: "duel",
      players: ["ember", "fang", "rook", "tide"].map((champion) => ({ champion, controller })),
    });

  it("puts even slots on team 0 and odd ones on team 1, side by side at their spawn", () => {
    const state = four();
    const [a, b, c, d] = [0, 1, 2, 3].map((slot) => championOfSlot(state, slot));
    expect([a!.team, b!.team, c!.team, d!.team]).toEqual([0, 1, 0, 1]);
    expect(a!.z).toBe(arena.spawns[0].z);
    expect(c!.z).toBe(arena.spawns[0].z);
    expect(Math.abs(a!.x - c!.x)).toBeCloseTo(arena.spawnSpread);
    expect(a!.x + c!.x).toBeCloseTo(0);
    expect(b!.z).toBe(arena.spawns[1].z);
  });

  it("takes input by slot, and a round ends only when a whole team is down", () => {
    const state = four();
    const inputs = [0, 1, 2, 3].map(() => emptyInput());
    for (let i = 0; i < Math.round((rules.countdown + 0.1) / TICK_DT); i++) step(state, inputs);
    const mate = championOfSlot(state, 2);
    const x0 = mate.x;
    inputs[2]!.move = { x: 1, z: 0 };
    for (let i = 0; i < 30; i++) step(state, inputs);
    expect(mate.x).toBeGreaterThan(x0 + 1);
    expect(championOfSlot(state, 0).x).toBeCloseTo(-arena.spawnSpread / 2);

    championOfSlot(state, 1).hp = 0.5;
    championOfSlot(state, 1).burn = 1;
    championOfSlot(state, 1).burnDps = 10;
    const ev: SimEvent[] = [];
    for (let i = 0; i < 60; i++) ev.push(...step(state, inputs));
    expect(championOfSlot(state, 1).dead).toBe(true);
    expect(of(ev, "roundEnd")).toHaveLength(0);
    championOfSlot(state, 3).hp = 0.5;
    championOfSlot(state, 3).burn = 1;
    championOfSlot(state, 3).burnDps = 10;
    for (let i = 0; i < 60; i++) ev.push(...step(state, inputs));
    expect(of(ev, "roundEnd")[0]!.winner).toBe(0);
  });

  it("bots finish a 2v2 match", () => {
    const r = runBotMatch({ seed: 21, champions: ["ember", "fang", "rook", "tide"], difficulty: "hard" });
    expect(r.winner).not.toBe(-1);
    expect(Math.max(...r.score)).toBe(rules.roundsToWin);
  });
});

describe("Rook", () => {
  it("is a melee champion: the maul hits what is in front of him and bats a crate away", () => {
    const maul = rook.abilities.primary!;
    if (maul.kind !== "cone") throw new Error("expected a melee cone");
    const s = scene("rook", "ember");
    place(s.a, -4.5, 12);
    place(s.b, -4.5, 12 - maul.range + 0.5);
    const crate = s.state.obstacles.find((o) => o.kind === "crate")!;
    // Off to the side, so that it flies clear of the enemy.
    crate.x = -6.6;
    crate.z = 11.2;
    s.press(0, "primary", -4.5, 9);
    const ev = s.run(maul.castTime! + 0.1);
    expect(of(ev, "meleeHit")).toHaveLength(1);
    expect(s.b.hp).toBe(s.b.maxHp - maul.onHit.damage);
    expect(Math.hypot(crate.vx, crate.vz)).toBeGreaterThan(rules.obstacles.crateHitSpeed);
    expect(crate.hp).toBe(crate.maxHp - maul.onHit.damage);
    // Out of reach: nothing.
    place(s.b, -4.5, 12 - maul.range - 2);
    const hp = s.b.hp;
    s.a.cooldowns.primary = 0;
    s.press(0, "primary", -4.5, 9);
    s.run(maul.castTime! + 0.1);
    expect(s.b.hp).toBe(hp);
  });

  const wallA = rook.abilities.secondary!;
  const ram = rook.abilities.mobility!;
  const skin = rook.abilities.q!;
  const shatter = rook.abilities.e!;
  const colosseum = rook.abilities.ultimate!;
  if (wallA.kind !== "wall" || ram.kind !== "dash" || skin.kind !== "brace" || shatter.kind !== "line" || colosseum.kind !== "ring") throw new Error("unexpected Rook kit");
  const walls = (s: Scene) => s.state.obstacles.filter((o) => o.kind === "wall");

  it("raises a wall across his aim that stops shots, keeps at most two, and lets them crumble in time", () => {
    const s = scene("rook", "ember");
    place(s.a, -4.5, 12);
    place(s.b, -4.5, 2);
    s.press(0, "secondary", -4.5, 8);
    s.run(wallA.castTime! + 0.1);
    expect(walls(s)).toHaveLength(1);
    const w = walls(s)[0]!;
    expect(w.z).toBeCloseTo(8);
    // Ember's bolt at Rook is stopped by it.
    s.press(1, "primary", -4.5, 12);
    const shot = s.run(1);
    expect(of(shot, "projectileEnd")[0]!.reason).toBe("blocked");
    expect(s.a.hp).toBe(s.a.maxHp);
    expect(w.hp).toBeLessThan(wallA.hp);

    for (const z of [6, 5]) {
      s.a.cooldowns.secondary = 0;
      s.press(0, "secondary", -4.5, z);
      s.run(wallA.castTime! + 0.1);
    }
    expect(walls(s)).toHaveLength(wallA.maxActive);
    expect(walls(s)).not.toContain(w);
    const gone = s.run(wallA.duration + 0.2);
    expect(of(gone, "wallExpire").length).toBeGreaterThan(0);
    expect(walls(s)).toHaveLength(0);
  });

  it("rams an enemy along: into a wall it is a slam, over a hole it is a fall", () => {
    const s = scene("rook", "ember");
    place(s.a, -4.5, 12);
    place(s.b, -4.5, 9.5);
    s.press(0, "secondary", -4.5, 6.5);
    s.run(wallA.castTime! + 0.1);
    s.press(0, "mobility", -4.5, 4);
    const ev = s.run(0.8);
    expect(of(ev, "dashHit")).toHaveLength(1);
    expect(of(ev, "slam")).toHaveLength(1);
    expect(s.b.hp).toBe(s.b.maxHp - ram.onHit.damage - (rules.slam.damage + ram.carry.slamDamage!));
    expect(s.a.z).toBeGreaterThan(7);

    const h = scene("rook", "ember");
    place(h.a, -4.5, 12);
    place(h.b, -4.5, 9.5);
    h.state.floor.hp[tileAt(-4.5, 5.2)] = 0;
    h.press(0, "mobility", -4.5, 6.6);
    const fell = h.run(0.8);
    expect(of(fell, "fall")[0]).toMatchObject({ unit: h.b.id, by: h.a.id });
    expect(h.a.dead).toBe(false);
  });

  it("is untouchable while braced, then throws everyone around back", () => {
    const s = scene("rook", "fang");
    place(s.a, -4.5, 8);
    place(s.b, -4.5, 6);
    s.press(0, "q", -4.5, 6);
    s.run(0.05);
    s.press(1, "e", -4.5, 8);
    s.inputs[0].move = { x: 1, z: 0 };
    const during = s.run(skin.duration - 0.1);
    expect(s.a.hp).toBe(s.a.maxHp);
    expect(s.a.x).toBe(-4.5);
    expect(of(during, "nova")).toHaveLength(0);
    const end = s.run(0.4);
    expect(of(end, "nova")).toHaveLength(1);
    expect(s.b.hp).toBe(s.b.maxHp - skin.onHit.damage);
    expect(s.b.z).toBeLessThan(6 - 1.5);
  });

  it("cracks the floor along a line, and bursts his own wall on it into shards", () => {
    const s = scene("rook", "ember");
    place(s.a, -4.5, 13);
    place(s.b, 10, -10);
    s.press(0, "e", -4.5, 0);
    const ev = s.run(shatter.castTime! + 0.1);
    expect(of(ev, "line")).toHaveLength(1);
    for (const z of [11, 9, 7]) expect(s.state.floor.hp[tileAt(-4.5, z)]).toBe(arena.floor.hp - shatter.floorDamage);
    expect(s.state.floor.hp[tileAt(-4.5, 13)]).toBe(arena.floor.hp);
    expect(s.state.floor.hp[tileAt(-4.5, 13 - shatter.range - 2)]).toBe(arena.floor.hp);
    expect(s.state.floor.hp[tileAt(-1, 9)]).toBe(arena.floor.hp);

    const w = scene("rook", "ember");
    place(w.a, -4.5, 13);
    place(w.b, -2.3, 8);
    w.press(0, "secondary", -4.5, 9);
    w.run(wallA.castTime! + 0.1);
    w.a.cooldowns.e = 0;
    w.press(0, "e", -4.5, 0);
    const burst = w.run(shatter.castTime! + 0.2);
    expect(of(burst, "wallShatter")).toHaveLength(1);
    expect(w.state.obstacles.some((o) => o.kind === "wall")).toBe(false);
    // Out of the line itself, but inside the burst.
    expect(w.b.hp).toBe(w.b.maxHp - shatter.shatter!.onHit.damage);
    expect(w.b.forced).not.toBeNull();
  });

  it("rolls his Boulder through an enemy, bounces it off a wall, and leaves it as cover for a while", () => {
    const s = scene("rook", "ember", { companions: true });
    const pet = companionOf(s.state, s.a)!;
    place(s.a, -4.5, 13);
    place(s.b, -4.5, 7);
    s.a.energy = rules.energy.max;
    s.press(0, "companion", -4.5, 2);
    if (boulder.command.kind !== "roll") throw new Error("expected roll");
    const ev = s.run(1.2);
    expect(of(ev, "companionSummon")).toHaveLength(1);
    expect(s.b.hp).toBe(s.b.maxHp - boulder.command.onHit.damage);
    expect(s.b.z).toBeLessThan(6);
    expect(pet.mode).toBe("cover");
    expect(pet.dead).toBe(false);
    const rest = s.run(boulder.command.coverTime + 0.2);
    expect(of(rest, "companionLeave")).toHaveLength(1);

    const b = scene("rook", "ember", { companions: true });
    place(b.a, 2, 15);
    place(b.b, -12, -12);
    b.a.energy = rules.energy.max;
    // Straight at the arena wall.
    b.press(0, "companion", 2, 30);
    const bounced = b.run(1.5);
    expect(of(bounced, "companionBounce").length).toBeGreaterThan(0);
    expect(of(bounced, "fall")).toHaveLength(0);
  });

  it("raises a Colosseum: a ring of walls where a slam hits twice as hard", () => {
    const s = scene("rook", "ember");
    place(s.a, -4.5, 10);
    place(s.b, -4.5, 7.5);
    s.a.energy = rules.energy.max;
    s.press(0, "ultimate", -4.5, 8);
    const ev = s.run(colosseum.castTime! + 0.1);
    expect(of(ev, "ringRaise")).toHaveLength(1);
    expect(s.state.obstacles.filter((o) => o.kind === "wall")).toHaveLength(colosseum.segments);
    expect(s.state.arenas).toHaveLength(1);
    place(s.a, -4.5, 9);
    place(s.b, -4.5, 6.5);
    s.press(0, "mobility", -4.5, 3);
    const hit = s.run(0.8);
    expect(of(hit, "slam")).toHaveLength(1);
    expect(s.b.hp).toBe(s.b.maxHp - ram.onHit.damage - (rules.slam.damage + ram.carry.slamDamage!) * colosseum.slamMultiplier);
    s.run(colosseum.duration);
    expect(s.state.obstacles.some((o) => o.kind === "wall")).toBe(false);
    expect(s.state.arenas).toHaveLength(0);
  });
});

describe("Tide", () => {
  const lift = tide.abilities.secondary!;
  const shift = tide.abilities.mobility!;
  const float = tide.abilities.q!;
  const surge = tide.abilities.e!;
  const maelstrom = tide.abilities.ultimate!;
  if (lift.kind !== "lift" || shift.kind !== "swap" || float.kind !== "hover" || surge.kind !== "cone" || maelstrom.kind !== "groundAoe") throw new Error("unexpected Tide kit");
  const crateAt = (s: Scene, x: number, z: number) => {
    const c = s.state.obstacles.find((o) => o.kind === "crate")!;
    c.x = x;
    c.z = z;
    return c;
  };

  it("lifts a crate and throws it; without a crate under the cursor nothing happens and nothing is paid", () => {
    const s = scene("tide", "fang");
    place(s.a, -4.5, 12);
    place(s.b, -4.5, 4);
    s.press(0, "secondary", -9, 9);
    expect(of(s.run(0.4), "lift")).toHaveLength(0);
    expect(s.a.cooldowns.secondary).toBe(0);

    const crate = crateAt(s, -9, 10);
    s.press(0, "secondary", -9, 10);
    const up = s.run(lift.castTime! + 0.1);
    expect(of(up, "lift")[0]!.obstacle).toBe(crate.id);
    expect(s.a.held?.id).toBe(crate.id);
    expect(crate.alive).toBe(false);
    expect(s.a.cooldowns.secondary).toBeGreaterThan(0);

    s.press(0, "secondary", -4.5, 4);
    const thrown = s.run(1);
    expect(of(thrown, "release")[0]).toMatchObject({ obstacle: crate.id, thrown: true });
    expect(of(thrown, "crateHit")[0]!.target).toBe(s.b.id);
    expect(s.b.hp).toBe(s.b.maxHp - rules.obstacles.crateHit.damage);
    expect(crate.alive).toBe(true);
  });

  it("puts the crate down if it is not thrown in time", () => {
    const s = scene("tide", "fang");
    place(s.a, -4.5, 12);
    place(s.b, 10, -10);
    const crate = crateAt(s, -8, 11);
    s.press(0, "secondary", -8, 11);
    const ev = s.run(lift.castTime! + lift.holdTime + 0.2);
    expect(of(ev, "release")[0]).toMatchObject({ obstacle: crate.id, thrown: false });
    expect(s.a.held).toBeNull();
    expect(crate.alive).toBe(true);
    expect(Math.hypot(crate.x - s.a.x, crate.z - s.a.z)).toBeLessThan(2);
  });

  it("trades places with an enemy or a crate in sight, and does not fire without a target", () => {
    const s = scene("tide", "fang");
    place(s.a, -4.5, 12);
    place(s.b, -4.5, 6);
    s.press(0, "mobility", 0, 12);
    s.run(0.4);
    expect(s.a.cooldowns.mobility).toBe(0);
    s.press(0, "mobility", -4.5, 6);
    const ev = s.run(shift.castTime! + 0.1);
    expect(of(ev, "swap")[0]).toMatchObject({ unit: s.a.id, target: s.b.id });
    expect(s.a.z).toBeCloseTo(6, 0);
    expect(s.b.z).toBeCloseTo(12, 0);

    const c = scene("tide", "fang");
    place(c.a, -4.5, 12);
    place(c.b, 10, -10);
    const crate = crateAt(c, -10, 9);
    c.press(0, "mobility", -10, 9);
    c.run(shift.castTime! + 0.1);
    expect(c.a.x).toBeCloseTo(-10);
    expect(crate.x).toBeCloseTo(-4.5);
  });

  it("floats: cannot be shoved, passes over a hole, cannot cast, and comes down where the float ends", () => {
    const s = scene("tide", "fang");
    place(s.a, -4.5, 8);
    place(s.b, -4.5, 6);
    s.press(0, "q", -4.5, 6);
    s.run(0.05);
    s.press(1, "e", -4.5, 8);
    s.run(0.5);
    expect(s.a.forced).toBeNull();
    expect(s.a.z).toBeCloseTo(8);
    // Damage still lands: it is not a shield.
    expect(s.a.hp).toBeLessThan(s.a.maxHp);
    s.press(0, "primary", -4.5, 6);
    expect(of(s.run(0.2), "castStart").filter((e) => e.unit === s.a.id)).toHaveLength(0);

    const h = scene("tide", "fang");
    place(h.a, -4.5, 8);
    place(h.b, 10, -10);
    h.press(0, "q", -4.5, 6);
    h.run(0.05);
    h.state.floor.hp[tileAt(-4.5, 8)] = 0;
    expect(of(h.run(float.duration - 0.2), "fall")).toHaveLength(0);
    expect(of(h.run(0.4), "fall")[0]!.unit).toBe(h.a.id);
  });

  it("Surge throws an enemy back and a crate about twice as far", () => {
    const s = scene("tide", "fang");
    place(s.a, -4.5, 4);
    place(s.b, -3.7, 2);
    const crate = crateAt(s, -5.3, 2);
    s.press(0, "e", -4.5, 2);
    s.run(2);
    const shove = surge.onHit.knockback!.distance / fang.stats.weight;
    expect(Math.hypot(s.b.x + 3.7, s.b.z - 2)).toBeCloseTo(shove, 0);
    expect(Math.hypot(crate.x + 5.3, crate.z - 2)).toBeGreaterThan(shove * 1.8);
  });

  it("sends the Moon to open a gravity well: enemies drift in, crates fly in and hit what is in their way", () => {
    const s = scene("tide", "fang", { companions: true });
    const pet = companionOf(s.state, s.a)!;
    place(s.a, -4.5, 13);
    place(s.b, -4.5, 3);
    const crate = crateAt(s, -4.5, 1.2);
    s.a.energy = rules.energy.max;
    s.press(0, "companion", -4.5, 6);
    if (moon.command.kind !== "well") throw new Error("expected well");
    const ev = s.run(1.2 + moon.command.duration);
    expect(of(ev, "companionWell")).toHaveLength(1);
    // Dragged toward the well against no resistance (the enemy stands still).
    expect(s.b.z).toBeGreaterThan(3.5);
    expect(of(ev, "crateHit").some((e) => e.id === crate.id && e.target === s.b.id)).toBe(true);
    expect(of(ev, "companionLeave")).toHaveLength(1);
    expect(pet.dead).toBe(true);
  });

  it("Maelstrom drags enemies to its middle, then the middle of the floor goes", () => {
    const s = scene("tide", "fang");
    place(s.a, -4.5, 13);
    place(s.b, -4.5 + 3, 5);
    s.a.energy = rules.energy.max;
    s.press(0, "ultimate", -4.5, 5);
    const ev = s.run(maelstrom.castTime! + maelstrom.delay + 0.1);
    expect(of(ev, "groundBurst")).toHaveLength(1);
    expect(Math.abs(s.b.x + 4.5)).toBeLessThan(1);
    expect(s.b.hp).toBe(s.b.maxHp - maelstrom.onHit.damage);
    expect(s.state.floor.hp[tileAt(-4.5, 5)]).toBe(0);
    // The rim of the whirl stays to stand on.
    expect(s.state.floor.hp[tileAt(-4.5 + maelstrom.radius - 0.3, 5)]).toBe(arena.floor.hp);
  });
});

describe("training mode", () => {
  it("has no countdown, a dummy that heals back, and no round end", () => {
    const s = scene("ember", "dummy", { mode: "training" });
    expect(s.b.controller).toBe("dummy");
    s.b.hp = 5;
    s.b.lastHurtAt = s.state.roundTime;
    s.run(training.dummy.regenDelay + 0.2);
    expect(s.b.hp).toBe(s.b.maxHp);
    s.b.hp = 1;
    s.b.burn = 1;
    s.b.burnDps = 10;
    s.b.burnTick = 0;
    const ev = s.run(3);
    expect(of(ev, "death")).toHaveLength(1);
    expect(of(ev, "respawn")).toHaveLength(1);
    expect(s.state.phase).toBe("fight");
    expect(s.b.dead).toBe(false);
  });

  it("stands a fallen champion back up on floor that is still there, and the arena reset mends the floor", () => {
    const s = scene("ember", "dummy", { mode: "training" });
    place(s.a, 0, 12);
    for (let i = 0; i < floorTiles.length; i++) if (Math.hypot(floorTiles[i]!.x, floorTiles[i]!.z - 12) < 3) s.state.floor.hp[i] = 0;
    const ev = s.run(training.respawn + 0.2);
    expect(of(ev, "fall")).toHaveLength(1);
    expect(of(ev, "respawn")).toHaveLength(1);
    expect(s.a.dead).toBe(false);
    expect(solidAt(s.state, s.a.x, s.a.z)).toBe(true);
    s.run(1);
    expect(s.a.dead).toBe(false);
    trainingCommand(s.state, { t: "resetArena" });
    expect(s.state.floor.hp.every((hp) => hp === arena.floor.hp)).toBe(true);
  });

  it("does not start sudden death on its own, but the range can toggle it", () => {
    const s = scene("fang", "dummy", { mode: "training" });
    s.state.roundTime = arena.suddenDeath.startAt + 5;
    s.run(0.5);
    expect(s.state.suddenDeath.active).toBe(false);
    trainingCommand(s.state, { t: "toggleSuddenDeath" });
    s.run(arena.suddenDeath.rifts.firstAfter + 0.2);
    expect(s.state.rifts.length).toBe(2);
    trainingCommand(s.state, { t: "toggleSuddenDeath" });
    expect(s.state.rifts.length).toBe(0);
  });

  it("applies tuning multipliers and ignores commands in a real match", () => {
    const s = scene("ember", "dummy", { mode: "training" });
    trainingCommand(s.state, { t: "setTuning", tuning: { moveSpeed: 0.5 } });
    place(s.a, 0, 14);
    s.inputs[0].move = { x: 1, z: 0 };
    s.run(0.5);
    expect(s.a.vx).toBeCloseTo(ember.stats.moveSpeed * 0.5, 3);
    const duel = scene();
    trainingCommand(duel.state, { t: "fillEnergy" });
    expect(duel.a.energy).toBeLessThan(rules.energy.max);
  });
});

describe("bots", () => {
  const ids = ["ember", "fang", "rook", "tide"] as const;
  for (const a of ids) {
    for (const b of ids) {
      it(`${a} vs ${b} finishes a match`, () => {
        const r = runBotMatch({ seed: 3, champions: [a, b], difficulty: "hard" });
        expect(r.winner).not.toBe(-1);
        expect(Math.max(...r.score)).toBe(rules.roundsToWin);
      });
    }
  }
});
