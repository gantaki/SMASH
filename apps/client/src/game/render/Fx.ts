// Everything readable on the ground: wind-up telegraphs, AoE markers, projectiles, shockwaves, scorch marks.
// Readability rules (GAME_DESIGN §2): outline = team colour, fill = ability colour, fill progress = time left.

import * as THREE from "three";
import { abilityById, getChampion, type Ability } from "@smash/content";
import { reach, type ChampionUnit, type GroundEffect, type MatchState, type Projectile } from "@smash/sim";
import { ALLY, FOE, G, TAU, basic, discard, keep, rgb, sector, type RGB } from "./gfx.ts";
import type { Particles } from "./Particles.ts";

const DEG = Math.PI / 180;

interface Transient {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  t: number;
  dur: number;
  opacity: number;
  s0: number;
  s1: number;
  /** Ease-out growth (shockwaves) or none (decals). */
  grow: boolean;
}

interface ProjectileView {
  group: THREE.Group;
  chain?: THREE.Line;
  col: [RGB, RGB];
  heavy: boolean;
}

interface GroundView {
  group: THREE.Group;
  fill: THREE.Mesh;
  closing: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  edge: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  meteor?: THREE.Group;
}

interface CastView {
  group: THREE.Group;
  abilityId: string;
  progress: THREE.Object3D;
  kind: Ability["kind"];
}

interface AreaView {
  group: THREE.Group;
  fill?: THREE.Mesh;
}

const chainMat = keep(new THREE.LineBasicMaterial({ color: 0xd9b25a }));

export class Fx {
  readonly group = new THREE.Group();
  private readonly transients: Transient[] = [];
  private readonly projectiles = new Map<number, ProjectileView>();
  private readonly grounds = new Map<number, GroundView>();
  private readonly casts = new Map<number, CastView>();
  private readonly leaps = new Map<number, AreaView>();
  private readonly channels = new Map<number, AreaView>();
  private readonly flash = new THREE.PointLight(0xffa050, 0, 22, 1.6);
  private flashT = 0;
  private flashDur = 1;
  private flashPeak = 0;

  constructor(
    private readonly particles: Particles,
    private readonly viewerTeam: 0 | 1,
  ) {
    this.group.add(this.flash);
  }

  private teamColor(team: 0 | 1): number {
    return team === this.viewerTeam ? ALLY : FOE;
  }

  // ---------- transient effects ----------

  private transient(mesh: Transient["mesh"], dur: number, s0: number, s1: number, grow: boolean, scaleY = false): void {
    mesh.scale.set(s0, scaleY ? s0 : 1, s0);
    this.group.add(mesh);
    this.transients.push({ mesh, t: 0, dur, opacity: mesh.material.opacity, s0, s1, grow });
  }

  /** Expanding ring. */
  wave(x: number, z: number, r: number, color: THREE.ColorRepresentation, dur = 0.35, thick = false): void {
    const m = new THREE.Mesh(thick ? G.band : G.ring, basic(color, 0.85, true));
    m.position.set(x, 0.07, z);
    this.transient(m, dur, r * 0.3, r, true);
  }

  /** Filled circle that flashes and fades: shows exactly what area was hit. */
  disc(x: number, z: number, r: number, color: THREE.ColorRepresentation, dur = 0.3, opacity = 0.5): void {
    const m = new THREE.Mesh(G.circle, basic(color, opacity, true));
    m.position.set(x, 0.06, z);
    this.transient(m, dur, r, r, false);
  }

  /** Dark burn mark left on the floor. */
  scorch(x: number, z: number, r: number, dur = 4.5): void {
    const m = new THREE.Mesh(G.circle, basic(0x180b05, 0.4));
    m.position.set(x, 0.021, z);
    m.renderOrder = -1;
    this.transient(m, dur, r, r, false);
  }

  /** Melee arc flash. */
  cone(x: number, z: number, face: number, range: number, half: number, color: THREE.ColorRepresentation, opacity = 0.55): void {
    const m = new THREE.Mesh(sector(half), basic(color, opacity, true));
    m.position.set(x, 0.065, z);
    m.rotation.y = face;
    this.transient(m, 0.22, range * 0.6, range, true);
    // A second, slower outline so the swing's reach lingers for a moment.
    const edge = new THREE.Mesh(sector(half), basic(color, 0.16, true));
    edge.position.set(x, 0.06, z);
    edge.rotation.y = face;
    this.transient(edge, 0.34, range, range, false);
  }

  light(x: number, y: number, z: number, color: THREE.ColorRepresentation, intensity: number, dur = 0.35): void {
    if (intensity * dur < this.flash.intensity * (this.flashDur - this.flashT)) return;
    this.flash.color.set(color);
    this.flash.position.set(x, y, z);
    this.flashPeak = intensity;
    this.flashT = 0;
    this.flashDur = dur;
  }

  /** Explosion: debris, hot core, shockwave, area flash, light. */
  boom(x: number, z: number, r: number, col: readonly [RGB, RGB], ring: THREE.ColorRepresentation = 0xffa050): void {
    const p = this.particles;
    p.emit(x, 0.6, z, { n: Math.round(22 + r * 18), spd: 3 + r * 2.4, up: 0.9, vy: 1, col: col[0], col2: col[1], life: 0.6, size: 0.5 + r * 0.1, drag: 2.5, grav: 5, jit: r * 0.6 });
    p.emit(x, 0.6, z, { n: 4, spd: 0.3, col: [1, 0.85, 0.6], life: 0.16, size: Math.min(5, r * 1.5) });
    this.wave(x, z, r * 1.15, ring, 0.4, r > 1.5);
    if (r > 1.5) {
      this.disc(x, z, r, ring, 0.35, 0.55);
      this.scorch(x, z, r * 0.9);
    }
    this.light(x, 1.5, z, ring, 60 + r * 90, 0.4);
  }

  // ---------- views synced to sim state ----------

  private makeProjectile(p: Projectile, state: MatchState): ProjectileView {
    const group = new THREE.Group();
    const core = new THREE.Mesh(G.sphere, basic(p.visual.core));
    core.scale.setScalar(p.visual.size);
    const glow = new THREE.Mesh(G.sphere, basic(p.visual.glow, 0.45, true));
    glow.scale.setScalar(p.visual.size * 2.6);
    // Ground marker: the hitbox, in the owner's team colour.
    const marker = new THREE.Mesh(G.circle, basic(this.teamColor(p.team), 0.3));
    marker.scale.setScalar(p.radius);
    marker.position.y = -1.1;
    const rim = new THREE.Mesh(G.ring, basic(this.teamColor(p.team), 0.85));
    rim.scale.setScalar(p.radius);
    rim.position.y = -1.095;
    group.add(core, glow, marker, rim);
    this.group.add(group);
    const owner = state.units.find((u) => u.id === p.credit);
    const champ = owner?.kind === "champion" ? getChampion(owner.champion) : undefined;
    const view: ProjectileView = {
      group,
      col: champ ? [rgb(champ.particles[0]), rgb(champ.particles[1])] : [rgb(p.visual.glow), rgb(p.visual.glow)],
      heavy: !!p.visual.heavy,
    };
    if (p.hook) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
      view.chain = new THREE.Line(geo, chainMat);
      view.chain.frustumCulled = false;
      this.group.add(view.chain);
    }
    return view;
  }

  private makeGround(g: GroundEffect): GroundView {
    const a = abilityById(g.abilityId);
    const team = this.teamColor(g.team);
    const color = a?.color ?? "#ff7a2b";
    const group = new THREE.Group();
    const base = new THREE.Mesh(G.circle, basic(team, 0.14));
    base.scale.setScalar(g.radius);
    const fill = new THREE.Mesh(G.circle, basic(color, 0.42, true));
    fill.position.y = 0.006;
    const edge = new THREE.Mesh(G.band, basic(team, 0.95));
    edge.scale.setScalar(g.radius);
    edge.position.y = 0.012;
    // A ring that closes in on the edge: reaching it = detonation.
    const closing = new THREE.Mesh(G.ring, basic(0xffffff, 0.0, true));
    closing.position.y = 0.018;
    group.add(base, fill, edge, closing);
    group.position.set(g.x, 0.03, g.z);
    this.group.add(group);
    const view: GroundView = { group, fill, edge, closing };
    if (g.falling) {
      const m = new THREE.Group();
      const c = new THREE.Mesh(G.sphere, basic(0xffe0a0));
      c.scale.setScalar(0.9);
      const gl = new THREE.Mesh(G.sphere, basic(color, 0.45, true));
      gl.scale.setScalar(2.1);
      m.add(c, gl);
      this.group.add(m);
      view.meteor = m;
    }
    return view;
  }

  private makeCast(u: ChampionUnit, a: Ability): CastView | null {
    const team = this.teamColor(u.team);
    const group = new THREE.Group();
    let progress: THREE.Object3D;
    if (a.kind === "projectile") {
      const w = Math.max(a.radius * 2, 0.5);
      const base = new THREE.Mesh(G.line, basic(team, 0.2));
      base.scale.set(w, 1, a.range);
      const fill = new THREE.Mesh(G.line, basic(a.color, 0.5, true));
      fill.scale.set(w, 1, 0.01);
      fill.position.y = 0.005;
      const tip = new THREE.Mesh(G.line, basic(team, 0.9));
      tip.scale.set(w, 1, 0.12);
      tip.position.set(0, 0.008, a.range - 0.12);
      for (const sx of [-1, 1]) {
        const side = new THREE.Mesh(G.line, basic(team, 0.7));
        side.scale.set(0.06, 1, a.range);
        side.position.set((sx * w) / 2, 0.008, 0);
        group.add(side);
      }
      group.add(base, fill, tip);
      progress = fill;
    } else if (a.kind === "cone") {
      const half = a.halfAngleDeg * DEG;
      const base = new THREE.Mesh(sector(half), basic(team, 0.22));
      base.scale.setScalar(a.range);
      const fill = new THREE.Mesh(sector(half), basic(a.color, 0.5, true));
      fill.position.y = 0.005;
      group.add(base, fill);
      progress = fill;
    } else if (a.kind === "groundAoe") {
      const base = new THREE.Mesh(G.circle, basic(team, 0.1));
      base.scale.setScalar(a.radius);
      const edge = new THREE.Mesh(G.ring, basic(team, 0.8));
      edge.scale.setScalar(a.radius);
      const fill = new THREE.Mesh(G.circle, basic(a.color, 0.3, true));
      fill.position.y = 0.005;
      group.add(base, edge, fill);
      progress = fill;
    } else return null;
    this.group.add(group);
    return { group, abilityId: a.id, progress, kind: a.kind };
  }

  private makeArea(radius: number, team: 0 | 1, color: string, withFill: boolean): AreaView {
    const group = new THREE.Group();
    const base = new THREE.Mesh(G.circle, basic(this.teamColor(team), 0.1));
    base.scale.setScalar(radius);
    const edge = new THREE.Mesh(G.ring, basic(this.teamColor(team), 0.9));
    edge.scale.setScalar(radius);
    edge.position.y = 0.01;
    group.add(base, edge);
    const view: AreaView = { group };
    if (withFill) {
      view.fill = new THREE.Mesh(G.circle, basic(color, 0.35, true));
      view.fill.position.y = 0.005;
      group.add(view.fill);
    }
    this.group.add(group);
    return view;
  }

  private prune<V extends { group: THREE.Object3D }>(map: Map<number, V>, alive: Set<number>, extra?: (v: V) => void): void {
    for (const [id, v] of map) {
      if (alive.has(id)) continue;
      discard(this.group, v.group);
      extra?.(v);
      map.delete(id);
    }
  }

  sync(state: MatchState, time: number, dt: number, pos: (e: { id: number; x: number; z: number }) => { x: number; z: number }): void {
    // Transients.
    for (let i = this.transients.length - 1; i >= 0; i--) {
      const f = this.transients[i]!;
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      f.mesh.material.opacity = f.opacity * (1 - k * k);
      if (f.grow) {
        const s = f.s0 + (f.s1 - f.s0) * Math.sqrt(k);
        f.mesh.scale.set(s, 1, s);
      }
      if (k >= 1) {
        discard(this.group, f.mesh);
        this.transients.splice(i, 1);
      }
    }
    this.flashT += dt;
    this.flash.intensity = this.flashT < this.flashDur ? this.flashPeak * (1 - this.flashT / this.flashDur) ** 2 : 0;

    // Projectiles.
    const seen = new Set<number>();
    for (const p of state.projectiles) {
      seen.add(p.id);
      let v = this.projectiles.get(p.id);
      if (!v) this.projectiles.set(p.id, (v = this.makeProjectile(p, state)));
      const q = pos(p);
      v.group.position.set(q.x, 1.15, q.z);
      const pulse = 1 + Math.sin(time * 30 + p.id) * 0.08;
      v.group.children[1]!.scale.setScalar(p.visual.size * 2.6 * pulse);
      if (dt > 0) {
        this.particles.emit(q.x, 1.15, q.z, { n: v.heavy ? 4 : 2, spd: 0.5, col: v.col[0], col2: v.col[1], life: v.heavy ? 0.5 : 0.3, size: v.heavy ? 0.65 : 0.36, jit: 0.15 });
      }
      if (v.chain) {
        const owner = state.units.find((u) => u.id === p.owner);
        if (owner) {
          const o = pos(owner);
          const a = v.chain.geometry.attributes.position as THREE.BufferAttribute;
          a.setXYZ(0, o.x, 1.25, o.z);
          a.setXYZ(1, q.x, 1.15, q.z);
          a.needsUpdate = true;
        }
      }
    }
    this.prune(this.projectiles, seen, (v) => {
      if (v.chain) {
        this.group.remove(v.chain);
        v.chain.geometry.dispose();
      }
    });

    // Delayed ground effects.
    seen.clear();
    for (const g of state.grounds) {
      seen.add(g.id);
      let v = this.grounds.get(g.id);
      if (!v) this.grounds.set(g.id, (v = this.makeGround(g)));
      const k = Math.min(1, g.t / g.delay);
      v.fill.scale.setScalar(Math.max(0.01, g.radius * k));
      const cs = g.radius * (1.9 - 0.9 * k);
      v.closing.scale.set(cs, 1, cs);
      v.closing.material.opacity = 0.25 + 0.65 * k;
      // The edge pulses faster as the explosion approaches.
      v.edge.material.opacity = 0.7 + 0.3 * Math.sin(time * (8 + 26 * k));
      if (v.meteor) {
        v.meteor.position.set(g.x + 7 * (1 - k), 20 * (1 - k) + 0.5, g.z - 5 * (1 - k));
        if (dt > 0) this.particles.emit(v.meteor.position.x, v.meteor.position.y, v.meteor.position.z, { n: 5, spd: 1, col: rgb("#ffb24d"), col2: rgb("#991400"), life: 0.55, size: 1.1, jit: 0.6 });
      }
    }
    this.prune(this.grounds, seen, (v) => {
      if (v.meteor) discard(this.group, v.meteor);
    });

    // Wind-ups, leap landing markers, channel areas.
    seen.clear();
    const leaping = new Set<number>();
    const channelling = new Set<number>();
    for (const u of state.units) {
      if (u.kind !== "champion" || u.dead) continue;
      const champ = getChampion(u.champion);
      const p = pos(u);
      if (u.cast) {
        const a = champ.abilities[u.cast.slot];
        let v = this.casts.get(u.id);
        if (v && v.abilityId !== a?.id) {
          discard(this.group, v.group);
          this.casts.delete(u.id);
          v = undefined;
        }
        if (!v && a) {
          const made = this.makeCast(u, a);
          if (made) this.casts.set(u.id, (v = made));
        }
        if (v && a) {
          seen.add(u.id);
          const k = 1 - u.cast.time / u.cast.total;
          if (a.kind === "groundAoe") {
            const t = reach(u, u.aim, a.maxRange);
            v.group.position.set(t.x, 0.04, t.z);
            v.progress.scale.setScalar(Math.max(0.01, a.radius * k));
          } else {
            v.group.position.set(p.x, 0.04, p.z);
            v.group.rotation.y = Math.atan2(u.aim.x - u.x, u.aim.z - u.z);
            if (a.kind === "projectile") v.progress.scale.z = Math.max(0.01, a.range * k);
            else if (a.kind === "cone") v.progress.scale.setScalar(Math.max(0.01, a.range * k));
          }
        }
      }
      if (u.leap) {
        const a = champ.abilities[u.leap.slot];
        if (a?.kind === "leap") {
          leaping.add(u.id);
          let v = this.leaps.get(u.id);
          if (!v) this.leaps.set(u.id, (v = this.makeArea(a.landing.radius, u.team, a.color, true)));
          v.group.position.set(u.leap.x1, 0.035, u.leap.z1);
          v.fill?.scale.setScalar(Math.max(0.01, a.landing.radius * Math.min(1, u.leap.t / u.leap.duration)));
        }
      }
      if (u.channel) {
        const a = champ.abilities[u.channel.slot];
        if (a?.kind === "channel") {
          channelling.add(u.id);
          let v = this.channels.get(u.id);
          if (!v) this.channels.set(u.id, (v = this.makeArea(a.radius, u.team, a.color, false)));
          v.group.position.set(p.x, 0.035, p.z);
          v.group.rotation.y = time * 6;
        }
      }
    }
    this.prune(this.casts, seen);
    this.prune(this.leaps, leaping);
    this.prune(this.channels, channelling);
  }

  clear(): void {
    const none = new Set<number>();
    for (const f of this.transients) discard(this.group, f.mesh);
    this.transients.length = 0;
    this.prune(this.projectiles, none, (v) => v.chain && this.group.remove(v.chain));
    this.prune(this.grounds, none, (v) => v.meteor && discard(this.group, v.meteor));
    this.prune(this.casts, none);
    this.prune(this.leaps, none);
    this.prune(this.channels, none);
  }
}

export { TAU };
