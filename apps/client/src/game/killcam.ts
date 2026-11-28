// Kill cam: when a round is decided, rewind a moment and replay the final blow in slow motion from a low side camera.
// It is a real replay, not a recording: the sim is deterministic and its state is plain data, so a short record of
// (state, then the inputs of each tick) is re-simulated (net/replay.ts). Presentation only: nothing here feeds back
// into the match.

import { arena } from "@smash/content";
import { TICK_DT, blocker, step, type MatchState, type SimEvent, type Unit } from "@smash/sim";
import { REPLAY_SECONDS, type Replay } from "../net/replay.ts";

/** Presentation tuning. Times marked "sim" are simulated seconds; the rest is real time. */
export const KILL_CAM = {
  /** Sim seconds replayed before the kill. */
  rewind: REPLAY_SECONDS,
  /** Time scale when the replay starts, and around the blow. */
  scaleLead: 0.5,
  scaleImpact: 0.1,
  /** Sim seconds before the kill at which the slowest speed is reached, and after it for which it is held. */
  impactLead: 0.12,
  impactHold: 0.06,
  /** After the blow the body flies: time picks up a little, so the tumble reads, for `flight` sim seconds after the kill. */
  scaleFlight: 0.32,
  flightRamp: 0.1,
  flight: 0.55,
  /** Sim seconds over which time returns to normal. */
  recover: 0.3,
  fov: 34,
  /** Camera height: about shoulder level. Raised if every low angle is blocked. */
  height: 1.9,
  blockedHeight: 6,
  /** Far enough to keep both fighters head to toe inside the letterbox. */
  distance: { min: 8.5, max: 13, base: 7.5, perMeterApart: 0.9 },
  /** Height the camera looks at: chest level. */
  lookHeight: 1.3,
  /** A fall into the abyss is watched from above, looking down at the hole the body goes into. */
  fall: { height: 6.5, lookHeight: -1.5 },
  /** Killer and victim are framed together when this close; otherwise the camera stays on the victim. */
  pairRange: 6.5,
  /** Slow push-in and drift around the scene while it plays. */
  dolly: 0.12,
  orbitDeg: 12,
  /** Playback rate of sounds during slow motion. */
  soundRate: 0.6,
} as const;

/** Where the camera stands for the replay. */
export interface KillShot {
  victim: number;
  /** Unit id of the killer, or -1 (zone, rift, or too far away to frame). */
  killer: number;
  /** Point the camera circles: between killer and victim, or just in front of the victim. */
  focus: { x: number; z: number };
  /** Unit vector from the focus to the camera. */
  side: { x: number; z: number };
  distance: number;
  height: number;
  /** Height of the point the camera looks at. */
  lookHeight: number;
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Picks a side-on camera position with a clear view of the victim. `fell`: the victim went into the abyss. */
export function frameKill(state: MatchState, victim: Unit, killer: Unit | undefined, fell = false): KillShot {
  const height = fell ? KILL_CAM.fall.height : KILL_CAM.height;
  const lookHeight = fell ? KILL_CAM.fall.lookHeight : KILL_CAM.lookHeight;
  let dx = Math.sin(victim.face);
  let dz = Math.cos(victim.face);
  let span = 2.5;
  let paired = false;
  if (killer) {
    const kx = victim.x - killer.x;
    const kz = victim.z - killer.z;
    const d = Math.hypot(kx, kz);
    if (d > 0.2) {
      dx = kx / d;
      dz = kz / d;
    }
    paired = d <= KILL_CAM.pairRange;
    if (paired) span = d;
  }
  const focus = paired && killer ? { x: victim.x * 0.6 + killer.x * 0.4, z: victim.z * 0.6 + killer.z * 0.4 } : { x: victim.x - dx * 1.2, z: victim.z - dz * 1.2 };
  const distance = clamp(KILL_CAM.distance.base + span * KILL_CAM.distance.perMeterApart, KILL_CAM.distance.min, KILL_CAM.distance.max);
  // Perpendicular to the line of the blow. Prefer the side the gameplay camera is on (+z), so left stays left.
  const sides = [
    { x: -dz, z: dx },
    { x: dz, z: -dx },
  ].sort((a, b) => b.z - a.z);
  const limit = arena.radius - 1.2;
  for (const side of sides) {
    let cx = focus.x + side.x * distance;
    let cz = focus.z + side.z * distance;
    const r = Math.hypot(cx, cz);
    if (r > limit) {
      cx *= limit / r;
      cz *= limit / r;
    }
    const d = Math.hypot(cx - focus.x, cz - focus.z);
    if (d < KILL_CAM.distance.min * 0.75) continue; // squeezed against the wall
    const cam = { x: cx, z: cz };
    if (blocker(state, cam, victim, 0.15) || (paired && killer && blocker(state, cam, killer, 0.15))) continue;
    return { victim: victim.id, killer: paired && killer ? killer.id : -1, focus, side: { x: (cx - focus.x) / d, z: (cz - focus.z) / d }, distance: d, height, lookHeight };
  }
  // Every low angle is blocked or cramped: look down over the obstacles instead.
  const side = sides[0]!;
  return { victim: victim.id, killer: paired && killer ? killer.id : -1, focus, side, distance: KILL_CAM.distance.min, height: Math.max(height, KILL_CAM.blockedHeight), lookHeight };
}

/** How fast sim time runs `s` sim seconds into a kill cam whose replay is `length` sim seconds long. */
function timeScaleAt(s: number, length: number): number {
  const { scaleLead, scaleImpact, scaleFlight, impactLead, impactHold, flightRamp, flight, recover } = KILL_CAM;
  const slowFrom = length - impactLead;
  if (s < slowFrom) {
    const k = s / slowFrom;
    return scaleLead + (scaleImpact - scaleLead) * k * k;
  }
  const after = s - length;
  if (after < impactHold) return scaleImpact;
  if (after < flight) return scaleImpact + (scaleFlight - scaleImpact) * Math.min(1, (after - impactHold) / flightRamp);
  return scaleFlight + (1 - scaleFlight) * Math.min(1, (after - flight) / recover);
}

/**
 * Real seconds a kill cam takes from the cut until time runs at normal speed again, for a replay of `ticks` ticks.
 * Online, the host holds the match for this long while both players watch.
 */
export function killCamDuration(ticks: number): number {
  const length = ticks * TICK_DT;
  const end = length + KILL_CAM.flight + KILL_CAM.recover;
  const ds = TICK_DT / 8;
  let real = 0;
  for (let s = 0; s < end; s += ds) real += ds / timeScaleAt(s, length);
  return real;
}

export class KillCam {
  /** The state being replayed; identical to the live state once `replaying` turns false. */
  readonly state: MatchState;
  replaying = true;
  private index = 0;
  /** Sim seconds since the cut. */
  private simTime = 0;
  private readonly length: number;

  constructor(
    private readonly replay: Replay,
    readonly shot: KillShot,
  ) {
    this.state = structuredClone(replay.start);
    this.length = replay.inputs.length * TICK_DT;
  }

  /** How fast sim time runs right now: eases down into the blow, holds, then recovers. */
  timeScale(): number {
    return timeScaleAt(this.simTime, this.length);
  }

  /** True once time is back to normal speed. */
  get settled(): boolean {
    return this.simTime >= this.length + KILL_CAM.flight + KILL_CAM.recover;
  }

  /** Re-simulates one recorded tick. */
  stepReplay(): SimEvent[] {
    const events = step(this.state, this.replay.inputs[this.index++]!);
    this.simTime += TICK_DT;
    if (this.index >= this.replay.inputs.length) this.replaying = false;
    return events;
  }

  /** Runs the rest of the replay at once (skip). Returns the events of the last tick: the kill itself. */
  finish(): SimEvent[] {
    let last: SimEvent[] = [];
    while (this.replaying) last = this.stepReplay();
    return last;
  }

  /** Game time passed after the replay caught up (the aftermath: the body flying). */
  advance(seconds: number): void {
    this.simTime += seconds;
  }
}

/**
 * Builds the kill cam from a replay alone: runs it once to learn who dies and where the blow came from,
 * then frames the shot on that final moment. Returns null if nobody dies in it.
 */
export function planKillCam(replay: Replay): KillCam | null {
  if (replay.inputs.length < 2) return null;
  const end = structuredClone(replay.start);
  const lastHitBy = new Map<number, number>();
  const fell = new Set<number>();
  let victimId = -1;
  for (const inputs of replay.inputs) {
    for (const e of step(end, inputs)) {
      if (e.t === "damage" && e.targetKind === "champion") lastHitBy.set(e.target, e.source);
      if (e.t === "fall") {
        fell.add(e.unit);
        // Whoever shoved or dragged the victim in is the killer, even if the hit itself landed before the replay starts.
        if (e.by >= 0) lastHitBy.set(e.unit, e.by);
      }
      if (e.t === "death" && victimId < 0) victimId = e.unit;
    }
  }
  const victim = end.units.find((u) => u.id === victimId);
  if (!victim) return null;
  const killer = end.units.find((u) => u.id === lastHitBy.get(victimId));
  return new KillCam(replay, frameKill(end, victim, killer, fell.has(victimId)));
}
