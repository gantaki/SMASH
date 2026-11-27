// Client-side prediction. The server is the authority; the client keeps the latest authoritative state and the
// inputs the server has not consumed yet, and re-simulates them on top of every snapshot. Because the sim is
// deterministic, the player's own champion lands exactly where the server will put it; the opponent is
// extrapolated from their last known input until the next snapshot corrects it.

import { withConfig, type NetState } from "@smash/protocol";
import { championOfTeam, step, type MatchConfig, type MatchState, type PlayerInput, type SimEvent, type Team } from "@smash/sim";

/** How far a unit's predicted position moved when a snapshot arrived (old − new), for visual smoothing. */
export interface Correction {
  id: number;
  dx: number;
  dz: number;
}

/** Give up predicting further ahead than this many ticks (two seconds): the connection is effectively gone. */
const MAX_PENDING = 120;

export class Prediction {
  /** The predicted present: what the player sees. Replaced by a new object on every rebase. */
  state: MatchState;
  private auth: MatchState;
  private pending: { seq: number; input: PlayerInput }[] = [];
  private seq = 0;
  private fresh: { ack: number; state: NetState } | null = null;
  /** While set, the server is holding the match (kill cam): nothing is predicted until it moves past this tick. */
  private frozenAt = -1;

  constructor(
    private readonly config: MatchConfig,
    readonly team: Team,
    initial: NetState,
  ) {
    this.auth = withConfig(initial, config);
    this.state = structuredClone(this.auth);
  }

  /** Ticks the prediction is ahead of the last snapshot: roughly round-trip time × tick rate. */
  get lead(): number {
    return this.pending.length;
  }

  get frozen(): boolean {
    return this.frozenAt >= 0;
  }

  get authTick(): number {
    return this.auth.tick;
  }

  onSnapshot(ack: number, state: NetState): void {
    if (!this.fresh || state.tick >= this.fresh.state.tick) this.fresh = { ack, state };
  }

  /** The server is about to hold the match: stop predicting until a snapshot shows it moving again. */
  freeze(): void {
    this.rebase();
    this.frozenAt = this.auth.tick;
    this.pending = [];
  }

  /** What the remote player is assumed to be doing: holding their last movement and aim, pressing nothing new. */
  private inputs(state: MatchState, mine: PlayerInput): [PlayerInput, PlayerInput] {
    const other = championOfTeam(state, this.team === 0 ? 1 : 0);
    const theirs: PlayerInput = { move: { ...other.move }, aim: { ...other.aim }, press: [], holdPrimary: false, cancel: false };
    return this.team === 0 ? [mine, theirs] : [theirs, mine];
  }

  /**
   * Applies the newest snapshot, if one arrived since the last call: rewinds to it and replays the inputs the
   * server has not consumed. Returns how far each unit jumped, so the view can hide the jump.
   */
  rebase(): Correction[] {
    const fresh = this.fresh;
    if (!fresh) return [];
    this.fresh = null;
    const before = new Map(this.state.units.map((u) => [u.id, { x: u.x, z: u.z }]));
    this.auth = withConfig(fresh.state, this.config);
    if (this.frozenAt >= 0) {
      if (this.auth.tick <= this.frozenAt) {
        this.state = structuredClone(this.auth);
        return [];
      }
      this.frozenAt = -1;
    }
    this.pending = this.pending.filter((p) => p.seq > fresh.ack);
    const next = structuredClone(this.auth);
    for (const p of this.pending) step(next, this.inputs(next, p.input));
    this.state = next;
    const out: Correction[] = [];
    for (const u of next.units) {
      const b = before.get(u.id);
      if (b && (b.x !== u.x || b.z !== u.z)) out.push({ id: u.id, dx: b.x - u.x, dz: b.z - u.z });
    }
    return out;
  }

  /**
   * Predicts one tick with the local input. Returns the sequence number to send to the server and the events of
   * the predicted tick, or null if nothing was predicted (match held, or too far ahead of the server).
   */
  advance(input: PlayerInput): { seq: number; events: SimEvent[] } | null {
    if (this.frozenAt >= 0 || this.pending.length >= MAX_PENDING) return null;
    const seq = ++this.seq;
    this.pending.push({ seq, input });
    return { seq, events: step(this.state, this.inputs(this.state, input)) };
  }
}
