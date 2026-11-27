// Server match + client prediction, joined by a simulated network link (no sockets, no clock).
import { describe, expect, it } from "vitest";
import { rules } from "@smash/content";
import type { ServerMessage } from "@smash/protocol";
import { championOfTeam, emptyInput, type MatchConfig, type PlayerInput, type Team } from "@smash/sim";
import { Prediction } from "../apps/client/src/net/Prediction.ts";
import { NetMatch } from "../apps/server/src/match.ts";

const config: MatchConfig = {
  seed: 9,
  mode: "duel",
  players: [
    { champion: "ember", controller: "human" },
    { champion: "fang", controller: "human" },
  ],
};

interface Packet {
  at: number;
  run: () => void;
}

/** Two clients and a server on one timeline; every message takes `delay` ticks each way. */
function world(delay: number) {
  let now = 0;
  const wire: Packet[] = [];
  const later = (run: () => void) => wire.push({ at: now + delay, run });
  const clients: (Prediction | null)[] = [null, null];
  const corrections: number[] = [0, 0];
  const received: [ServerMessage[], ServerMessage[]] = [[], []];
  /** Server state after each tick, to compare a client's view with what the server had at that same tick. */
  const history = new Map<number, string>();
  const server = new NetMatch(config, (team: Team, live) => {
    // A real socket serializes: the client must not share objects with the live server state.
    const msg = JSON.parse(JSON.stringify(live)) as ServerMessage;
    later(() => {
      received[team].push(msg);
      if (msg.t === "start") clients[team] = new Prediction(msg.config, msg.team, msg.state);
      if (msg.t === "snap") clients[team]?.onSnapshot(msg.ack, msg.state);
      if (msg.t === "killcam") clients[team]?.freeze();
    });
  });
  server.start();
  /** One tick everywhere. `input(team)` is what each player holds this tick. */
  const tick = (input: (team: Team) => PlayerInput) => {
    // Deliver what is due, in the order it was sent.
    const due = wire.filter((p) => p.at <= now);
    for (const p of due) wire.splice(wire.indexOf(p), 1);
    for (const p of due) p.run();
    for (const team of [0, 1] as const) {
      const c = clients[team];
      if (!c) continue;
      const me = championOfTeam(c.state, team).id;
      for (const k of c.rebase()) if (k.id === me) corrections[team]! = Math.max(corrections[team]!, Math.hypot(k.dx, k.dz));
      const mine = input(team);
      const sent = c.advance(mine);
      if (sent) later(() => server.onInput(team, sent.seq, mine));
    }
    server.tick();
    const { config: _c, ...rest } = server.state;
    history.set(server.state.tick, JSON.stringify(rest));
    now++;
  };
  const run = (ticks: number, input: (team: Team) => PlayerInput = () => emptyInput()) => {
    for (let i = 0; i < ticks; i++) tick(input);
  };
  return { server, clients, corrections, received, run, history };
}

const FIGHT = Math.ceil(rules.countdown * rules.tickRate) + 30;

describe("netcode", () => {
  for (const delay of [0, 3, 6]) {
    const ms = Math.round((delay * 2000) / rules.tickRate);
    it(`predicts the local champion exactly at ${ms} ms round trip: no rubber-banding`, () => {
      const w = world(delay);
      w.run(FIGHT);
      w.corrections.fill(0);
      // Player 0 runs in a square and attacks; player 1 strafes.
      const input = (team: Team): PlayerInput => {
        const phase = Math.floor(w.server.state.tick / 25) % 4;
        const dir = [
          { x: 1, z: 0 },
          { x: 0, z: 1 },
          { x: -1, z: 0 },
          { x: 0, z: -1 },
        ][phase]!;
        return team === 0
          ? { move: dir, aim: { x: 3, z: 0 }, press: w.server.state.tick % 40 === 0 ? ["primary"] : [], holdPrimary: false, cancel: false }
          : { ...emptyInput(), move: { x: phase % 2 ? 1 : -1, z: 0 }, aim: { x: 0, z: 0 } };
      };
      w.run(400, input);
      // The local champion never has to be corrected: the server reproduces what the client predicted.
      expect(w.corrections[0]).toBeLessThan(1e-9);
      expect(w.corrections[1]).toBeLessThan(1e-9);
      // The prediction runs ahead of the snapshot by about the round trip.
      expect(w.clients[0]!.lead).toBeGreaterThanOrEqual(delay * 2);
      expect(w.clients[0]!.lead).toBeLessThanOrEqual(delay * 2 + rules.net.snapshotEvery + 2);

      // Everyone lets go of the keys: once the opponent's last input has arrived, each client's predicted
      // present is exactly the state the server reaches at that tick.
      w.run(delay * 2 + 30);
      const ahead = w.clients.map((c) => c!.state);
      w.run(delay * 2 + 10);
      for (const state of ahead) {
        const { config: _c, ...mine } = state;
        expect(JSON.parse(JSON.stringify(mine))).toEqual(JSON.parse(w.history.get(state.tick)!));
      }
    });
  }

  it("shows the opponent where the server will have them, as long as they keep doing the same thing", () => {
    const w = world(4);
    w.run(FIGHT);
    const start = championOfTeam(w.server.state, 1).x;
    const strafe = (team: Team) => (team === 1 ? { ...emptyInput(), move: { x: 1, z: 0 } } : emptyInput());
    w.run(40, strafe);
    const view = w.clients[0]!.state;
    // The predicted state is advanced in place: note the tick now.
    const tick = view.tick;
    const seen = championOfTeam(view, 1).x;
    expect(seen).toBeGreaterThan(start + 2);
    // The client is ahead of the server; let the server reach that tick and compare.
    expect(w.server.state.tick).toBeLessThan(tick);
    w.run(20, strafe);
    const actual = (JSON.parse(w.history.get(tick)!) as typeof view).units.find((u) => u.kind === "champion" && u.team === 1)!;
    expect(seen).toBeCloseTo(actual.x, 6);
  });

  it("freezes during the kill cam and resumes with the server", () => {
    const w = world(3);
    w.run(FIGHT);
    Object.assign(championOfTeam(w.server.state, 1), { hp: 1, burn: 1, burnDps: 10, burnTick: 0 });
    w.run(30);
    expect(w.received[0].some((m) => m.t === "killcam")).toBe(true);
    const c = w.clients[0]!;
    expect(c.frozen).toBe(true);
    expect(c.advance(emptyInput())).toBeNull();
    const held = c.state.tick;
    w.run(Math.round(rules.killCam.serverPause * rules.tickRate) - 60);
    expect(c.state.tick).toBe(held);
    expect(c.state.phase).toBe("roundEnd");
    w.run(120 + Math.round(rules.roundEndDelay * rules.tickRate));
    expect(c.frozen).toBe(false);
    expect(w.server.state.round).toBe(2);
    expect(c.state.round).toBe(2);
  });
});
