// Small Web Audio sample player. Presentation only: the game loop calls play() and never waits on it.
// Routing: source → per-play gain (→ optional stereo panner) → master gain → compressor (gentle limiter) → destination.

import { SOUNDS, SOUND_IDS } from "./manifest.ts";

export interface PlayOptions {
  /** Multiplies the manifest volume. */
  volume?: number;
  /** Playback rate multiplier (before the manifest's random variance). */
  rate?: number;
  /** Stereo position, -1 (left) .. 1 (right). */
  pan?: number;
}

const STORAGE_KEY = "smash.audio";
const MAX_VOICES = 24;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Time constant of the fade when a sound is stopped early, seconds. */
const STOP_FADE = 0.012;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly lastPlayed = new Map<string, number>();
  private loading = false;
  private voices = 0;
  private volume = 0.8;
  private mute = false;
  private disposed = false;

  constructor() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { volume?: unknown; muted?: unknown };
        if (typeof saved.volume === "number" && Number.isFinite(saved.volume)) this.volume = clamp(saved.volume, 0, 1);
        if (typeof saved.muted === "boolean") this.mute = saved.muted;
      }
    } catch {
      // Storage unavailable or corrupt: keep defaults.
    }
  }

  get muted(): boolean {
    return this.mute;
  }

  get masterVolume(): number {
    return this.volume;
  }

  /** Call from a user gesture (click / key press). Safe to call repeatedly. */
  unlock(): void {
    if (this.disposed) return;
    try {
      if (!this.ctx) {
        const Ctor =
          window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        const ctx = new Ctor();
        const master = ctx.createGain();
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -10;
        limiter.knee.value = 8;
        limiter.ratio.value = 6;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.12;
        master.connect(limiter);
        limiter.connect(ctx.destination);
        this.ctx = ctx;
        this.master = master;
        this.limiter = limiter;
        this.applyMaster();
      }
      if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => undefined);
      if (!this.loading) {
        this.loading = true;
        void this.loadAll(this.ctx);
      }
    } catch {
      // No audio on this device: stay silent.
    }
  }

  /** Plays a sound now. Returns a function that fades it out early (for wind-up cues that get cancelled), or null. */
  play(id: string, opts: PlayOptions = {}): (() => void) | null {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || this.mute || this.disposed || ctx.state !== "running") return null;
    const def = SOUNDS[id];
    const buffer = this.buffers.get(id);
    if (!def || !buffer) return null;
    if (this.voices >= MAX_VOICES) return null;
    const now = ctx.currentTime * 1000;
    if (def.throttleMs !== undefined) {
      const last = this.lastPlayed.get(id);
      if (last !== undefined && now - last < def.throttleMs) return null;
    }
    this.lastPlayed.set(id, now);
    try {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const spread = def.variance ?? 0;
      // Presentation-only randomness; the simulation never sees it.
      source.playbackRate.value = clamp((opts.rate ?? 1) * (1 + (Math.random() * 2 - 1) * spread), 0.25, 4);
      const gain = ctx.createGain();
      gain.gain.value = clamp(def.volume * (opts.volume ?? 1), 0, 2);
      source.connect(gain);
      let tail: AudioNode = gain;
      if (opts.pan !== undefined && typeof ctx.createStereoPanner === "function") {
        const panner = ctx.createStereoPanner();
        panner.pan.value = clamp(opts.pan, -1, 1);
        gain.connect(panner);
        tail = panner;
      }
      tail.connect(master);
      this.voices++;
      source.onended = () => {
        this.voices = Math.max(0, this.voices - 1);
        source.disconnect();
        gain.disconnect();
        if (tail !== gain) tail.disconnect();
      };
      source.start();
      return () => {
        try {
          gain.gain.setTargetAtTime(0, ctx.currentTime, STOP_FADE);
          source.stop(ctx.currentTime + STOP_FADE * 5);
        } catch {
          // Already stopped.
        }
      };
    } catch {
      // Never let audio break the frame.
      return null;
    }
  }

  setMasterVolume(v: number): void {
    this.volume = clamp(Number.isFinite(v) ? v : 0, 0, 1);
    this.applyMaster();
    this.persist();
  }

  setMuted(m: boolean): void {
    this.mute = m;
    this.applyMaster();
    this.persist();
  }

  dispose(): void {
    this.disposed = true;
    this.buffers.clear();
    this.lastPlayed.clear();
    const ctx = this.ctx;
    this.ctx = null;
    this.master = null;
    this.limiter = null;
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => undefined);
  }

  private applyMaster(): void {
    if (this.master) this.master.gain.value = this.mute ? 0 : this.volume;
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ volume: this.volume, muted: this.mute }));
    } catch {
      // Ignore: settings just will not survive a reload.
    }
  }

  private async loadAll(ctx: AudioContext): Promise<void> {
    await Promise.all(
      SOUND_IDS.map(async (id) => {
        const def = SOUNDS[id];
        if (!def) return;
        try {
          const res = await fetch(def.file);
          if (!res.ok) return;
          const data = await res.arrayBuffer();
          const buffer = await ctx.decodeAudioData(data);
          if (!this.disposed) this.buffers.set(id, buffer);
        } catch {
          // Missing or undecodable file: this id stays silent.
        }
      }),
    );
  }
}
