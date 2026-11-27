// Sudden death visuals: the closing zone and the rifts (cracks that erupt like geysers).

import * as THREE from "three";
import { arena } from "@smash/content";
import type { MatchState, Rift } from "@smash/sim";
import { basic, discard, rgb } from "./gfx.ts";
import type { Particles } from "./Particles.ts";

interface RiftView {
  group: THREE.Group;
  crack: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  glow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  core: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  /** Points along the crack for emitting particles. */
  samples: { x: number; z: number }[];
}

const STEAM_A = rgb("#fff1c2");
const LAVA_A = rgb("#ffb347");
const LAVA_B = rgb("#c21a00");
const EMBER = rgb("#ff7a2b");
const ZONE_COLOR = 0xff3b2a;

/** Small deterministic hash so a rift's jagged edge is stable from frame to frame. */
const hash = (n: number): number => {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
};

/** A ribbon of the given half-width along a polyline, lying on the ground. */
function ribbon(points: readonly { x: number; z: number }[], halfWidth: number, jag: number, seed: number): THREE.BufferGeometry {
  const pts: { x: number; z: number }[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.z - a.z) / 0.7));
    for (let k = 0; k < n; k++) pts.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
  }
  pts.push(points[points.length - 1]!);
  const pos: number[] = [];
  const idx: number[] = [];
  pts.forEach((p, i) => {
    const prev = pts[Math.max(0, i - 1)]!;
    const next = pts[Math.min(pts.length - 1, i + 1)]!;
    const dx = next.x - prev.x;
    const dz = next.z - prev.z;
    const l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l;
    const nz = dx / l;
    // Taper to a point at both ends; jitter the edges.
    const taper = Math.min(1, i / 2, (pts.length - 1 - i) / 2);
    const wl = halfWidth * taper * (1 - jag * hash(seed + i * 2));
    const wr = halfWidth * taper * (1 - jag * hash(seed + i * 2 + 1));
    pos.push(p.x + nx * wl, 0, p.z + nz * wl, p.x - nx * wr, 0, p.z - nz * wr);
    if (i > 0) {
      const o = (i - 1) * 2;
      idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export class Hazards {
  readonly group = new THREE.Group();
  private readonly rifts = new Map<number, RiftView>();
  private readonly wall: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly edge: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private outside: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null = null;
  private outsideRadius = 0;

  constructor(private readonly particles: Particles) {
    this.wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 5, 96, 1, true), basic(ZONE_COLOR, 0.24, true));
    this.wall.position.y = 2.5;
    this.wall.visible = false;
    this.edge = new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 128).rotateX(-Math.PI / 2), basic(ZONE_COLOR, 0.95));
    this.edge.position.y = 0.05;
    this.edge.visible = false;
    this.group.add(this.wall, this.edge);
  }

  private makeRift(r: Rift): RiftView {
    const hw = arena.suddenDeath.rifts.halfWidth;
    const group = new THREE.Group();
    // Danger area (matches the hitbox), hot core, and the dark crack itself.
    const glow = new THREE.Mesh(ribbon(r.points, hw, 0.15, r.id), basic(0xff5a1f, 0.2, true));
    glow.position.y = 0.024;
    const crack = new THREE.Mesh(ribbon(r.points, hw * 0.42, 0.55, r.id + 50), basic(0x120805, 0.92));
    crack.position.y = 0.03;
    const core = new THREE.Mesh(ribbon(r.points, hw * 0.16, 0.5, r.id + 90), basic(0xffb347, 0.8, true));
    core.position.y = 0.036;
    group.add(glow, crack, core);
    this.group.add(group);
    const samples: { x: number; z: number }[] = [];
    for (let i = 0; i + 1 < r.points.length; i++) {
      const a = r.points[i]!;
      const b = r.points[i + 1]!;
      const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.z - a.z) / 0.6));
      for (let k = 0; k < n; k++) samples.push({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n });
    }
    return { group, crack, glow, core, samples };
  }

  /** Burst along the whole crack when it erupts. */
  erupt(id: number): void {
    const v = this.rifts.get(id);
    if (!v) return;
    for (const s of v.samples) {
      this.particles.emit(s.x, 0.3, s.z, { n: 5, spd: 2.2, vy: 9, up: 1.5, col: LAVA_A, col2: LAVA_B, life: 0.7, size: 0.7, grav: 9, jit: 0.5 });
    }
  }

  update(state: MatchState, time: number, dt: number): void {
    const sd = state.suddenDeath;
    this.wall.visible = this.edge.visible = sd.active;
    if (sd.active) {
      const r = sd.zoneRadius;
      this.wall.scale.set(r, 1, r);
      this.wall.material.opacity = 0.2 + 0.07 * Math.sin(time * 4);
      this.edge.scale.set(r, 1, r);
      // Tint everything outside the safe zone. Rebuilt only when the radius has moved visibly.
      if (!this.outside || Math.abs(this.outsideRadius - r) > 0.04) {
        if (this.outside) discard(this.group, this.outside);
        this.outside = new THREE.Mesh(new THREE.RingGeometry(r, arena.radius + 0.2, 96).rotateX(-Math.PI / 2), basic(ZONE_COLOR, 0.2));
        this.outside.position.y = 0.045;
        this.group.add(this.outside);
        this.outsideRadius = r;
      }
      this.outside.material.opacity = 0.18 + 0.05 * Math.sin(time * 3);
    } else if (this.outside) {
      discard(this.group, this.outside);
      this.outside = null;
    }

    const seen = new Set<number>();
    for (const r of state.rifts) {
      seen.add(r.id);
      let v = this.rifts.get(r.id);
      if (!v) this.rifts.set(r.id, (v = this.makeRift(r)));
      const appear = Math.min(1, r.age / 0.5);
      const k = 1 - r.time / r.total;
      let glow = 0.1;
      let core = 0.35 + 0.1 * Math.sin(time * 3 + r.id);
      if (r.phase === "warn") {
        // Telegraph: the danger area brightens and flickers faster until it blows.
        glow = 0.18 + 0.45 * k + 0.12 * Math.sin(time * (10 + 30 * k));
        core = 0.6 + 0.4 * k;
        if (dt > 0) {
          for (let i = 0, n = Math.round(1 + 5 * k); i < n; i++) {
            const s = v.samples[Math.floor(Math.random() * v.samples.length)]!;
            this.particles.emit(s.x, 0.1, s.z, { spd: 0.6, vy: 1.2 + 2.5 * k, col: EMBER, col2: LAVA_B, life: 0.5, size: 0.3 + 0.2 * k, jit: 0.5 });
          }
        }
      } else if (r.phase === "erupt") {
        glow = 0.8 + 0.15 * Math.sin(time * 40);
        core = 1;
        if (dt > 0) {
          for (let i = 0; i < 10; i++) {
            const s = v.samples[Math.floor(Math.random() * v.samples.length)]!;
            this.particles.emit(s.x, 0.2, s.z, { n: 2, spd: 1.2, vy: 7, up: 1.2, col: LAVA_A, col2: LAVA_B, life: 0.6, size: 0.75, grav: 6, jit: 0.6 });
            this.particles.emit(s.x, 1.2, s.z, { spd: 0.8, vy: 4.5, col: STEAM_A, col2: LAVA_A, life: 0.5, size: 1.0, jit: 0.7, drag: 1 });
          }
        }
      }
      v.glow.material.opacity = glow * appear;
      v.glow.material.color.set(r.phase === "erupt" ? 0xffd27a : 0xff5a1f);
      v.core.material.opacity = core * appear;
      v.crack.material.opacity = 0.92 * appear;
    }
    for (const [id, v] of this.rifts) {
      if (seen.has(id)) continue;
      discard(this.group, v.group);
      this.rifts.delete(id);
    }
  }
}
