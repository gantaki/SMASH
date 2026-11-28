// Scripted scenarios: each gameplay rule gets a small deterministic situation (CLAUDE.md rule 5).
import { describe, expect, it } from "vitest";
import { arena, ember, fang, rules, training, type AbilitySlot } from "@smash/content";
import {
  TICK_DT,
  championOfTeam,
  companionOf,
  createMatch,
  currentSlow,
  polylineDistance,
  emptyInput,
  runBotMatch,
  step,
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
    s.press(0, "q", 5, 8);
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

  it("break wood walls", () => {
    const s = scene();
    place(s.a, 0, 9);
    place(s.b, 12, -12);
    const wall = s.state.obstacles.find((o) => o.kind === "wood" && o.z === 5)!;
    s.inputs[0].holdPrimary = true;
    s.inputs[0].aim = { x: 0, z: 5 };
    s.run(5);
    expect(wall.alive).toBe(false);
  });

  it("split into three when Ember's Fireball passes through her Wisp", () => {
    const s = scene("ember", "fang", { companions: true });
    place(s.a, -10, 14);
    place(s.b, 10, -14);
    const wisp = companionOf(s.state, s.a)!;
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
    const hound = companionOf(s.state, s.a)!;
    hound.mode = "go";
    hound.tx = 0;
    hound.tz = 8;
    place(hound, 0, 8);
    s.press(0, "secondary", 0, 8);
    s.run(1.2);
    expect(Math.hypot(s.a.x - hound.x, s.a.z - hound.z)).toBeLessThan(2.2);
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
    const hound = companionOf(s.state, s.a)!;
    Object.assign(hound, { x: 7.2, z: -2, mode: "engage", modeTime: 5, target: s.b.id, attackTimer: 0 });
    // Park the victim's own companion out of the way.
    const wisp = companionOf(s.state, s.b)!;
    wisp.dead = true;
    wisp.respawn = 1e9;
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
    s.press(0, "q", 0, edge);
    const ev = s.run(0.6);
    expect(of(ev, "slam")).toHaveLength(1);
    expect(s.b.hp).toBe(s.b.maxHp - 10 - (rules.slam.damage + 10));
    expect(s.b.stun).toBeGreaterThan(0.6);
  });

  it("Counter negates the hit, stuns the attacker and empowers the next Cleave", () => {
    const s = scene("fang", "ember");
    place(s.a, 5, 10);
    place(s.b, 5, 4);
    s.press(0, "e", 5, 4);
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
    const ring = ember.abilities.q!;
    if (ring.kind !== "groundAoe") throw new Error("expected groundAoe");
    s.press(0, "q", 0, 0.5);
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
    s.press(1, "e", 0, 10);
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
  for (const [a, b] of [
    ["ember", "fang"],
    ["fang", "ember"],
    ["ember", "ember"],
    ["fang", "fang"],
  ] as const) {
    it(`${a} vs ${b} finishes a match`, () => {
      const r = runBotMatch({ seed: 3, champions: [a, b], difficulty: "hard" });
      expect(r.winner).not.toBe(-1);
      expect(Math.max(...r.score)).toBe(rules.roundsToWin);
    });
  }
});
