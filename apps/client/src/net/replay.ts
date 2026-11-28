// Recording the last moments of a round so they can be re-simulated: the kill cam replay.
// The sim is deterministic and its state is plain data, so a replay is just the state it starts from plus the
// inputs of every tick after it. Offline the client records it; online the host does and sends it to the guest.

import { TICK_DT, type MatchState, type PlayerInput } from "@smash/sim";

/** What each team's player held during one tick (null for bots, which decide for themselves). */
export type InputPair = [PlayerInput | null, PlayerInput | null];

export interface Replay {
  /** State before the first recorded tick. */
  start: MatchState;
  /** Inputs of each recorded tick, oldest first. Stepping `start` through them reproduces the fight. */
  inputs: InputPair[];
}

/** How much of the fight is replayed when a round is decided, in seconds of game time. */
export const REPLAY_SECONDS = 0.6;
export const REPLAY_TICKS = Math.round(REPLAY_SECONDS / TICK_DT);

/** Longest replay a peer is allowed to send (a sanity bound on untrusted input). */
const MAX_REPLAY_TICKS = REPLAY_TICKS * 4;

/** Keeps the last REPLAY_TICKS ticks of a round. */
export class ReplayRecorder {
  private frames: { state: MatchState; inputs: InputPair }[] = [];

  /** Call before stepping the tick, with the inputs it is about to be stepped with. */
  record(state: MatchState, inputs: InputPair): void {
    this.frames.push({ state: structuredClone(state), inputs });
    if (this.frames.length > REPLAY_TICKS) this.frames.shift();
  }

  /** Hands over what was recorded and starts afresh. Null if there is too little to replay. */
  take(): Replay | null {
    const frames = this.frames;
    this.frames = [];
    if (frames.length < 2) return null;
    return { start: frames[0]!.state, inputs: frames.map((f) => f.inputs) };
  }

  clear(): void {
    this.frames = [];
  }
}

/** Shape check for a replay that arrived from another peer. The content is trusted as much as their snapshots are. */
export function isReplay(raw: unknown): raw is Replay {
  if (typeof raw !== "object" || raw === null) return false;
  const r = raw as { start?: unknown; inputs?: unknown };
  if (typeof r.start !== "object" || r.start === null || !Array.isArray((r.start as { units?: unknown }).units)) return false;
  return Array.isArray(r.inputs) && r.inputs.length >= 2 && r.inputs.length <= MAX_REPLAY_TICKS && r.inputs.every((p) => Array.isArray(p) && p.length === 2);
}
