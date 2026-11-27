import { describe, expect, it } from "vitest";
import { rules } from "@smash/content";
import type { ServerMessage } from "@smash/protocol";
import { championOfTeam, emptyInput, type MatchConfig, type PlayerInput, type Team } from "@smash/sim";
import { NetMatch, sanitizeInput } from "./match.ts";

const config: MatchConfig = {
  seed: 5,
  mode: "duel",
  players: [
    { champion: "ember", controller: "human" },
    { champion: "fang", controller: "human" },
  ],
};

function harness() {
  const out: [ServerMessage[], ServerMessage[]] = [[], []];
  const match = new NetMatch(config, (team: Team, msg) => out[team].push(msg));
  const of = <T extends ServerMessage["t"]>(team: Team, t: T) => out[team].filter((m): m is Extract<ServerMessage, { t: T }> => m.t === t);
  const run = (ticks: number) => {
    for (let i = 0; i < ticks; i++) match.tick();
  };
  const toFight = () => run(Math.ceil(rules.countdown * rules.tickRate) + 2);
  return { match, out, of, run, toFight };
}

const walk = (x: number): PlayerInput => ({ ...emptyInput(), move: { x, z: 0 } });

describe("NetMatch", () => {
  it("tells each player their team and sends snapshots at the configured rate", () => {
    const h = harness();
    h.match.start();
    expect(h.of(0, "start")[0]?.team).toBe(0);
    expect(h.of(1, "start")[0]?.team).toBe(1);
    h.run(20);
    expect(h.of(0, "snap")).toHaveLength(20 / rules.net.snapshotEvery);
    expect(h.of(0, "snap").at(-1)!.state.tick).toBe(20);
    // The static config travels once, in `start`.
    expect("config" in h.of(0, "snap")[0]!.state).toBe(false);
  });

  it("consumes one input per tick in order and acknowledges it", () => {
    const h = harness();
    h.toFight();
    const x0 = championOfTeam(h.match.state, 0).x;
    for (let seq = 1; seq <= 2; seq++) h.match.onInput(0, seq, walk(1));
    h.run(2);
    expect(h.of(0, "snap").at(-1)!.ack).toBe(2);
    expect(h.of(1, "snap").at(-1)!.ack).toBe(0);
    for (let seq = 3; seq <= 4; seq++) h.match.onInput(0, seq, walk(1));
    h.run(2);
    expect(h.of(0, "snap").at(-1)!.ack).toBe(4);
    expect(championOfTeam(h.match.state, 0).x).toBeGreaterThan(x0);
  });

  it("keeps moving on the last input when packets are late, without repeating key presses", () => {
    const h = harness();
    h.toFight();
    h.match.onInput(0, 1, { ...walk(1), press: ["mobility"] });
    h.run(30);
    const me = championOfTeam(h.match.state, 0);
    expect(me.vx).toBeGreaterThan(0);
    // One Blink, not one per tick: its cooldown started once and has been running since.
    expect(me.cooldowns.mobility).toBeGreaterThan(0);
    expect(me.buffer).toBeNull();
  });

  it("catches up after a burst by skipping old inputs but keeping their key presses", () => {
    const h = harness();
    h.toFight();
    const n = rules.net.inputQueue + 6;
    h.match.onInput(0, 1, { ...emptyInput(), press: ["mobility"], aim: { x: 5, z: 5 } });
    for (let seq = 2; seq <= n; seq++) h.match.onInput(0, seq, { ...emptyInput(), aim: { x: 5, z: 5 } });
    h.run(rules.net.inputQueue + rules.net.snapshotEvery);
    expect(h.of(0, "snap").at(-1)!.ack).toBe(n);
    expect(championOfTeam(h.match.state, 0).cooldowns.mobility).toBeGreaterThan(0);
  });

  it("ignores stale, duplicate and malformed inputs", () => {
    const h = harness();
    h.toFight();
    h.match.onInput(0, 3, walk(1));
    h.match.onInput(0, 3, walk(-1));
    h.match.onInput(0, 2, walk(-1));
    h.match.onInput(0, "4", walk(-1));
    h.run(4);
    expect(h.of(0, "snap").at(-1)!.ack).toBe(3);
    expect(sanitizeInput({ move: { x: "1", z: NaN }, aim: null, press: ["q", "nope", 7], holdPrimary: "yes" })).toEqual({
      move: { x: 0, z: 0 },
      aim: { x: 0, z: 0 },
      press: ["q"],
      holdPrimary: false,
      cancel: false,
    });
  });

  it("sends the kill cam replay when a round is decided and holds the match meanwhile", () => {
    const h = harness();
    h.toFight();
    h.run(60);
    const victim = championOfTeam(h.match.state, 1);
    Object.assign(victim, { hp: 1, burn: 1, burnDps: 10, burnTick: 0 });
    h.run(5);
    const cam = h.of(0, "killcam")[0]!;
    expect(cam.frames).toHaveLength(Math.round(rules.killCam.rewind * rules.tickRate));
    expect(cam.frames.at(-1)!.state.tick).toBe(h.match.state.tick - 1);
    // The snapshot of the deciding tick goes out before the replay.
    const lastSnap = h.of(0, "snap").at(-1)!;
    expect(lastSnap.events.some((e) => e.t === "roundEnd")).toBe(true);
    expect(h.out[0].indexOf(lastSnap)).toBeLessThan(h.out[0].indexOf(cam));

    const tick = h.match.state.tick;
    h.match.onInput(0, 999, walk(1));
    h.run(Math.round(rules.killCam.serverPause * rules.tickRate) - 10);
    expect(h.match.state.tick).toBe(tick);
    h.run(20);
    expect(h.match.state.tick).toBeGreaterThan(tick);
  });

  it("ends for the player who stayed when the other leaves", () => {
    const h = harness();
    h.toFight();
    h.match.abandon(0);
    expect(h.of(1, "end")[0]).toMatchObject({ reason: "opponent_left", winner: 1 });
    expect(h.match.finished).toBe(true);
  });
});
