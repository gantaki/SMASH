// Presentation of one match: owns the Three.js scene and turns sim state + events into pictures and sound.
// It never mutates sim state (architecture rule 4).

import * as THREE from "three";
import { abilityById, arena, getChampion, rules } from "@smash/content";
import { championOfTeam, obstaclePenetration, type ChampionUnit, type MatchState, type SimEvent, type Unit } from "@smash/sim";
import type { AudioEngine } from "../../audio/AudioEngine.ts";
import { Fx } from "./Fx.ts";
import { KILL_CAM, type KillShot } from "../killcam.ts";
import { GOLD, ALLY, FOE, G, basic, clamp, rand, rgb, type RGB } from "./gfx.ts";
import { Hazards } from "./Hazards.ts";
import { Overlay } from "./Overlay.ts";
import { Particles } from "./Particles.ts";
import { RAGDOLL, blowOf, impulseFor, type Blow, type RagdollWorld } from "./Ragdoll.ts";
import { SpineBillboard } from "./SpineBillboard.ts";
import { ChampionView, CompanionView, type Pose } from "./Units.ts";
import { World } from "./World.ts";

const DEG = Math.PI / 180;
const CAMERA = { fov: 45, height: 26, back: 12.5, lookAhead: 0.28, lookAheadMax: 6, follow: 5 };
/** Spine pixels per meter for BoneGyre hit effects (GAME_DESIGN §6). */
const SPINE_PX_PER_M = 175;
const TELEPORT_DISTANCE = 3;
/** How tall obstacles are, for ragdolls flying over or into them (matches the meshes in World.ts). */
const OBSTACLE_HEIGHT = { stone: 3.3, wood: 1.4, crate: 1.1 } as const;
const RIM = { height: 1.2, thickness: 1, standsGap: 7.2 } as const;

const DUST: [RGB, RGB] = [rgb("#f2d18c"), rgb("#66482a")];
const WOOD: [RGB, RGB] = [rgb("#c0803f"), rgb("#593314")];
const SPARK: [RGB, RGB] = [rgb("#fff2d9"), rgb("#b33319")];
const GOLDEN: [RGB, RGB] = [rgb("#fff299"), rgb("#e6800d")];

export interface ViewCallbacks {
  message(text: string, seconds: number, big?: boolean): void;
}

export class GameView {
  readonly camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 0.1, 220);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly particles = new Particles();
  private readonly world: World;
  private readonly fx: Fx;
  private readonly hazards: Hazards;
  private readonly overlay: Overlay;
  private readonly ink: SpineBillboard;
  private readonly champs = new Map<number, ChampionView>();
  private readonly pets = new Map<number, CompanionView>();
  private readonly prev = new Map<number, Pose>();
  private readonly reticle = new THREE.Group();
  private readonly camTarget = { x: 0, z: 7 };
  private readonly raycaster = new THREE.Raycaster();
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly hitPoint = new THREE.Vector3();
  private readonly resizeObserver: ResizeObserver;
  private readonly reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  private shake = 0;
  private alpha = 1;
  /** Wind-up cues still playing, by unit id: cut short if the cast is cancelled or interrupted. */
  private readonly castSounds = new Map<number, () => void>();
  /** The last direct hit each champion took: where it came from and how hard. Launches the ragdoll on death. */
  private readonly lastHit = new Map<number, Blow>();
  /** Latest state seen, for ragdoll collisions against obstacles. */
  private latest: MatchState;
  /** Orbiting camera with no HUD: used behind the menu. */
  orbit = false;
  private shot: KillShot | null = null;
  private shotTime = 0;
  /** Playback rate for positional sounds (lowered during the kill cam's slow motion). */
  private soundRate = 1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    overlayRoot: HTMLElement,
    state: MatchState,
    private readonly viewerTeam: 0 | 1,
    private readonly audio: AudioEngine | null,
    private readonly cb: ViewCallbacks,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;

    const scene = this.scene;
    scene.background = new THREE.Color(0x160e0a);
    scene.fog = new THREE.Fog(0x160e0a, 40, 78);
    scene.add(new THREE.HemisphereLight(0xfff0dc, 0x3a2416, 1.25));
    const sun = new THREE.DirectionalLight(0xffdcb0, 2.5);
    sun.position.set(-14, 30, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -27, right: 27, top: 27, bottom: -27, near: 1, far: 80 });
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.02;
    scene.add(sun);

    this.latest = state;
    this.world = new World(state, this.particles);
    this.fx = new Fx(this.particles, viewerTeam);
    this.hazards = new Hazards(this.particles);
    scene.add(this.world.group, this.hazards.group, this.fx.group, this.particles.points);
    this.overlay = new Overlay(overlayRoot, canvas, this.camera);

    for (const u of state.units) {
      const ally = u.team === viewerTeam;
      if (u.kind === "champion") {
        const view = new ChampionView(u, ally, this.particles);
        this.champs.set(u.id, view);
        scene.add(view.root);
        const bot = u.controller === "bot" ? " · бот" : "";
        this.overlay.addChampion(u, view.champion.nameRu + bot, ally);
      } else {
        const owner = state.units.find((o) => o.id === u.owner) as ChampionUnit;
        const def = getChampion(owner.champion).companion!;
        const view = new CompanionView(u, ally, def.flying, this.particles);
        this.pets.set(u.id, view);
        scene.add(view.root);
        this.overlay.addCompanion(u, ally);
      }
    }

    const rr = new THREE.Mesh(G.ring, basic(ALLY, 0.85));
    rr.scale.setScalar(0.45);
    const rd = new THREE.Mesh(G.circle, basic(ALLY, 0.9));
    rd.scale.setScalar(0.07);
    this.reticle.add(rr, rd);
    scene.add(this.reticle);

    this.ink = new SpineBillboard(scene, "/vfx/ink_blade_hit", "ink_blade_hit", SPINE_PX_PER_M, 0.05);
    this.ink.load().catch((err) => console.warn("Ink Blade Hit failed to load; falling back to sparks", err));

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
    this.snapshot(state);
    const me = championOfTeam(state, viewerTeam);
    this.camTarget.x = me.x;
    this.camTarget.z = me.z + (viewerTeam === 0 ? -3 : 3);
  }

  dispose(): void {
    this.resizeObserver.disconnect();
    this.overlay.dispose();
    this.particles.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      for (const one of mat ? (Array.isArray(mat) ? mat : [mat]) : []) one.dispose();
    });
    this.renderer.dispose();
    // Each match gets its own canvas; release the GPU context so they do not pile up.
    this.renderer.forceContextLoss();
  }

  private resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.particles.setViewport(h * this.renderer.getPixelRatio(), this.camera.fov);
  }

  /** Remembers where everything is before a tick, for render interpolation. */
  snapshot(state: MatchState): void {
    this.prev.clear();
    for (const u of state.units) this.prev.set(u.id, { x: u.x, z: u.z, face: u.face });
    for (const p of state.projectiles) this.prev.set(p.id, { x: p.x, z: p.z, face: 0 });
    for (const o of state.obstacles) if (o.kind === "crate") this.prev.set(o.id, { x: o.x, z: o.z, face: 0 });
  }

  private pose = (e: { id: number; x: number; z: number; face?: number }): Pose => {
    const p = this.prev.get(e.id);
    const face = e.face ?? 0;
    if (!p || Math.hypot(e.x - p.x, e.z - p.z) > TELEPORT_DISTANCE) return { x: e.x, z: e.z, face };
    const a = this.alpha;
    let d = (face - p.face) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return { x: p.x + (e.x - p.x) * a, z: p.z + (e.z - p.z) * a, face: p.face + d * a };
  };

  private setFov(fov: number): void {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    this.particles.setViewport((this.canvas.clientHeight || window.innerHeight) * this.renderer.getPixelRatio(), fov);
  }

  /** Cuts to the kill cam (or back to the gameplay camera with null). `realTime` drives the camera's slow drift. */
  setKillShot(shot: KillShot | null, realTime = 0): void {
    if (!!shot !== !!this.shot) this.setFov(shot ? KILL_CAM.fov : CAMERA.fov);
    this.shot = shot;
    this.shotTime = realTime;
    this.soundRate = shot ? KILL_CAM.soundRate : 1;
  }

  /** Slow motion ended: sounds play at normal pitch again, the camera stays where it is. */
  normalSoundRate(): void {
    this.soundRate = 1;
  }

  /** Drops short-lived effects, e.g. before rewinding for the kill cam. */
  clearTransients(): void {
    this.fx.clear();
    this.particles.clear();
    this.overlay.clearFloats();
    this.ink.clear();
    for (const stop of this.castSounds.values()) stop();
    this.castSounds.clear();
    // Time may be about to rewind (kill cam): hits remembered from the future would be wrong.
    this.lastHit.clear();
  }

  /** What a ragdoll can bump into: obstacles (up to their height), the arena rim, the stands. */
  private readonly ragdollWorld: RagdollWorld = {
    collide: (x, y, z, radius) => {
      for (const o of this.latest.obstacles) {
        if (y > OBSTACLE_HEIGHT[o.kind]) continue;
        const pen = obstaclePenetration(o, x, z, radius);
        if (pen) return pen;
      }
      // A body thrown high enough clears the low rim and lands between the arena and the stands.
      const d = Math.hypot(x, z);
      const inside = d < arena.radius + RIM.thickness / 2;
      const limit = inside && y < RIM.height ? arena.radius - radius : arena.radius + RIM.standsGap - radius;
      return d > limit && (inside || d > arena.radius + RIM.standsGap - radius) ? { nx: -x / d, nz: -z / d, depth: d - limit } : null;
    },
    impact: (x, y, z, speed, kind) => {
      const k = Math.min(1, speed / (RAGDOLL.slamSpeed * 3));
      this.particles.emit(x, Math.max(0.2, y), z, { n: Math.round(8 + 18 * k), spd: 2 + 3 * k, up: 0.8, col: DUST[0], col2: DUST[1], life: 0.5, size: 0.45, drag: 3, grav: 4, jit: 0.4 });
      if (kind === "wall") {
        this.fx.wave(x, z, 1.2, 0xffd28a, 0.25);
        this.sound("slam", x, z, 0.45 + 0.4 * k);
        this.shakeAt(x, z, 0.25 * k);
      } else this.sound("heavy_hit", x, z, 0.3 + 0.4 * k);
    },
  };

  /** Ground point under a screen position, for aiming. */
  aimAt(clientX: number, clientY: number): { x: number; z: number } | null {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.ray.intersectPlane(this.ground, this.hitPoint) ? { x: this.hitPoint.x, z: this.hitPoint.z } : null;
  }

  // ---------- frame ----------

  /** `dt` is scaled game time (slow motion slows effects too); `realDt` is wall-clock time for the kill cam's drift. */
  render(state: MatchState, alpha: number, dt: number, time: number, aim: { x: number; z: number }, realDt = dt): void {
    this.alpha = alpha;
    this.latest = state;
    if (this.shot) this.shotTime += realDt;
    const me = championOfTeam(state, this.viewerTeam);
    const mePose = this.pose(me);

    for (const u of state.units) {
      if (u.kind === "champion") this.champs.get(u.id)?.update(u, this.pose(u), time, dt);
      else this.pets.get(u.id)?.update(u, this.pose(u), time, dt);
    }
    this.world.update(state, time, dt, this.pose);
    this.hazards.update(state, time, dt);
    this.fx.sync(state, time, dt, this.pose);
    this.particles.update(dt);

    // Camera.
    if (this.shot) {
      // Kill cam: low, side-on, slowly pushing in and drifting around the final blow.
      const shot = this.shot;
      const ease = 1 - Math.exp(-this.shotTime * 0.9);
      const ang = KILL_CAM.orbitDeg * DEG * (ease - 0.35);
      const co = Math.cos(ang);
      const si = Math.sin(ang);
      const dist = shot.distance * (1 - KILL_CAM.dolly * ease);
      const sx = shot.side.x * co - shot.side.z * si;
      const sz = shot.side.x * si + shot.side.z * co;
      // Follow the fighters with the look target (interpolated, so it stays smooth at 0.1× speed).
      const v = state.units.find((u) => u.id === shot.victim);
      const k = state.units.find((u) => u.id === shot.killer);
      let fx = shot.focus.x;
      let fz = shot.focus.z;
      if (v) {
        // Once the victim is a ragdoll, follow the body, not the spot where it died.
        const vp = this.champs.get(v.id)?.ragdollCenter ?? this.pose(v);
        const kp = k ? this.pose(k) : null;
        fx = kp ? vp.x * 0.6 + kp.x * 0.4 : (vp.x + shot.focus.x) / 2;
        fz = kp ? vp.z * 0.6 + kp.z * 0.4 : (vp.z + shot.focus.z) / 2;
      }
      this.shake = Math.max(0, this.shake - dt * 2.2);
      const sh = this.reducedMotion ? 0 : this.shake * 0.35;
      this.camera.position.set(shot.focus.x + sx * dist, shot.height + (Math.random() - 0.5) * sh, shot.focus.z + sz * dist);
      this.camera.lookAt(fx, KILL_CAM.lookHeight, fz);
    } else if (this.orbit) {
      const a = time * 0.1;
      this.camera.position.set(Math.sin(a) * 24, 13, Math.cos(a) * 24);
      this.camera.lookAt(0, 1, 0);
    } else {
      const k = Math.min(1, dt * CAMERA.follow);
      const ax = clamp((aim.x - mePose.x) * CAMERA.lookAhead, -CAMERA.lookAheadMax, CAMERA.lookAheadMax);
      const az = clamp((aim.z - mePose.z) * CAMERA.lookAhead, -CAMERA.lookAheadMax, CAMERA.lookAheadMax);
      this.camTarget.x += (mePose.x + ax - this.camTarget.x) * k;
      this.camTarget.z += (mePose.z + az - this.camTarget.z) * k;
      // Narrow windows: pull back so the same width of arena stays visible.
      const asp = this.camera.aspect;
      const s = asp < 1.3 ? Math.pow(1.3 / asp, 0.8) : 1;
      this.shake = Math.max(0, this.shake - dt * 2.2);
      const sh = this.reducedMotion ? 0 : this.shake;
      const sx = (Math.random() - 0.5) * sh;
      const sz = (Math.random() - 0.5) * sh;
      this.camera.position.set(this.camTarget.x + sx, CAMERA.height * s, this.camTarget.z + CAMERA.back * s + sz);
      this.camera.lookAt(this.camTarget.x + sx * 0.5, 0, this.camTarget.z + sz * 0.5);
    }
    this.reticle.visible = !this.orbit && !this.shot && (state.phase === "fight" || state.phase === "countdown");
    this.reticle.position.set(aim.x, 0.05, aim.z);

    this.ink.update(this.camera, dt);
    const enemy = championOfTeam(state, this.viewerTeam === 0 ? 1 : 0);
    this.overlay.update(
      state,
      dt,
      !this.orbit && !this.shot && state.phase !== "matchEnd",
      this.pose,
      (id) => {
        const c = this.champs.get(id);
        return c ? 3.1 + c.height : (this.pets.get(id)?.barHeight ?? 2);
      },
      enemy,
    );
    this.renderer.render(this.scene, this.camera);
  }

  /** Called when a new round starts: drop everything left over from the previous one. */
  reset(state: MatchState): void {
    this.fx.clear();
    this.particles.clear();
    this.overlay.clearFloats();
    this.ink.clear();
    this.prev.clear();
    this.snapshot(state);
    const me = championOfTeam(state, this.viewerTeam);
    this.camTarget.x = me.x;
    this.camTarget.z = me.z + (this.viewerTeam === 0 ? -3 : 3);
    this.shake = 0;
  }

  // ---------- events ----------

  private sound(id: string | undefined, x?: number, z?: number, volume = 1): (() => void) | null {
    if (!id || !this.audio) return null;
    if (x === undefined || z === undefined) return this.audio.play(id, { volume });
    const d = Math.hypot(x - this.camTarget.x, z - this.camTarget.z);
    return this.audio.play(id, { volume: volume * clamp(1.1 - d / 34, 0.35, 1), pan: clamp((x - this.camTarget.x) / 16, -0.8, 0.8), rate: this.soundRate });
  }

  private shakeAt(x: number, z: number, amount: number): void {
    const d = Math.hypot(x - this.camTarget.x, z - this.camTarget.z);
    this.shake = Math.max(this.shake, amount * clamp(1 - d / 20, 0, 1));
  }

  private palette(unit: Unit | undefined, state: MatchState): [RGB, RGB] {
    const owner = unit?.kind === "companion" ? state.units.find((u) => u.id === unit.owner) : unit;
    if (owner?.kind !== "champion") return SPARK;
    const c = this.champs.get(owner.id)?.champion;
    return c ? [rgb(c.particles[0]), rgb(c.particles[1])] : SPARK;
  }

  handle(events: readonly SimEvent[], state: MatchState): void {
    const { fx, particles: p, overlay } = this;
    const me = championOfTeam(state, this.viewerTeam);
    const unit = (id: number) => state.units.find((u) => u.id === id);
    const teamHex = (team: 0 | 1) => (team === this.viewerTeam ? ALLY : FOE);

    for (const e of events) {
      switch (e.t) {
        case "countdown":
          this.cb.message(String(e.n), 0.7, true);
          this.sound("countdown_tick");
          break;
        case "phase":
          if (e.phase === "fight") {
            this.cb.message("В бой!", 0.8, true);
            this.sound("round_start");
          } else if (e.phase === "countdown") {
            this.reset(state);
            this.cb.message(`Раунд ${e.round}`, 1.1, true);
          }
          break;
        case "roundEnd": {
          const won = e.winner === this.viewerTeam;
          this.cb.message(e.winner === -1 ? "Ничья: раунд переигрывается" : won ? "Раунд твой" : "Раунд за соперником", 2.2, true);
          this.sound(won ? "round_win" : "round_lose");
          break;
        }
        case "castStart": {
          // The cue starts with the key press; the release sound follows when the wind-up ends.
          const stop = this.sound(abilityById(e.abilityId)?.sfx?.cast, unit(e.unit)?.x, unit(e.unit)?.z);
          if (stop) this.castSounds.set(e.unit, stop);
          break;
        }
        case "castCancel": {
          this.castSounds.get(e.unit)?.();
          this.castSounds.delete(e.unit);
          const u = unit(e.unit);
          if (!u || e.reason !== "cancelled") break;
          p.emit(u.x, 1.3, u.z, { n: 14, spd: 1.6, vy: 1.2, col: [0.8, 0.8, 0.85], col2: [0.25, 0.25, 0.3], life: 0.35, size: 0.4, jit: 0.5 });
          this.sound("cast_cancel", u.x, u.z);
          if (u.id === me.id) overlay.floatText(u.x, 2.9, u.z, "отмена", "#d9d2c5");
          break;
        }
        case "abilityFire": {
          const a = abilityById(e.abilityId);
          const u = unit(e.unit);
          if (!a || !u) break;
          this.castSounds.delete(e.unit);
          const col = this.palette(u, state);
          this.champs.get(e.unit)?.attack(a.kind === "cone" && !!a.onHit.knockback);
          this.sound(a.sfx?.fire, e.x, e.z);
          const face = Math.atan2(e.aimX - e.x, e.aimZ - e.z);
          const dx = Math.sin(face);
          const dz = Math.cos(face);
          if (a.kind === "cone") {
            fx.cone(e.x, e.z, face, a.range, a.halfAngleDeg * DEG, e.empowered ? 0xfff0a0 : a.color, e.empowered ? 0.75 : 0.55);
            const half = a.halfAngleDeg * DEG;
            for (let i = 0; i < 14; i++) {
              const ang = face + rand(-half, half);
              p.emit(e.x + Math.sin(ang) * a.range * 0.8, 1, e.z + Math.cos(ang) * a.range * 0.8, { spd: 2.4, col: col[0], col2: col[1], life: 0.32, size: 0.34 });
            }
          } else if (a.kind === "projectile") {
            // Muzzle flash.
            p.emit(e.x + dx * 0.9, 1.15, e.z + dz * 0.9, { n: a.visual.heavy ? 22 : 10, spd: a.visual.heavy ? 5 : 3.5, dx, dz, cone: 0.45, col: col[0], col2: col[1], life: 0.3, size: a.visual.heavy ? 0.6 : 0.4 });
            fx.light(e.x + dx, 1.4, e.z + dz, a.color, a.visual.heavy ? 90 : 40, 0.2);
          } else if (a.kind === "counter") {
            fx.wave(e.x, e.z, 1.8, a.color, 0.3);
          } else if (a.kind === "channel") {
            fx.wave(e.x, e.z, a.radius, a.color, 0.4, true);
          }
          if (a.energyCost) {
            // Ultimates announce themselves.
            fx.wave(e.x, e.z, 4.5, a.color, 0.55, true);
            fx.disc(e.x, e.z, 2.2, a.color, 0.4, 0.45);
            p.emit(e.x, 1, e.z, { n: 50, spd: 8, up: 0.6, col: col[0], col2: col[1], life: 0.6, size: 0.5, drag: 3 });
            this.shakeAt(e.x, e.z, 0.25);
            if (!a.castTime) this.sound(a.sfx?.cast, e.x, e.z);
            overlay.floatText(e.x, 3.6, e.z, a.nameRu + "!", a.color, true);
          }
          break;
        }
        case "projectileEnd": {
          const a = e.abilityId ? abilityById(e.abilityId) : undefined;
          const owner = state.units.find((u) => u.kind === "champion" && u.team === e.team);
          const col = this.palette(owner, state);
          if (e.reason === "hit") {
            fx.boom(e.x, e.z, e.heavy ? 1.7 : 0.75, col, a?.color ?? 0xffa050);
            this.shakeAt(e.x, e.z, e.heavy ? 0.22 : 0.06);
            this.sound(a?.sfx?.hit ?? "fire_hit", e.x, e.z, e.heavy ? 1 : 0.8);
          } else if (e.reason === "blocked" || e.reason === "expired") {
            p.emit(e.x, 1.15, e.z, { n: 12, spd: 2.8, col: col[0], col2: col[1], life: 0.3, size: 0.32, drag: 3 });
            if (e.reason === "blocked") this.sound("fire_hit", e.x, e.z, 0.5);
          }
          break;
        }
        case "groundSpawn": {
          // The sound was already played by abilityFire.
          const a = abilityById(e.abilityId);
          fx.wave(e.x, e.z, e.radius, a?.color ?? 0xff7a2b, 0.3);
          break;
        }
        case "groundBurst": {
          const a = abilityById(e.abilityId);
          const g = state.units.find((u) => u.kind === "champion" && abilityOwner(u, e.abilityId));
          const col = this.palette(g, state);
          fx.boom(e.x, e.z, e.radius, col, a?.color ?? 0xffa050);
          this.shakeAt(e.x, e.z, e.falling ? 0.85 : 0.35);
          this.sound(a?.sfx?.hit, e.x, e.z);
          if (e.falling) p.emit(e.x, 0.5, e.z, { n: 70, spd: 9, up: 1.2, vy: 2, col: col[0], col2: col[1], life: 0.9, size: 0.65, drag: 1.5, grav: 7, jit: 2 });
          break;
        }
        case "damage": {
          if (e.targetKind === "orb") {
            this.world.flashOrb();
            overlay.floatText(e.x, 2.1, e.z, String(Math.round(e.amount)), "#ffe7a3");
            break;
          }
          const mine = e.target === me.id;
          const byMe = e.source === me.id;
          if (e.targetKind === "companion") {
            this.pets.get(e.target)?.flash();
            const ownPet = unit(e.target)?.team === this.viewerTeam;
            overlay.floatText(e.x + rand(-0.2, 0.2), 1.9, e.z, String(Math.max(1, Math.round(e.amount))), ownPet ? "#ff9d8f" : "#ffe2b8");
            break;
          }
          this.champs.get(e.target)?.flash();
          // Remember the blow by where it physically came from (a companion's bite comes from the companion,
          // not from its owner, who only gets the credit).
          const blow = blowOf(e, state.tick / rules.tickRate);
          if (blow) this.lastHit.set(e.target, blow);
          if (e.absorbed > 0) {
            overlay.floatText(e.x, 2.4, e.z, "щит", "#ffd28a");
            this.sound("shield_block", e.x, e.z);
          }
          if (e.amount > 0) {
            const color = mine ? "#ff7b6b" : byMe ? "#fff4d6" : "#ffcf9e";
            overlay.floatText(e.x + rand(-0.3, 0.3), 2.5, e.z, String(Math.max(1, Math.round(e.amount))), color, e.amount >= 25);
            if (mine && !e.dot) {
              this.shake = Math.max(this.shake, Math.min(0.6, e.amount * 0.025));
              this.sound("hurt");
            }
          }
          break;
        }
        case "meleeHit": {
          const a = abilityById(e.abilityId);
          const s = unit(e.source);
          const t = unit(e.target);
          if (!s || !t) break;
          const dx = t.x - s.x;
          const dz = t.z - s.z;
          const d = Math.hypot(dx, dz) || 1;
          const played =
            a?.vfx?.onHit === "ink_blade_hit" && this.ink.play(this.camera, t.x - (dx / d) * 0.35, 1.25, t.z - (dz / d) * 0.35, dx, dz, e.empowered ? 1.3 : 1);
          if (!played) p.emit(t.x, 1.1, t.z, { n: 14, spd: 4, dx: dx / d, dz: dz / d, cone: 0.6, col: SPARK[0], col2: SPARK[1], life: 0.3, size: 0.36 });
          this.sound(a?.sfx?.hit, t.x, t.z);
          this.shakeAt(t.x, t.z, e.empowered ? 0.2 : 0.08);
          break;
        }
        case "status": {
          const u = unit(e.unit);
          if (!u) break;
          if (e.status === "stun") this.sound("stun", u.x, u.z, 0.8);
          if (e.status === "root") overlay.floatText(u.x, 3, u.z, "Прижат!", "#ffe2b8", true);
          break;
        }
        case "counter": {
          const u = unit(e.unit);
          if (!u) break;
          overlay.floatText(u.x, 2.8, u.z, "Контр!", "#ffe066", true);
          p.emit(u.x, 1.1, u.z, { n: 44, spd: 7, up: 0.5, col: GOLDEN[0], col2: GOLDEN[1], life: 0.5, size: 0.45, drag: 3 });
          fx.wave(u.x, u.z, 2.6, GOLD, 0.3, true);
          fx.disc(u.x, u.z, 1.6, GOLD, 0.25, 0.5);
          this.sound("counter_trigger", u.x, u.z);
          break;
        }
        case "slam":
          p.emit(e.x, 1, e.z, { n: 30, spd: 4, up: 0.8, col: DUST[0], col2: DUST[1], life: 0.5, size: 0.55, drag: 3, grav: 4, jit: 0.4 });
          fx.wave(e.x, e.z, 1.7, 0xffd28a, 0.3, true);
          this.shakeAt(e.x, e.z, 0.5);
          overlay.floatText(e.x, 3, e.z, "Об стену!", "#ffd28a", true);
          this.sound("slam", e.x, e.z);
          break;
        case "blink": {
          const col = this.palette(unit(e.unit), state);
          for (const [x, z] of [
            [e.fromX, e.fromZ],
            [e.toX, e.toZ],
          ] as const) {
            p.emit(x, 1, z, { n: 30, spd: 3, up: 0.6, vy: 0.5, col: col[0], col2: col[1], life: 0.45, size: 0.5, drag: 2, jit: 0.7 });
          }
          fx.wave(e.fromX, e.fromZ, 1.2, 0xff7a2b, 0.25);
          fx.wave(e.toX, e.toZ, 1.8, 0xff7a2b, 0.32, true);
          break;
        }
        case "leapLand": {
          const a = abilityById(e.abilityId);
          fx.boom(e.x, e.z, e.radius, this.palette(unit(e.unit), state), a?.color ?? GOLD);
          this.shakeAt(e.x, e.z, 0.4);
          this.sound(a?.sfx?.hit, e.x, e.z);
          break;
        }
        case "nova": {
          const a = abilityById(e.abilityId);
          const col = this.palette(unit(e.unit), state);
          fx.wave(e.x, e.z, e.radius, a?.color ?? 0xff7a2b, 0.38, true);
          fx.disc(e.x, e.z, e.radius, a?.color ?? 0xff7a2b, 0.32, 0.5);
          p.emit(e.x, 1, e.z, { n: 50, spd: 8, col: col[0], col2: col[1], life: 0.5, size: 0.52, drag: 3 });
          fx.light(e.x, 1.5, e.z, a?.color ?? 0xff7a2b, 160, 0.35);
          this.shakeAt(e.x, e.z, 0.2);
          break;
        }
        case "channelTick": {
          const a = abilityById(e.abilityId);
          fx.wave(e.x, e.z, e.radius, a?.color ?? GOLD, 0.25);
          fx.disc(e.x, e.z, e.radius, a?.color ?? GOLD, 0.2, 0.22);
          this.sound("cleave", e.x, e.z, 0.7);
          break;
        }
        case "death": {
          const u = unit(e.unit);
          if (!u) break;
          const c: RGB = u.team === this.viewerTeam ? [0.3, 0.85, 1] : [1, 0.35, 0.25];
          p.emit(u.x, 1, u.z, { n: 80, spd: 6, up: 0.9, vy: 1, col: c, col2: [0.3, 0.1, 0.05], life: 0.8, size: 0.5, drag: 2, grav: 4, jit: 0.6 });
          fx.wave(u.x, u.z, 3, teamHex(u.team), 0.5, true);
          this.sound("death", u.x, u.z);
          this.shakeAt(u.x, u.z, 0.3);
          // The blow that just landed throws the body. Without one (burn, zone, rift, or a hit from a while ago
          // followed by damage over time) it crumples.
          const impulse = impulseFor(this.lastHit.get(u.id), state.tick / rules.tickRate);
          this.lastHit.delete(u.id);
          this.champs.get(u.id)?.startRagdoll(this.scene, impulse, this.ragdollWorld, { x: u.x, z: u.z, face: u.face });
          break;
        }
        case "respawn": {
          const u = unit(e.unit);
          if (u) fx.wave(u.x, u.z, 1.6, teamHex(u.team), 0.35);
          break;
        }
        case "companionDeath": {
          const c = unit(e.unit);
          if (!c) break;
          const col = this.palette(c, state);
          p.emit(c.x, this.pets.get(c.id)?.centerHeight ?? 1, c.z, { n: 44, spd: 5, up: 0.8, col: col[0], col2: [0.3, 0.1, 0.05], life: 0.7, size: 0.45, drag: 2, grav: 3, jit: 0.4 });
          this.sound("companion_death", c.x, c.z);
          const own = c.team === this.viewerTeam;
          this.cb.message(own ? `Компаньон вернётся через ${rules.companion.respawn} с` : "Компаньон соперника повержен", 1.4);
          break;
        }
        case "companionRespawn": {
          const c = unit(e.unit);
          if (!c) break;
          const col = this.palette(c, state);
          p.emit(c.x, 1.2, c.z, { n: 26, spd: 3, up: 0.8, col: col[0], col2: col[1], life: 0.5, size: 0.4, jit: 0.5 });
          fx.wave(c.x, c.z, 1.2, teamHex(c.team), 0.3);
          break;
        }
        case "companionCommand": {
          const c = unit(e.unit);
          if (c) fx.wave(e.x, e.z, 1.1, teamHex(c.team), 0.4, true);
          break;
        }
        case "companionAttack": {
          const c = unit(e.unit);
          const view = this.pets.get(e.unit);
          if (!c || !view) break;
          view.attack();
          if (view.centerHeight > 1.5) {
            p.emit(c.x, 1.8, c.z, { n: 7, spd: 2, col: rgb("#ffcc66"), col2: rgb("#cc3305"), life: 0.3, size: 0.32 });
            this.sound("wisp_shot", c.x, c.z);
          } else {
            p.emit(e.x, 1, e.z, { n: e.heavy ? 24 : 10, spd: e.heavy ? 4 : 2.5, col: SPARK[0], col2: SPARK[1], life: 0.35, size: e.heavy ? 0.45 : 0.32, jit: 0.3 });
            if (e.heavy) fx.wave(e.x, e.z, 1.4, 0xffffff, 0.28, true);
            this.sound("hound_bite", e.x, e.z, e.heavy ? 1 : 0.6);
          }
          break;
        }
        case "companionInteract": {
          const c = unit(e.unit);
          const col = this.palette(c, state);
          if (e.kind === "split") fx.boom(e.x, e.z, 1.3, col, 0xff6a2a);
          else {
            fx.wave(e.x, e.z, 1.5, GOLD, 0.3, true);
            p.emit(e.x, 1, e.z, { n: 22, spd: 4, col: col[0], col2: col[1], life: 0.4, size: 0.4 });
            this.sound("hook_hit", e.x, e.z);
          }
          break;
        }
        case "energy": {
          const u = unit(e.unit);
          if (u) overlay.floatText(u.x, 3, u.z, `+${e.amount} энергии`, "#ffe066");
          break;
        }
        case "obstacleHit":
          this.world.obstacleHit(e.id);
          p.emit(e.x, 0.9, e.z, { n: 9, spd: 3, up: 0.8, col: WOOD[0], col2: WOOD[1], life: 0.5, size: 0.35, grav: 6, jit: 1.2 });
          this.sound("wood_hit", e.x, e.z);
          break;
        case "obstacleBreak":
          p.emit(e.x, 0.8, e.z, { n: 64, spd: 6, up: 1, vy: 2, col: WOOD[0], col2: WOOD[1], life: 0.9, size: 0.5, grav: 8, drag: 1, jit: 3 });
          fx.wave(e.x, e.z, 2.4, 0xc89050, 0.35, true);
          this.shakeAt(e.x, e.z, 0.35);
          this.sound("wood_break", e.x, e.z);
          break;
        case "obstacleRebuild":
          this.world.obstacleRebuilt(e.id);
          break;
        case "crateBump":
          p.emit(e.x, 0.4, e.z, { n: 10, spd: 2.5, col: DUST[0], col2: DUST[1], life: 0.4, size: 0.4, jit: 0.6 });
          this.sound("crate_bump", e.x, e.z);
          break;
        case "crateHit":
          p.emit(e.x, 1, e.z, { n: 22, spd: 4, col: DUST[0], col2: DUST[1], life: 0.4, size: 0.45, jit: 0.4 });
          this.shakeAt(e.x, e.z, 0.3);
          this.sound("heavy_hit", e.x, e.z);
          break;
        case "orbSpawn":
          this.cb.message("В центре появилась сфера", 1.6);
          fx.wave(0, 0, 2.2, GOLD, 0.5, true);
          this.sound("orb_spawn", 0, 0);
          break;
        case "orbBreak": {
          fx.boom(0, 0, 2.2, GOLDEN, GOLD);
          this.sound("orb_break", 0, 0);
          const u = unit(e.by);
          if (!u) break;
          overlay.floatText(u.x, 2.9, u.z, `+${e.heal}`, "#7dffa0", true);
          this.cb.message(u.id === me.id ? `Сфера твоя: +${e.heal} здоровья, +${e.energy} энергии` : "Соперник забрал сферу", 1.8);
          break;
        }
        case "suddenDeath":
          this.cb.message("Арена рушится!", 2.2, true);
          this.sound("sudden_death");
          this.shake = Math.max(this.shake, 0.5);
          break;
        case "riftOpen": {
          const r = state.rifts.find((x) => x.id === e.id);
          if (!r) break;
          for (const pt of r.points) p.emit(pt.x, 0.3, pt.z, { n: 16, spd: 3, up: 1, col: DUST[0], col2: DUST[1], life: 0.7, size: 0.55, grav: 5, jit: 1.2 });
          const mid = r.points[Math.floor(r.points.length / 2)]!;
          this.sound("rift_open", mid.x, mid.z, 0.9);
          this.shakeAt(mid.x, mid.z, 0.35);
          break;
        }
        case "riftWarn": {
          const r = state.rifts.find((x) => x.id === e.id);
          const mid = r?.points[Math.floor(r.points.length / 2)];
          if (mid) this.sound("rift_warn", mid.x, mid.z, 0.7);
          break;
        }
        case "riftErupt": {
          this.hazards.erupt(e.id);
          const r = state.rifts.find((x) => x.id === e.id);
          const mid = r?.points[Math.floor(r.points.length / 2)];
          if (!mid) break;
          this.sound("rift_erupt", mid.x, mid.z);
          this.shakeAt(mid.x, mid.z, 0.3);
          fx.light(mid.x, 2, mid.z, 0xff7a2b, 220, 0.6);
          break;
        }
        default:
          break;
      }
    }
  }
}

/** Does this champion own the ability with the given id? */
function abilityOwner(u: Unit, abilityId: string): boolean {
  return u.kind === "champion" && abilityId.startsWith(`${u.champion}.`);
}
