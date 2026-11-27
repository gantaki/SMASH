// One authoritative match. Runs the same simulation as the client, fed by the players' inputs.
// No sockets and no clock in here: the caller delivers inputs, calls tick() at the tick rate and gets messages
// to send back, so the whole thing can be driven by tests.

import { ABILITY_SLOTS, rules, type AbilitySlot } from "@smash/content";
import { stripConfig, type NetFrame, type ServerMessage } from "@smash/protocol";
import { createMatch, emptyInput, step, type MatchConfig, type MatchState, type PlayerInput, type SimEvent, type Team } from "@smash/sim";

interface Seat {
  queue: { seq: number; input: PlayerInput }[];
  last: PlayerInput;
  ack: number;
  events: SimEvent[];
}

const TICK = 1 / rules.tickRate;
const MAX_PRESSES = 4;
const finite = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Never trust the wire: rebuild the input from validated pieces. */
export function sanitizeInput(raw: unknown): PlayerInput {
  const r = (raw ?? {}) as Partial<Record<keyof PlayerInput, unknown>>;
  const vec = (v: unknown) => {
    const o = (v ?? {}) as { x?: unknown; z?: unknown };
    return { x: finite(o.x), z: finite(o.z) };
  };
  const press = Array.isArray(r.press)
    ? r.press.filter((s): s is AbilitySlot => typeof s === "string" && (ABILITY_SLOTS as readonly string[]).includes(s)).slice(0, MAX_PRESSES)
    : [];
  return { move: vec(r.move), aim: vec(r.aim), press, holdPrimary: r.holdPrimary === true, cancel: r.cancel === true };
}

export class NetMatch {
  readonly state: MatchState;
  private readonly seats: [Seat, Seat];
  private history: NetFrame[] = [];
  /** Ticks left of the kill cam pause. */
  private hold = 0;
  private sinceSnapshot = 0;
  private over = false;

  constructor(
    readonly config: MatchConfig,
    private readonly send: (team: Team, msg: ServerMessage) => void,
  ) {
    this.state = createMatch(config);
    const seat = (): Seat => ({ queue: [], last: emptyInput(), ack: 0, events: [] });
    this.seats = [seat(), seat()];
  }

  get finished(): boolean {
    return this.over;
  }

  /** Call once after construction: tells both players the match has begun. */
  start(): void {
    for (const team of [0, 1] as const) this.send(team, { t: "start", team, config: this.config, state: stripConfig(this.state) });
  }

  onInput(team: Team, seq: unknown, input: unknown): void {
    // During the kill cam pause the clients are watching a replay: nothing they send counts.
    if (this.over || this.hold > 0 || typeof seq !== "number" || !Number.isInteger(seq)) return;
    const seat = this.seats[team];
    const newest = seat.queue.length ? seat.queue[seat.queue.length - 1]!.seq : seat.ack;
    if (seq <= newest) return;
    seat.queue.push({ seq, input: sanitizeInput(input) });
    // A burst after a network hiccup: skip the oldest inputs to catch up, but keep their key presses.
    while (seat.queue.length > rules.net.inputQueue) {
      const dropped = seat.queue.shift()!;
      const next = seat.queue[0]!;
      next.input = { ...next.input, press: [...dropped.input.press, ...next.input.press].slice(-MAX_PRESSES), cancel: next.input.cancel || dropped.input.cancel };
      seat.ack = dropped.seq;
    }
  }

  private take(team: Team): PlayerInput {
    const seat = this.seats[team];
    const next = seat.queue.shift();
    if (next) {
      seat.ack = next.seq;
      seat.last = next.input;
      return next.input;
    }
    // Nothing arrived in time: keep doing what the player was doing, without repeating key presses.
    return { ...seat.last, press: [], cancel: false };
  }

  private snapshot(): void {
    this.sinceSnapshot = 0;
    const state = stripConfig(this.state);
    for (const team of [0, 1] as const) {
      const seat = this.seats[team];
      this.send(team, { t: "snap", ack: seat.ack, state, events: seat.events });
      seat.events = [];
    }
  }

  /** Advances the match by one tick. */
  tick(): void {
    if (this.over) return;
    if (this.hold > 0) {
      this.hold--;
      return;
    }
    const state = this.state;
    const inputs: [PlayerInput, PlayerInput] = [this.take(0), this.take(1)];
    if (state.phase === "fight") {
      this.history.push({ state: structuredClone(stripConfig(state)), inputs });
      const keep = Math.round(rules.killCam.rewind / TICK);
      if (this.history.length > keep) this.history.shift();
    }
    const events = step(state, inputs);
    for (const seat of this.seats) seat.events.push(...events);

    const decided = events.some((e) => e.t === "roundEnd");
    if (++this.sinceSnapshot >= rules.net.snapshotEvery || decided || state.phase === "matchEnd") this.snapshot();
    if (decided) {
      // Clients replay the final blow; hold the match so the next round does not start under the replay.
      const frames = this.history;
      this.history = [];
      for (const team of [0, 1] as const) this.send(team, { t: "killcam", frames, pause: rules.killCam.serverPause });
      this.hold = Math.round(rules.killCam.serverPause / TICK);
      for (const seat of this.seats) seat.queue = [];
    }
    if (state.phase === "matchEnd") {
      this.over = true;
      for (const team of [0, 1] as const) {
        this.send(team, { t: "end", reason: "finished", winner: state.winner, score: [state.score[0], state.score[1]] });
      }
    }
  }

  /** A player left: the match ends for the one who stayed. */
  abandon(leaver: Team): void {
    if (this.over) return;
    this.over = true;
    const stayed: Team = leaver === 0 ? 1 : 0;
    this.send(stayed, { t: "end", reason: "opponent_left", winner: stayed, score: [this.state.score[0], this.state.score[1]] });
  }
}
