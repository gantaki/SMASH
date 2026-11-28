// One running match on the client: fixed-tick sim loop, input, and the view. Used for duels vs a bot,
// the training range and the bot-vs-bot demo behind the menu.

import { getChampion, type AbilitySlot, type BotDifficulty, type ChampionId, type Tuning } from "@smash/content";
import {
  TICK_DT,
  championOfTeam,
  champions,
  createMatch,
  createTickClock,
  emptyInput,
  step,
  trainingCommand,
  type MatchState,
  type PlayerInput,
  type SimEvent,
  type TrainingCommand,
} from "@smash/sim";
import type { AudioEngine } from "../audio/AudioEngine.ts";
import type { P2PRoom } from "../net/p2p.ts";
import { GuestSession, HostSession, isKillCamPacket } from "../net/reconcile.ts";
import { ReplayRecorder, type Replay } from "../net/replay.ts";
import { Hud } from "./Hud.ts";
import { killCamDuration, planKillCam, type KillCam } from "./killcam.ts";
import { GameView } from "./render/GameView.ts";

/** "duel2": 2v2, the player with a bot ally against two bots. */
export type GameMode = "duel" | "duel2" | "training" | "demo" | "online";

export interface OnlineGameOptions {
  role: "host" | "guest";
  seed: number;
  hostChampion: ChampionId;
  guestChampion: ChampionId;
  room: P2PRoom;
  onOpponentLeft?: () => void;
}

export interface TrainingStats {
  /** Damage per second to the dummy over the last few seconds. */
  dps: number;
  lastHit: number;
  total: number;
  dummyMoves: boolean;
  suddenDeath: boolean;
}

export interface GameOptions {
  mode: GameMode;
  champion: string;
  opponent: string;
  /** 2v2 only: the bot on the player's side, and the second opponent. */
  ally?: string;
  opponent2?: string;
  difficulty: BotDifficulty;
  canvas: HTMLCanvasElement;
  overlay: HTMLElement;
  hud: HTMLElement;
  audio: AudioEngine;
  online?: OnlineGameOptions;
  onMatchEnd?: (won: boolean, score: [number, number]) => void;
  onPause?: (paused: boolean) => void;
  onTrainingStats?: (s: TrainingStats) => void;
}

const KEY_SLOTS: Record<string, AbilitySlot> = { Space: "mobility", KeyQ: "q", KeyE: "e", KeyR: "companion", KeyX: "ultimate" };
const MOVE_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
const TRAINING_KEYS: Record<string, TrainingCommand> = {
  Digit1: { t: "resetCooldowns" },
  Digit2: { t: "fillEnergy" },
  Digit3: { t: "toggleDummyMove" },
  Digit4: { t: "toggleSuddenDeath" },
  Digit5: { t: "resetArena" },
};
const DPS_WINDOW = 4;
/** Body class while the kill cam plays: hides the HUD and shows letterbox bars (styles.css). */
const KILLCAM_CLASS = "killcam";
/** Online: the host holds the match this much longer than the kill cam lasts, so the guest's replay is over too. */
const HOLD_MARGIN = 0.3;
/** Online guest: how long to wait for the kill cam replay before showing the round's end without it. */
const HELD_EVENTS_TIMEOUT = 0.6;

export class Game {
  state: MatchState;
  private readonly viewerTeam: 0 | 1;
  private readonly hostSession: HostSession | null = null;
  private readonly guestSession: GuestSession | null = null;
  private readonly view: GameView;
  private readonly hud: Hud | null;
  private readonly clock = createTickClock();
  private readonly keys = new Set<string>();
  private readonly presses: AbilitySlot[] = [];
  private readonly mouse = { x: innerWidth / 2, y: innerHeight / 2 };
  private aim = { x: 0, z: 0 };
  private holdPrimary = false;
  private cancelPressed = false;
  private paused = false;
  private menuOpen = false;
  private raf = 0;
  private last = performance.now();
  private time = 0;
  private disposed = false;
  private readonly hits: { t: number; amount: number }[] = [];
  private totalDamage = 0;
  private lastHit = 0;
  private statsTimer = 0;
  private readonly cleanup: (() => void)[] = [];
  /** Offline: the last moments of the round, for the kill cam replay. Online the host session records them. */
  private readonly recorder = new ReplayRecorder();
  private killcam: KillCam | null = null;
  private readonly killcamEnabled: boolean;
  /** Online host: real seconds left before the match held for the kill cam is released. */
  private hostHold = 0;
  /** Online guest: events of the tick that decided a round, kept back for the kill cam replay to show. */
  private held: { events: SimEvent[]; state: MatchState; age: number } | null = null;

  constructor(private readonly opts: GameOptions) {
    const { mode } = opts;
    this.viewerTeam = mode === "online" && opts.online?.role === "guest" ? 1 : 0;
    if (mode === "online" && opts.online) {
      if (opts.online.role === "host") {
        this.hostSession = new HostSession(opts.online);
        this.state = this.hostSession.state;
      } else {
        this.guestSession = new GuestSession(opts.online);
        this.state = this.guestSession.state;
      }
    } else {
      const bot = (champion: string) => ({ champion, controller: "bot" as const, difficulty: opts.difficulty });
      this.state = createMatch({
        seed: (Math.random() * 0xffffffff) >>> 0,
        mode: mode === "training" ? "training" : "duel",
        // Slots alternate teams: the player, an opponent, then (2v2) the player's ally and the second opponent.
        players: [
          { champion: opts.champion, controller: mode === "demo" ? "bot" : "human", difficulty: opts.difficulty },
          mode === "training" ? { champion: "dummy", controller: "dummy" } : bot(opts.opponent),
          ...(mode === "duel2" ? [bot(opts.ally ?? opts.champion), bot(opts.opponent2 ?? opts.opponent)] : []),
        ],
      });
    }
    this.killcamEnabled = (mode === "duel" || mode === "duel2" || mode === "online") && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    const me = championOfTeam(this.state, this.viewerTeam);
    const enemy = championOfTeam(this.state, this.viewerTeam === 0 ? 1 : 0);
    // 2v2: the scoreboard names both sides' champions.
    const names = (team: 0 | 1) =>
      champions(this.state)
        .filter((u) => u.team === team)
        .map((u) => getChampion(u.champion).nameRu)
        .join(" + ");
    const sides: [string, string] | undefined = mode === "duel2" ? [names(this.viewerTeam), names(this.viewerTeam === 0 ? 1 : 0)] : undefined;
    this.hud = mode === "demo" ? null : new Hud(opts.hud, me, enemy, mode === "training", mode === "online", sides);
    if (this.hud) this.hud.onEnergyFull = () => opts.audio.play("energy_full");
    this.view = new GameView(opts.canvas, opts.overlay, this.state, this.viewerTeam, mode === "demo" ? null : opts.audio, {
      message: (text, seconds, big) => this.hud?.message(text, seconds, big),
    });
    this.view.orbit = mode === "demo";
    this.aim = { x: me.x, z: me.z + (this.viewerTeam === 0 ? -6 : 6) };
    if (mode !== "demo") this.bindInput();
    if (mode === "online" && opts.online) this.bindOnline(opts.online);
    if (mode === "duel" || mode === "duel2" || mode === "online") this.hud?.message("Раунд 1", 1.1, true);
    if (mode === "training") this.hud?.message("Тренировка: 1–5 — команды полигона", 2.5);
    this.raf = requestAnimationFrame(this.frame);
  }

  private bindOnline(online: OnlineGameOptions): void {
    const { room, onOpponentLeft } = online;
    if (this.hostSession) {
      this.cleanup.push(room.onInput((inp) => this.hostSession!.pushGuestInput(inp)));
    } else if (this.guestSession) {
      this.cleanup.push(
        room.onSnap((snap) => {
          const res = this.guestSession!.applySnapshot(snap);
          if (!res) return;
          this.state = this.guestSession!.state;
          this.track(res.events);
          if (this.killcamEnabled && res.events.some((e) => e.t === "roundEnd")) {
            // The tick that decides a round is shown by the kill cam replay, which the host sends next.
            // (If the replay is already playing, it shows these events itself.)
            if (!this.killcam) this.held = { events: res.events, state: res.authState, age: 0 };
            return;
          }
          if (res.events.some((e) => e.t === "phase" && e.phase !== "roundEnd")) this.endKillcam();
          this.view.handle(res.events, res.authState);
        }),
        room.onKillCam((packet) => {
          if (!isKillCamPacket(packet)) return;
          // The host holds the match while both players watch: stop predicting until it moves again.
          this.guestSession!.freeze(packet.tick);
          this.state = this.guestSession!.state;
          const started = this.killcamEnabled && this.startKillcam(packet);
          if (!started) this.flushHeld();
          this.held = null;
        }),
      );
    }
    this.cleanup.push(
      room.onPeerLeave(() => onOpponentLeft?.()),
      room.onControl((msg) => {
        if (msg.t === "leave") onOpponentLeft?.();
      }),
    );
  }

  /** Guest: show the round's end right away (no kill cam is coming, or it is switched off). */
  private flushHeld(): void {
    const held = this.held;
    this.held = null;
    if (held) this.view.handle(held.events, held.state);
  }

  setPing(ms: number | null): void {
    this.hud?.setPing(ms);
  }

  private listen<K extends keyof WindowEventMap>(target: Window | HTMLElement, type: K, fn: (e: WindowEventMap[K]) => void): void {
    target.addEventListener(type, fn as EventListener);
    this.cleanup.push(() => target.removeEventListener(type, fn as EventListener));
  }

  private bindInput(): void {
    const { canvas } = this.opts;
    this.listen(window, "keydown", (e) => {
      const k = e.code;
      if (k === "Space" || k.startsWith("Arrow")) e.preventDefault();
      if (MOVE_KEYS.has(k) && !this.menuOpen) this.keys.add(k);
      if (e.repeat) return;
      if (k === "Escape" || k === "KeyP") return this.setPaused(!this.isPaused);
      if (k === "KeyM") return this.opts.audio.setMuted(!this.opts.audio.muted);
      if (this.menuOpen) return;
      if (k === "KeyC") this.cancelPressed = true;
      if (k === "Space" && this.killcam) return this.endKillcam(true);
      this.keys.add(k);
      const slot = KEY_SLOTS[k];
      if (slot) this.presses.push(slot);
      const cmd = TRAINING_KEYS[k];
      if (cmd) this.command(cmd);
    });
    this.listen(window, "keyup", (e) => this.keys.delete(e.code));
    this.listen(window, "pointermove", (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
    });
    this.listen(canvas, "pointerdown", (e) => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.opts.audio.unlock();
      if (this.menuOpen) return;
      if (e.button === 0) {
        this.holdPrimary = true;
        this.presses.push("primary");
      } else if (e.button === 2) this.presses.push("secondary");
      else if (e.button === 1) {
        e.preventDefault();
        this.presses.push("companion");
      }
    });
    this.listen(window, "pointerup", (e) => {
      if (e.button === 0) this.holdPrimary = false;
    });
    this.listen(window, "contextmenu", (e) => e.preventDefault());
    this.listen(window, "blur", () => {
      this.keys.clear();
      this.holdPrimary = false;
      if (this.opts.mode !== "online" && this.state.phase !== "matchEnd") this.setPaused(true);
    });
  }

  get isPaused(): boolean {
    return this.opts.mode === "online" ? this.menuOpen : this.paused;
  }

  setPaused(paused: boolean): void {
    if (this.opts.mode === "demo" || this.state.phase === "matchEnd") return;
    if (this.opts.mode === "online") {
      if (paused === this.menuOpen) return;
      this.menuOpen = paused;
      if (paused) {
        this.holdPrimary = false;
        this.keys.clear();
      }
      this.opts.onPause?.(paused);
      return;
    }
    if (paused === this.paused) return;
    this.paused = paused;
    this.holdPrimary = false;
    this.keys.clear();
    this.opts.onPause?.(paused);
  }

  /** Training range commands (cooldowns, energy, dummy, sudden death, tuning). */
  command(cmd: TrainingCommand): void {
    this.view.handle(trainingCommand(this.state, cmd), this.state);
    if (cmd.t === "resetArena") this.view.reset(this.state);
    this.pushStats();
  }

  setTuning(tuning: Partial<Tuning>): void {
    this.command({ t: "setTuning", tuning });
  }

  private input(): PlayerInput {
    if (this.menuOpen) {
      this.presses.length = 0;
      this.cancelPressed = false;
      return { move: { x: 0, z: 0 }, aim: { ...this.aim }, press: [], holdPrimary: false, cancel: false };
    }
    const k = this.keys;
    let x = 0;
    let z = 0;
    // The camera looks down -z, so "up" on screen is -z.
    if (k.has("KeyW") || k.has("ArrowUp")) z -= 1;
    if (k.has("KeyS") || k.has("ArrowDown")) z += 1;
    if (k.has("KeyA") || k.has("ArrowLeft")) x -= 1;
    if (k.has("KeyD") || k.has("ArrowRight")) x += 1;
    const l = Math.hypot(x, z);
    const cancel = this.cancelPressed;
    this.cancelPressed = false;
    return { move: l ? { x: x / l, z: z / l } : { x: 0, z: 0 }, aim: { ...this.aim }, press: this.presses.splice(0), holdPrimary: this.holdPrimary, cancel };
  }

  private track(events: SimEvent[]): void {
    const dummy = championOfTeam(this.state, 1);
    for (const e of events) {
      if (e.t === "matchEnd") this.opts.onMatchEnd?.(e.winner === this.viewerTeam, e.score);
      if (this.opts.mode === "training" && e.t === "damage" && e.target === dummy.id) {
        this.hits.push({ t: this.time, amount: e.amount + e.absorbed });
        this.totalDamage += e.amount + e.absorbed;
        this.lastHit = e.amount + e.absorbed;
      }
    }
  }

  private pushStats(): void {
    if (this.opts.mode !== "training") return;
    while (this.hits.length && this.hits[0]!.t < this.time - DPS_WINDOW) this.hits.shift();
    const sum = this.hits.reduce((s, h) => s + h.amount, 0);
    this.opts.onTrainingStats?.({
      dps: sum / DPS_WINDOW,
      lastHit: this.lastHit,
      total: this.totalDamage,
      dummyMoves: this.state.training.dummyMoves,
      suddenDeath: this.state.suddenDeath.active,
    });
  }

  // ---------- kill cam ----------

  /** The round was just decided: rewind and replay the final blow from the side, in slow motion. */
  private startKillcam(replay: Replay): boolean {
    const cam = planKillCam(replay);
    if (!cam) return false;
    this.killcam = cam;
    // The deciding tick's own events are not shown now: the replay produces them again at the dramatic moment.
    this.view.clearTransients();
    this.view.setKillShot(cam.shot);
    document.body.classList.add(KILLCAM_CLASS);
    return true;
  }

  /** Back to the gameplay camera. With `skip`, the rest of the replay is fast-forwarded first. */
  private endKillcam(skip = false): void {
    const cam = this.killcam;
    if (!cam) return;
    if (skip && cam.replaying) {
      this.view.clearTransients();
      this.view.setKillShot(null);
      this.view.handle(cam.finish(), this.state);
      this.view.snapshot(this.state);
    }
    this.killcam = null;
    this.view.setKillShot(null);
    document.body.classList.remove(KILLCAM_CLASS);
  }

  private frame = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    let dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (this.paused) dt = 0;
    this.time += dt;
    // Slow motion scales game time; the camera and the clock on the wall keep real time.
    const simDt = this.killcam ? dt * this.killcam.timeScale() : dt;

    const aim = this.view.aimAt(this.mouse.x, this.mouse.y);
    if (aim && this.opts.mode !== "demo" && !this.killcam) this.aim = aim;

    const ticks = this.clock.advance(simDt);
    // Key presses are edges: they go into the first tick of the frame only.
    const input = ticks > 0 && this.opts.mode !== "demo" ? this.input() : null;
    for (let i = 0; i < ticks; i++) {
      const cam = this.killcam;
      if (cam?.replaying) {
        this.view.snapshot(cam.state);
        this.view.handle(cam.stepReplay(), cam.state);
        if (!cam.replaying && import.meta.env.DEV && JSON.stringify(cam.state) !== JSON.stringify(this.state)) {
          console.warn("Kill cam replay diverged from the live state: the simulation is not deterministic.");
        }
        continue;
      }
      const tickInput = input && i > 0 ? { ...input, press: [], cancel: false } : input;
      if (this.hostSession) {
        this.view.snapshot(this.state);
        const { events, snapshot, replay } = this.hostSession.stepTick(tickInput ?? emptyInput());
        this.track(events);
        const room = this.opts.online!.room;
        if (snapshot) room.sendSnap(snapshot);
        if (replay) {
          // Round decided: the guest gets the replay, and the match waits until both have watched it.
          room.sendKillCam(replay);
          this.hostHold = killCamDuration(replay.inputs.length) + HOLD_MARGIN;
          if (this.killcamEnabled && this.startKillcam(replay)) break;
        }
        if (events.some((e) => e.t === "phase" && e.phase !== "roundEnd")) this.endKillcam();
        this.view.handle(events, this.state);
        continue;
      }
      if (this.guestSession) {
        if (this.state.phase === "matchEnd") continue;
        this.view.snapshot(this.state);
        const net = this.guestSession.stepLocal(tickInput ?? emptyInput());
        this.state = this.guestSession.state;
        if (net) this.opts.online!.room.sendInput(net);
        continue;
      }
      this.view.snapshot(this.state);
      if (this.killcamEnabled && this.state.phase === "fight") this.recorder.record(this.state, [tickInput, null]);
      const events = step(this.state, [tickInput, null]);
      this.track(events);
      if (cam) {
        cam.advance(TICK_DT);
        if (cam.settled) this.view.normalSoundRate();
        // The next round (or the end screen) takes the camera back.
        if (events.some((e) => e.t === "phase" && e.phase !== "roundEnd")) this.endKillcam();
      } else if (this.killcamEnabled && events.some((e) => e.t === "roundEnd")) {
        const replay = this.recorder.take();
        if (replay && this.startKillcam(replay)) break;
      }
      this.view.handle(events, this.state);
    }
    if (this.opts.mode === "online") {
      // The match is held during the kill cam, so its aftermath (the body flying) runs on the clock, not on ticks.
      const cam = this.killcam;
      if (cam && !cam.replaying) {
        cam.advance(simDt);
        if (cam.settled) this.view.normalSoundRate();
      }
      if (this.hostHold > 0) {
        this.hostHold -= dt;
        if (this.hostHold <= 0) this.hostSession?.release();
      }
      if (this.held && (this.held.age += dt) > HELD_EVENTS_TIMEOUT) this.flushHeld();
    }
    // The demo behind the menu loops forever.
    if (this.opts.mode === "demo" && this.state.phase === "matchEnd") {
      this.opts.onMatchEnd?.(false, [0, 0]);
      return;
    }
    const me = championOfTeam(this.state, this.viewerTeam);
    const shown = this.killcam?.replaying ? this.killcam.state : this.state;
    this.view.render(shown, this.paused ? 1 : this.clock.alpha, simDt, this.time, this.aim, dt);
    this.hud?.update(this.state, me, dt);
    this.statsTimer -= dt;
    if (this.statsTimer <= 0) {
      this.statsTimer = 0.25;
      this.pushStats();
    }
  };

  dispose(): void {
    this.disposed = true;
    document.body.classList.remove(KILLCAM_CLASS);
    cancelAnimationFrame(this.raf);
    for (const fn of this.cleanup) fn();
    this.hud?.dispose();
    this.view.dispose();
  }
}

