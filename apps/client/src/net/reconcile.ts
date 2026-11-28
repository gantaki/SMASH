// Host-authoritative netcode engine: Host runs the sim at 60 Hz and emits 20 Hz snapshots;
// Guest predicts its own champion locally and reconciles against authoritative snapshots.

import type { AbilitySlot, ChampionId } from "@smash/content";
import { NET_SNAPSHOT_EVERY_TICKS, sanitizeNetInput, type NetInput, type NetSnapshot } from "@smash/protocol";
import { championOfTeam, createMatch, step, type MatchState, type PlayerInput, type SimEvent } from "@smash/sim";

export type GameSnapshot = NetSnapshot<MatchState, SimEvent>;

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
    this.guestQueue.push(net);
  }

  stepTick(hostInput: PlayerInput): { events: SimEvent[]; snapshot: GameSnapshot | null } {
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

    const events = step(this.state, [hostInput, guestInput]);
    this.pendingEvents.push(...events);

    const shouldSnap =
      this.state.tick % NET_SNAPSHOT_EVERY_TICKS === 0 || events.some((e) => CRITICAL_EVENTS.has(e.t));

    if (!shouldSnap) return { events, snapshot: null };

    const snapshot: GameSnapshot = {
      tick: this.state.tick,
      ackSeq: this.ackSeq,
      state: structuredClone(this.state),
      events: this.pendingEvents.splice(0),
    };
    return { events, snapshot };
  }
}

/** Guest prediction & reconciliation session (Team 1). */
export class GuestSession {
  state: MatchState;
  private lastSnapTick = -1;
  private nextSeq = 1;
  private pendingInputs: NetInput[] = [];
  private remoteHold: PlayerInput;

  constructor(cfg: OnlineMatchConfig) {
    this.state = buildOnlineMatch(cfg);
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

  stepLocal(localInput: PlayerInput): NetInput {
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
