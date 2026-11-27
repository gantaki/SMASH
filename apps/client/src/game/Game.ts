// One running match on the client: fixed-tick sim loop, input, and the view. Used for duels vs a bot,
// the training range and the bot-vs-bot demo behind the menu.

import { type AbilitySlot, type BotDifficulty, type Tuning } from "@smash/content";
import {
  championOfTeam,
  createMatch,
  createTickClock,
  step,
  trainingCommand,
  type MatchState,
  type PlayerInput,
  type SimEvent,
  type TrainingCommand,
} from "@smash/sim";
import type { AudioEngine } from "../audio/AudioEngine.ts";
import { Hud } from "./Hud.ts";
import { GameView } from "./render/GameView.ts";

export type GameMode = "duel" | "training" | "demo";

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
  onMatchEnd?: (won: boolean, score: [number, number]) => void;
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

export class Game {
  readonly state: MatchState;
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

  constructor(private readonly opts: GameOptions) {
    const { mode } = opts;
    this.state = createMatch({
      seed: (Math.random() * 0xffffffff) >>> 0,
      mode: mode === "training" ? "training" : "duel",
      players: [
        { champion: opts.champion, controller: mode === "demo" ? "bot" : "human", difficulty: opts.difficulty },
        mode === "training" ? { champion: "dummy", controller: "dummy" } : { champion: opts.opponent, controller: "bot", difficulty: opts.difficulty },
      ],
    });
    const me = championOfTeam(this.state, 0);
    const enemy = championOfTeam(this.state, 1);
    this.hud = mode === "demo" ? null : new Hud(opts.hud, me, enemy, mode === "training");
    if (this.hud) this.hud.onEnergyFull = () => opts.audio.play("energy_full");
    this.view = new GameView(opts.canvas, opts.overlay, this.state, 0, mode === "demo" ? null : opts.audio, {
      message: (text, seconds, big) => this.hud?.message(text, seconds, big),
    });
    this.view.orbit = mode === "demo";
    this.aim = { x: me.x, z: me.z - 6 };
    if (mode !== "demo") this.bindInput();
    if (mode === "duel") this.hud?.message("Раунд 1", 1.1, true);
    if (mode === "training") this.hud?.message("Тренировка: 1–5 — команды полигона", 2.5);
    this.raf = requestAnimationFrame(this.frame);
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
      if (this.state.phase !== "matchEnd") this.setPaused(true);
    });
  }

  get isPaused(): boolean {
    return this.paused;
  }

  setPaused(paused: boolean): void {
    if (this.opts.mode === "demo" || this.state.phase === "matchEnd" || paused === this.paused) return;
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
      if (e.t === "matchEnd") this.opts.onMatchEnd?.(e.winner === 0, e.score);
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

  private frame = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    let dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (this.paused) dt = 0;
    this.time += dt;

    const aim = this.view.aimAt(this.mouse.x, this.mouse.y);
    if (aim && this.opts.mode !== "demo") this.aim = aim;

    const ticks = this.clock.advance(dt);
    // Key presses are edges: they go into the first tick of the frame only.
    const input = ticks > 0 && this.opts.mode !== "demo" ? this.input() : null;
    for (let i = 0; i < ticks; i++) {
      this.view.snapshot(this.state);
      const events = step(this.state, [input && i > 0 ? { ...input, press: [], cancel: false } : input, null]);
      this.view.handle(events, this.state);
      this.track(events);
    }
    // The demo behind the menu loops forever.
    if (this.opts.mode === "demo" && this.state.phase === "matchEnd") {
      this.opts.onMatchEnd?.(false, [0, 0]);
      return;
    }
    const me = championOfTeam(this.state, 0);
    this.view.render(this.state, this.paused ? 1 : this.clock.alpha, dt, this.time, this.aim);
    this.hud?.update(this.state, me, dt);
    this.statsTimer -= dt;
    if (this.statsTimer <= 0) {
      this.statsTimer = 0.25;
      this.pushStats();
    }
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const fn of this.cleanup) fn();
    this.hud?.dispose();
    this.view.dispose();
  }
}

