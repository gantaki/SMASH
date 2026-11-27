// One running match on the client: fixed-tick loop, input, and the view. Offline (duel vs a bot, training range,
// the bot-vs-bot demo behind the menu) the client owns the simulation; online it predicts on top of server snapshots.

import { rules, type AbilitySlot, type BotDifficulty, type Tuning } from "@smash/content";
import { withConfig } from "@smash/protocol";
import {
  TICK_DT,
  championOfTeam,
  createMatch,
  createTickClock,
  step,
  trainingCommand,
  type MatchState,
  type PlayerInput,
  type SimEvent,
  type Team,
  type TrainingCommand,
} from "@smash/sim";
import type { AudioEngine } from "../audio/AudioEngine.ts";
import type { MatchMessage, NetClient, StartMessage } from "../net/NetClient.ts";
import { Prediction } from "../net/Prediction.ts";
import { Hud } from "./Hud.ts";
import { KILL_CAM, planKillCam, type Frame, type KillCam } from "./killcam.ts";
import { GameView } from "./render/GameView.ts";

export type GameMode = "duel" | "training" | "demo" | "online";
export type EndReason = "finished" | "opponent_left";

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
  difficulty: BotDifficulty;
  canvas: HTMLCanvasElement;
  overlay: HTMLElement;
  hud: HTMLElement;
  audio: AudioEngine;
  /** Online: the connection and the server's start message. */
  online?: { net: NetClient; start: StartMessage };
  onMatchEnd?: (won: boolean, score: [number, number], reason: EndReason) => void;
  onPause?: (paused: boolean) => void;
  onTrainingStats?: (s: TrainingStats) => void;
}

const KEY_SLOTS: Record<string, AbilitySlot> = { Space: "mobility", KeyQ: "q", KeyE: "e", KeyR: "companion", KeyF: "ultimate" };
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
const HISTORY_TICKS = Math.round(KILL_CAM.rewind / TICK_DT);
/**
 * Online, the player's own actions are shown from the prediction at once; everything else (hits, damage, deaths)
 * waits for the server. These are the event kinds that count as "own actions".
 */
const PREDICTED_EVENTS = new Set<SimEvent["t"]>(["castStart", "castCancel", "abilityFire", "blink", "companionCommand"]);
/** A predicted event and the server's copy of it are the same thing if they arrive within this many seconds. */
const DEDUPE_WINDOW = 1.5;

export class Game {
  /** Offline: the match itself. Online this stays null and the prediction owns the state. */
  private readonly local: MatchState | null;
  private readonly pred: Prediction | null;
  private readonly net: NetClient | null;
  /** The local player's team (always 0 offline). */
  private readonly team: Team;
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
  private raf = 0;
  private last = performance.now();
  private time = 0;
  private disposed = false;
  private readonly hits: { t: number; amount: number }[] = [];
  private totalDamage = 0;
  private lastHit = 0;
  private statsTimer = 0;
  private readonly cleanup: (() => void)[] = [];
  /** Offline: recent ticks (state before the tick + inputs), for the kill cam replay. Online the server records them. */
  private history: Frame[] = [];
  private killcam: KillCam | null = null;
  private readonly killcamEnabled: boolean;
  /** Online: authoritative events waiting to be shown, and predicted ones already shown (key → times). */
  private serverEvents: SimEvent[] = [];
  private readonly shown = new Map<string, number[]>();
  /** Online: events of the deciding tick, held back because the kill cam replay will show them. */
  private held: SimEvent[] | null = null;

  constructor(private readonly opts: GameOptions) {
    const { mode, online } = opts;
    if (mode === "online" && online) {
      this.net = online.net;
      this.team = online.start.team;
      this.pred = new Prediction(online.start.config, online.start.team, online.start.state);
      this.local = null;
      online.net.onMatch = (msg) => this.onNet(msg);
    } else {
      this.net = null;
      this.pred = null;
      this.team = 0;
      this.local = createMatch({
        seed: (Math.random() * 0xffffffff) >>> 0,
        mode: mode === "training" ? "training" : "duel",
        players: [
          { champion: opts.champion, controller: mode === "demo" ? "bot" : "human", difficulty: opts.difficulty },
          mode === "training" ? { champion: "dummy", controller: "dummy" } : { champion: opts.opponent, controller: "bot", difficulty: opts.difficulty },
        ],
      });
    }
    this.killcamEnabled = (mode === "duel" || mode === "online") && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    const me = championOfTeam(this.state, this.team);
    const enemy = championOfTeam(this.state, this.team === 0 ? 1 : 0);
    this.hud = mode === "demo" ? null : new Hud(opts.hud, me, enemy, mode === "training");
    if (this.hud) this.hud.onEnergyFull = () => opts.audio.play("energy_full");
    this.view = new GameView(opts.canvas, opts.overlay, this.state, this.team, mode === "demo" ? null : opts.audio, {
      message: (text, seconds, big) => this.hud?.message(text, seconds, big),
    });
    this.view.orbit = mode === "demo";
    this.aim = { x: me.x, z: me.z - 6 * this.side };
    if (mode !== "demo") this.bindInput();
    if (mode === "duel" || mode === "online") this.hud?.message("Раунд 1", 1.1, true);
    if (mode === "training") this.hud?.message("Тренировка: 1–5 — команды полигона", 2.5);
    this.raf = requestAnimationFrame(this.frame);
  }

  /** The state to draw: the match itself offline, the predicted present online. */
  get state(): MatchState {
    return this.pred ? this.pred.state : this.local!;
  }

  /** Team 1 looks at the arena from the other end: screen directions are mirrored. */
  private get side(): 1 | -1 {
    return this.team === 1 ? -1 : 1;
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
      if (e.repeat) return;
      if (k === "Escape" || k === "KeyP") return this.setPaused(!this.paused);
      if (k === "KeyM") return this.opts.audio.setMuted(!this.opts.audio.muted);
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
      // An online match cannot be paused, so losing focus does not open the menu there.
      if (this.state.phase !== "matchEnd" && !this.pred) this.setPaused(true);
    });
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Offline this freezes the match. Online it only opens the menu: the match goes on. */
  setPaused(paused: boolean): void {
    if (this.opts.mode === "demo" || this.state.phase === "matchEnd" || paused === this.paused) return;
    this.paused = paused;
    this.holdPrimary = false;
    this.keys.clear();
    this.opts.onPause?.(paused);
  }

  /** Training range commands (cooldowns, energy, dummy, sudden death, tuning). */
  command(cmd: TrainingCommand): void {
    if (!this.local) return;
    this.view.handle(trainingCommand(this.local, cmd), this.local);
    if (cmd.t === "resetArena") this.view.reset(this.local);
    this.pushStats();
  }

  setTuning(tuning: Partial<Tuning>): void {
    this.command({ t: "setTuning", tuning });
  }

  private input(): PlayerInput {
    const k = this.keys;
    let x = 0;
    let z = 0;
    // The camera looks down -z (or +z for team 1), so "up" on screen is away from the camera.
    if (k.has("KeyW") || k.has("ArrowUp")) z -= 1;
    if (k.has("KeyS") || k.has("ArrowDown")) z += 1;
    if (k.has("KeyA") || k.has("ArrowLeft")) x -= 1;
    if (k.has("KeyD") || k.has("ArrowRight")) x += 1;
    const l = Math.hypot(x, z);
    const cancel = this.cancelPressed;
    this.cancelPressed = false;
    const s = this.side;
    return { move: l ? { x: (x / l) * s, z: (z / l) * s } : { x: 0, z: 0 }, aim: { ...this.aim }, press: this.presses.splice(0), holdPrimary: this.holdPrimary, cancel };
  }

  private track(events: readonly SimEvent[]): void {
    const dummy = championOfTeam(this.state, 1);
    for (const e of events) {
      // Online the server's `end` message closes the match instead.
      if (e.t === "matchEnd" && !this.pred) this.opts.onMatchEnd?.(e.winner === this.team, e.score, "finished");
      if (this.opts.mode === "training" && e.t === "damage" && e.target === dummy.id) {
        this.hits.push({ t: this.time, amount: e.amount + e.absorbed });
        this.totalDamage += e.amount + e.absorbed;
        this.lastHit = e.amount + e.absorbed;
      }
    }
  }

  private pushStats(): void {
    if (this.opts.mode !== "training" || !this.local) return;
    while (this.hits.length && this.hits[0]!.t < this.time - DPS_WINDOW) this.hits.shift();
    const sum = this.hits.reduce((s, h) => s + h.amount, 0);
    this.opts.onTrainingStats?.({
      dps: sum / DPS_WINDOW,
      lastHit: this.lastHit,
      total: this.totalDamage,
      dummyMoves: this.local.training.dummyMoves,
      suddenDeath: this.local.suddenDeath.active,
    });
  }

  // ---------- kill cam ----------

  /** The round was just decided: rewind and replay the final blow from the side, in slow motion. */
  private startKillcam(frames: readonly Frame[]): boolean {
    const cam = planKillCam(frames, this.side);
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

  /** One tick of the kill cam replay. */
  private replayTick(cam: KillCam): void {
    this.view.snapshot(cam.state);
    this.view.handle(cam.stepReplay(), cam.state);
    if (!cam.replaying && import.meta.env.DEV && JSON.stringify(cam.state) !== JSON.stringify(this.state)) {
      console.warn("Kill cam replay diverged from the live state: the simulation is not deterministic.");
    }
  }

  // ---------- offline ----------

  private localTick(input: PlayerInput | null): boolean {
    const state = this.local!;
    const cam = this.killcam;
    this.view.snapshot(state);
    if (this.killcamEnabled && state.phase === "fight") {
      this.history.push({ state: structuredClone(state), inputs: [input, null] });
      if (this.history.length > HISTORY_TICKS) this.history.shift();
    }
    const events = step(state, [input, null]);
    this.track(events);
    if (cam) {
      cam.advance(TICK_DT);
      if (cam.settled) this.view.normalSoundRate();
      // The next round (or the end screen) takes the camera back.
      if (events.some((e) => e.t === "phase" && e.phase !== "roundEnd")) this.endKillcam();
    } else if (this.killcamEnabled && events.some((e) => e.t === "roundEnd")) {
      const frames = this.history;
      this.history = [];
      if (this.startKillcam(frames)) return false;
    }
    this.view.handle(events, state);
    return true;
  }

  // ---------- online ----------

  private onNet(msg: MatchMessage): void {
    const pred = this.pred;
    if (!pred || this.disposed) return;
    if (msg.t === "snap") {
      pred.onSnapshot(msg.ack, msg.state);
      // The tick that decides a round is shown by the kill cam replay, which follows in the next message.
      if (this.killcamEnabled && msg.events.some((e) => e.t === "roundEnd")) this.held = msg.events;
      else this.serverEvents.push(...msg.events);
    } else if (msg.t === "killcam") {
      // The server holds the match while both players watch the replay.
      pred.freeze();
      const config = this.state.config;
      const started = this.killcamEnabled && this.startKillcam(msg.frames.map((f) => ({ state: withConfig(f.state, config), inputs: f.inputs })));
      if (!started && this.held) this.serverEvents.push(...this.held);
      this.held = null;
    } else {
      this.endKillcam();
      this.opts.onMatchEnd?.(msg.winner === this.team, msg.score, msg.reason);
    }
  }

  private eventKey(e: SimEvent): string | null {
    if (!PREDICTED_EVENTS.has(e.t) || !("unit" in e)) return null;
    if (e.t === "castCancel" && e.reason !== "cancelled") return null;
    const unit = this.state.units.find((u) => u.id === e.unit);
    if (!unit || unit.team !== this.team) return null;
    return `${e.t}:${e.unit}:${"abilityId" in e ? e.abilityId : ""}`;
  }

  /** Shows the player's own actions straight from the prediction and remembers them. */
  private presentPredicted(events: readonly SimEvent[]): void {
    const mine: SimEvent[] = [];
    for (const e of events) {
      const key = this.eventKey(e);
      if (!key) continue;
      mine.push(e);
      const times = this.shown.get(key) ?? [];
      times.push(this.time);
      this.shown.set(key, times);
    }
    if (mine.length) this.view.handle(mine, this.state);
  }

  /** Shows what the server reported, except the actions already shown from the prediction. */
  private presentServer(): void {
    if (!this.serverEvents.length) return;
    const events = this.serverEvents;
    this.serverEvents = [];
    const fresh = events.filter((e) => {
      const key = this.eventKey(e);
      const times = key ? this.shown.get(key) : undefined;
      if (!times) return true;
      while (times.length && times[0]! < this.time - DEDUPE_WINDOW) times.shift();
      return times.shift() === undefined;
    });
    if (fresh.some((e) => e.t === "phase" && e.phase !== "roundEnd")) this.endKillcam();
    this.view.handle(fresh, this.state);
  }

  private onlineTick(input: PlayerInput): void {
    const pred = this.pred!;
    for (const c of pred.rebase()) this.view.correct(c.id, c.dx, c.dz);
    this.view.snapshot(pred.state);
    const out = pred.advance(input);
    if (!out) return;
    this.net?.sendInput(out.seq, input);
    this.presentPredicted(out.events);
  }

  // ---------- frame ----------

  private frame = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    let dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    // An online match keeps running behind the menu.
    if (this.paused && !this.pred) dt = 0;
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
        this.replayTick(cam);
        continue;
      }
      const tickInput = input && i > 0 ? { ...input, press: [], cancel: false } : input;
      if (this.pred) this.onlineTick(tickInput!);
      else if (!this.localTick(tickInput)) break;
    }
    if (this.pred) {
      // Snapshots arrive between frames: apply the newest even if no tick ran, then show what the server reported.
      const cam = this.killcam;
      if (cam && !cam.replaying) {
        cam.advance(simDt);
        if (cam.settled) this.view.normalSoundRate();
        for (const c of this.pred.rebase()) this.view.correct(c.id, c.dx, c.dz);
      }
      this.presentServer();
      const ms = Math.round(Math.max(0, this.pred.lead - rules.net.snapshotEvery) * TICK_DT * 1000);
      this.hud?.setInfo(` · задержка ~${ms} мс`);
    }
    // The demo behind the menu loops forever.
    if (this.opts.mode === "demo" && this.state.phase === "matchEnd") {
      this.opts.onMatchEnd?.(false, [0, 0], "finished");
      return;
    }
    const state = this.state;
    const shown = this.killcam?.replaying ? this.killcam.state : state;
    this.view.render(shown, this.paused && !this.pred ? 1 : this.clock.alpha, simDt, this.time, this.aim, dt);
    this.hud?.update(state, championOfTeam(state, this.team), dt);
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
    if (this.net && this.net.onMatch) this.net.onMatch = null;
    for (const fn of this.cleanup) fn();
    this.hud?.dispose();
    this.view.dispose();
  }
}
