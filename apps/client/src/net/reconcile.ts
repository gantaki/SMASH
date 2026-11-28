// Host-authoritative netcode engine: Host runs the sim at 60 Hz and emits 20 Hz snapshots;
// Guest predicts its own champion locally and reconciles against authoritative snapshots.

import type { AbilitySlot, ChampionId } from "@smash/content";
import { NET_SNAPSHOT_EVERY_TICKS, sanitizeNetInput, type NetInput, type NetSnapshot } from "@smash/protocol";
import { championOfTeam, createMatch, step, type MatchState, type PlayerInput, type SimEvent } from "@smash/sim";
import { ReplayRecorder, isReplay, type Replay } from "./replay.ts";

export type GameSnapshot = NetSnapshot<MatchState, SimEvent>;

/**
 * Sent by the host when a round is decided: the last moments of the fight, for the kill cam.
 * `tick` is the tick that decided the round; the host holds the match there until it calls release().
 */
export interface KillCamPacket extends Replay {
  tick: number;
}

/** Shape check for a kill cam packet that arrived from the other peer. */
export function isKillCamPacket(raw: unknown): raw is KillCamPacket {
  return isReplay(raw) && Number.isInteger((raw as { tick?: unknown }).tick);
}

export interface OnlineMatchConfig {
  seed: number;
  hostChampion: ChampionId;
  guestChampion: ChampionId;
}

const CRITICAL_EVENTS = new Set<SimEvent["t"]>(["phase", "roundEnd", "matchEnd"]);
const MAX_GUEST_QUEUE = 6;
const TRIM_GUEST_QUEUE_TO = 4;
const MAX_PENDING_INPUTS = 60;

export function toNetInput(seq: number, input: PlayerInput): NetInput {
  return {
    seq,
    moveX: input.move.x,
    moveZ: input.move.z,
    aimX: input.aim.x,
    aimZ: input.aim.z,
    press: [...input.press],
    holdPrimary: input.holdPrimary,
    cancel: input.cancel,
  };
}

export function fromNetInput(net: NetInput): PlayerInput {
  return {
    move: { x: net.moveX, z: net.moveZ },
    aim: { x: net.aimX, z: net.aimZ },
    press: [...net.press],
    holdPrimary: net.holdPrimary,
    cancel: net.cancel,
  };
}

function buildOnlineMatch(cfg: OnlineMatchConfig): MatchState {
  return createMatch({
    seed: cfg.seed,
    mode: "duel",
    players: [
      { champion: cfg.hostChampion, controller: "human" },
      { champion: cfg.guestChampion, controller: "human" },
    ],
  });
}

/** Authoritative host session (Team 0). */
export class HostSession {
  readonly state: MatchState;
  private readonly guestQueue: NetInput[] = [];
  private lastReceivedSeq = 0;
  private ackSeq = 0;
  private lastGuestContinuous: PlayerInput;
  private readonly pendingEvents: SimEvent[] = [];
  private readonly recorder = new ReplayRecorder();
  private holding = false;

  constructor(cfg: OnlineMatchConfig) {
    this.state = buildOnlineMatch(cfg);
    const guest = championOfTeam(this.state, 1);
    this.lastGuestContinuous = {
      move: { x: 0, z: 0 },
      aim: { x: guest.x, z: guest.z + 6 },
      press: [],
      holdPrimary: false,
      cancel: false,
    };
  }

  pushGuestInput(raw: unknown): void {
    const net = sanitizeNetInput(raw);
    if (!net || net.seq <= this.lastReceivedSeq) return;
    this.lastReceivedSeq = net.seq;
    // While the match is held for the kill cam the guest is watching a replay: nothing it sends counts.
    if (!this.holding) this.guestQueue.push(net);
  }

  /** True between a round being decided and release(): the sim does not advance. */
  get isHolding(): boolean {
    return this.holding;
  }

  /** Both players have watched the kill cam: let the match go on. */
  release(): void {
    this.holding = false;
  }

  stepTick(hostInput: PlayerInput): { events: SimEvent[]; snapshot: GameSnapshot | null; replay: KillCamPacket | null } {
    if (this.holding) return { events: [], snapshot: null, replay: null };
    if (this.guestQueue.length > MAX_GUEST_QUEUE) {
      const dropCount = this.guestQueue.length - TRIM_GUEST_QUEUE_TO;
      const head = this.guestQueue[dropCount]!;
      const mergedPress: AbilitySlot[] = [];
      let mergedCancel = false;
      for (let i = 0; i < dropCount; i++) {
        const dropped = this.guestQueue[i]!;
        if (dropped.press.length) mergedPress.push(...dropped.press);
        if (dropped.cancel) mergedCancel = true;
      }
      if (mergedPress.length) head.press = [...mergedPress, ...head.press];
      if (mergedCancel) head.cancel = true;
      this.guestQueue.splice(0, dropCount);
    }

    let guestInput: PlayerInput;
    const next = this.guestQueue.shift();
    if (next) {
      this.ackSeq = next.seq;
      guestInput = fromNetInput(next);
      this.lastGuestContinuous = {
        move: { ...guestInput.move },
        aim: { ...guestInput.aim },
        press: [],
        holdPrimary: guestInput.holdPrimary,
        cancel: false,
      };
    } else {
      guestInput = {
        move: { ...this.lastGuestContinuous.move },
        aim: { ...this.lastGuestContinuous.aim },
        press: [],
        holdPrimary: this.lastGuestContinuous.holdPrimary,
        cancel: false,
      };
    }

    if (this.state.phase === "fight") this.recorder.record(this.state, [hostInput, guestInput]);
    const events = step(this.state, [hostInput, guestInput]);
    this.pendingEvents.push(...events);

    const shouldSnap =
      this.state.tick % NET_SNAPSHOT_EVERY_TICKS === 0 || events.some((e) => CRITICAL_EVENTS.has(e.t));

    const snapshot: GameSnapshot | null = shouldSnap
      ? { tick: this.state.tick, ackSeq: this.ackSeq, state: structuredClone(this.state), events: this.pendingEvents.splice(0) }
      : null;

    // A round was decided: hand out the replay of its last moments and hold the match while it is watched.
    let replay: KillCamPacket | null = null;
    if (events.some((e) => e.t === "roundEnd")) {
      const recorded = this.recorder.take();
      if (recorded) {
        replay = { tick: this.state.tick, ...recorded };
        this.holding = true;
        this.guestQueue.length = 0;
      }
    }
    return { events, snapshot, replay };
  }
}

/** Guest prediction & reconciliation session (Team 1). */
export class GuestSession {
  state: MatchState;
  private lastSnapTick = -1;
  private nextSeq = 1;
  private pendingInputs: NetInput[] = [];
  private remoteHold: PlayerInput;
  /** The latest authoritative state, without any prediction on top. */
  private lastAuth: MatchState;
  /** While >= 0 the host is holding the match at this tick (kill cam): nothing is predicted. */
  private frozenAt = -1;

  constructor(cfg: OnlineMatchConfig) {
    this.state = buildOnlineMatch(cfg);
    this.lastAuth = structuredClone(this.state);
    const host = championOfTeam(this.state, 0);
    this.remoteHold = {
      move: { x: 0, z: 0 },
      aim: { x: host.x, z: host.z - 6 },
      press: [],
      holdPrimary: false,
      cancel: false,
    };
  }

  get pendingCount(): number {
    return this.pendingInputs.length;
  }

  get frozen(): boolean {
    return this.frozenAt >= 0;
  }

  /**
   * The host decided a round at `tick` and holds the match there. Stop predicting (the prediction would run on
   * into the next round) until a snapshot from a later tick shows the host moving again.
   */
  freeze(tick: number): void {
    this.frozenAt = Math.max(tick, this.lastSnapTick);
    this.pendingInputs = [];
    this.state = structuredClone(this.lastAuth);
  }

  /** Predicts one tick with the local input. Returns the input to send, or null while the match is held. */
  stepLocal(localInput: PlayerInput): NetInput | null {
    if (this.frozenAt >= 0) return null;
    const net = toNetInput(this.nextSeq++, localInput);
    this.pendingInputs.push(net);
    if (this.pendingInputs.length > MAX_PENDING_INPUTS) this.pendingInputs.shift();
    if (this.state.phase !== "matchEnd") {
      step(this.state, [this.remoteHold, localInput]);
    }
    return net;
  }

  applySnapshot(snap: GameSnapshot): { events: SimEvent[]; authState: MatchState } | null {
    if (snap.tick <= this.lastSnapTick) return null;
    this.lastSnapTick = snap.tick;
    this.lastAuth = snap.state;
    if (this.frozenAt >= 0) {
      if (snap.tick <= this.frozenAt) {
        // Still held: show exactly what the host has.
        this.state = structuredClone(snap.state);
        return { events: snap.events, authState: snap.state };
      }
      this.frozenAt = -1;
    }
    this.pendingInputs = this.pendingInputs.filter((i) => i.seq > snap.ackSeq);

    const rebuilt = structuredClone(snap.state);
    const hostChamp = championOfTeam(snap.state, 0);
    this.remoteHold = {
      move: { ...hostChamp.move },
      aim: { ...hostChamp.aim },
      press: [],
      holdPrimary: false,
      cancel: false,
    };
    const remoteStill: PlayerInput = {
      move: { x: 0, z: 0 },
      aim: { ...this.remoteHold.aim },
      press: [],
      holdPrimary: false,
      cancel: false,
    };

    for (let i = 0; i < this.pendingInputs.length; i++) {
      if (rebuilt.phase === "matchEnd") break;
      step(rebuilt, [i < 4 ? this.remoteHold : remoteStill, fromNetInput(this.pendingInputs[i]!)]);
    }

    this.state = rebuilt;
    return { events: snap.events, authState: snap.state };
  }
}
