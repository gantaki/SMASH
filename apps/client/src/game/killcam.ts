// Kill cam: when a round is decided, rewind a moment and replay the final blow in slow motion from a low side camera.
// It is a real replay, not a recording: the sim is deterministic and its state is plain data, so we keep a short
// history of (state before the tick, input) and re-simulate it. Presentation only: nothing here feeds back into the match.

import { arena } from "@smash/content";
import { TICK_DT, blocker, step, type MatchState, type PlayerInput, type SimEvent, type Unit } from "@smash/sim";

/** Presentation tuning. Times marked "sim" are simulated seconds; the rest is real time. */
export const KILL_CAM = {
  /** Sim seconds replayed before the kill. */
  rewind: 0.6,
  /** Time scale when the replay starts, and around the blow. */
  scaleLead: 0.5,
  scaleImpact: 0.1,
  /** Sim seconds before the kill at which the slowest speed is reached, and after it for which it is held. */
  impactLead: 0.12,
  impactHold: 0.1,
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
  /** Killer and victim are framed together when this close; otherwise the camera stays on the victim. */
  pairRange: 9,
  /** Slow push-in and drift around the scene while it plays. */
  dolly: 0.12,
  orbitDeg: 12,
  /** Playback rate of sounds during slow motion. */
  soundRate: 0.6,
} as const;

export interface Frame {
  /** State before the tick. */
  state: MatchState;
  input: PlayerInput | null;
}

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
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Picks a side-on camera position with a clear view of the victim. */
export function frameKill(state: MatchState, victim: Unit, killer: Unit | undefined): KillShot {
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
    return { victim: victim.id, killer: paired && killer ? killer.id : -1, focus, side: { x: (cx - focus.x) / d, z: (cz - focus.z) / d }, distance: d, height: KILL_CAM.height };
  }
  // Every low angle is blocked or cramped: look down over the obstacles instead.
  const side = sides[0]!;
  return { victim: victim.id, killer: paired && killer ? killer.id : -1, focus, side, distance: KILL_CAM.distance.min, height: KILL_CAM.blockedHeight };
}

export class KillCam {
  /** The state being replayed; identical to the live state once `replaying` turns false. */
  readonly state: MatchState;
  replaying = true;
  /** Real seconds since the cut, for camera motion. */
  realTime = 0;
  private index = 0;
  /** Sim seconds since the cut. */
  private simTime = 0;
  private readonly length: number;

  constructor(
    private readonly frames: readonly Frame[],
    readonly shot: KillShot,
  ) {
    this.state = structuredClone(frames[0]!.state);
    this.length = frames.length * TICK_DT;
  }

  /** How fast sim time runs right now: eases down into the blow, holds, then recovers. */
  timeScale(): number {
    const { scaleLead, scaleImpact, impactLead, impactHold, recover } = KILL_CAM;
    const slowFrom = this.length - impactLead;
    const s = this.simTime;
    if (s < slowFrom) {
      const k = s / slowFrom;
      return scaleLead + (scaleImpact - scaleLead) * k * k;
    }
    if (s < this.length + impactHold) return scaleImpact;
    const k = Math.min(1, (s - this.length - impactHold) / recover);
    return scaleImpact + (1 - scaleImpact) * k;
  }

  /** True once time is back to normal speed. */
  get settled(): boolean {
    return this.simTime >= this.length + KILL_CAM.impactHold + KILL_CAM.recover;
  }

  /** Re-simulates one recorded tick. */
  stepReplay(): SimEvent[] {
    const frame = this.frames[this.index++]!;
    const events = step(this.state, [frame.input, null]);
    this.simTime += TICK_DT;
    if (this.index >= this.frames.length) this.replaying = false;
    return events;
  }

  /** Runs the rest of the replay at once (skip). Returns the events of the last tick: the kill itself. */
  finish(): SimEvent[] {
    let last: SimEvent[] = [];
    while (this.replaying) last = this.stepReplay();
    return last;
  }

  /** A live tick passed after the replay caught up. */
  liveTick(): void {
    this.simTime += TICK_DT;
  }
}
