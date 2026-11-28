// The destructible floor and the wall around it, drawn from sim state: cracked tiles, tiles shaking before they drop,
// tiles tumbling into the abyss, wall sections wearing down and going. Driven by state rather than by events, so a
// rewind (kill cam) or a snapshot that skips ahead always ends up showing what the sim has.

import * as THREE from "three";
import { arena } from "@smash/content";
import { floorTiles, rimArc, type FloorTile, type MatchState } from "@smash/sim";
import { G, TAU, rand, std } from "./gfx.ts";

/** How thick the slabs are, and how far below the walking surface the rim's foundation goes. */
export const FLOOR_DEPTH = 0.6;
const TEXTURE_SIZE = 1024;
/** Arc segments are at most this wide, so tile edges follow the rings. */
const ARC_STEP = (6 * Math.PI) / 180;
const GRAVITY = 26;
/** Dropped tiles are removed once they are this deep: far out of sight. */
const GONE_BELOW = -70;
const RIM_BLOCKS = 2;
const RIM_FRESH = new THREE.Color(0xffffff);
const RIM_WORN = new THREE.Color(0x6b3a22);
const SIDE: [number, number, number] = [0.42, 0.34, 0.3];
const HOT = new THREE.Color(0xff5a1f);

/** What a tile looks like right now: 0–3 = standing, more cracked as health goes; then about to drop; then gone. */
const CRUMBLING = 4;
const GONE = 5;

/** Small deterministic hash so a tile's cracks are the same every time they are redrawn. */
const hash = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

interface Buffers {
  pos: number[];
  normal: number[];
  uv: number[];
  color: number[];
  index: number[];
}

/** Appends one tile (top, underside and the four sides) to the buffers. `ox, oz` are subtracted from positions. */
function addTile(b: Buffers, t: FloorTile, ox: number, oz: number): void {
  const R2 = arena.radius * 2;
  const vertex = (x: number, y: number, z: number, nx: number, ny: number, nz: number, c: readonly [number, number, number]): number => {
    b.pos.push(x - ox, y, z - oz);
    b.normal.push(nx, ny, nz);
    // The whole floor shares one texture, laid over the arena from above.
    b.uv.push(0.5 + x / R2, 0.5 + z / R2);
    b.color.push(c[0], c[1], c[2]);
    return b.pos.length / 3 - 1;
  };
  const quad = (a: number, c: number, d: number, e: number) => b.index.push(a, c, d, a, d, e);
  const steps = Math.max(1, Math.ceil(t.span / ARC_STEP));
  const top: [number, number, number] = [1, 1, 1];
  const disc = t.r0 === 0;
  for (let i = 0; i < steps; i++) {
    const a0 = t.a0 + (t.span * i) / steps;
    const a1 = t.a0 + (t.span * (i + 1)) / steps;
    const s0 = Math.sin(a0);
    const c0 = Math.cos(a0);
    const s1 = Math.sin(a1);
    const c1 = Math.cos(a1);
    for (const [y, ny] of [
      [0, 1],
      [-FLOOR_DEPTH, -1],
    ] as const) {
      const col = ny > 0 ? top : SIDE;
      const p = [
        vertex(s0 * t.r0, y, c0 * t.r0, 0, ny, 0, col),
        vertex(s0 * t.r1, y, c0 * t.r1, 0, ny, 0, col),
        vertex(s1 * t.r1, y, c1 * t.r1, 0, ny, 0, col),
        vertex(s1 * t.r0, y, c1 * t.r0, 0, ny, 0, col),
      ] as const;
      if (ny > 0) quad(p[0], p[1], p[2], p[3]);
      else quad(p[0], p[3], p[2], p[1]);
    }
    // Outer and inner faces of the ring.
    for (const [r, sign] of [
      [t.r1, 1],
      [t.r0, -1],
    ] as const) {
      if (r === 0) continue;
      const p = [
        vertex(s0 * r, 0, c0 * r, s0 * sign, 0, c0 * sign, SIDE),
        vertex(s0 * r, -FLOOR_DEPTH, c0 * r, s0 * sign, 0, c0 * sign, SIDE),
        vertex(s1 * r, -FLOOR_DEPTH, c1 * r, s1 * sign, 0, c1 * sign, SIDE),
        vertex(s1 * r, 0, c1 * r, s1 * sign, 0, c1 * sign, SIDE),
      ] as const;
      if (sign > 0) quad(p[0], p[1], p[2], p[3]);
      else quad(p[0], p[3], p[2], p[1]);
    }
  }
  if (disc) return;
  // The two straight ends.
  for (const [a, sign] of [
    [t.a0, -1],
    [t.a0 + t.span, 1],
  ] as const) {
    const s = Math.sin(a);
    const c = Math.cos(a);
    const nx = c * sign;
    const nz = -s * sign;
    const p = [
      vertex(s * t.r0, 0, c * t.r0, nx, 0, nz, SIDE),
      vertex(s * t.r0, -FLOOR_DEPTH, c * t.r0, nx, 0, nz, SIDE),
      vertex(s * t.r1, -FLOOR_DEPTH, c * t.r1, nx, 0, nz, SIDE),
      vertex(s * t.r1, 0, c * t.r1, nx, 0, nz, SIDE),
    ] as const;
    if (sign > 0) quad(p[0], p[3], p[2], p[1]);
    else quad(p[0], p[1], p[2], p[3]);
  }
}

function toGeometry(b: Buffers): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(b.normal, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(b.uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(b.color, 3));
  g.setIndex(b.index);
  return g;
}

const emptyBuffers = (): Buffers => ({ pos: [], normal: [], uv: [], color: [], index: [] });

/** Traces a tile's outline on the floor canvas. */
function tilePath(g: CanvasRenderingContext2D, t: FloorTile, k: number, m: number): void {
  g.beginPath();
  if (t.r0 === 0) {
    g.arc(m, m, t.r1 * k, 0, TAU);
    return;
  }
  // World angle a (0 = +z, toward +x) is canvas angle a − 90°: canvas y runs toward −z.
  const a0 = t.a0 - Math.PI / 2;
  const a1 = a0 + t.span;
  g.arc(m, m, t.r1 * k, a0, a1);
  g.arc(m, m, t.r0 * k, a1, a0, true);
  g.closePath();
}

/** The sandstone paving, one slab per tile, so the seams in the picture are where the floor comes apart. */
function paintBase(g: CanvasRenderingContext2D, S: number): void {
  const m = S / 2;
  const k = m / arena.radius;
  const grd = g.createRadialGradient(m, m, 0, m, m, m);
  grd.addColorStop(0, "#c99a63");
  grd.addColorStop(0.65, "#b5834f");
  grd.addColorStop(1, "#8a5a30");
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  g.lineWidth = 3;
  for (const t of floorTiles) {
    tilePath(g, t, k, m);
    g.fillStyle = Math.random() < 0.5 ? `rgba(255,236,200,${rand(0.02, 0.09)})` : `rgba(80,44,18,${rand(0.03, 0.11)})`;
    g.fill();
    g.strokeStyle = "rgba(60,32,12,.6)";
    g.stroke();
  }
  for (let i = 0; i < 11000; i++) {
    g.fillStyle = Math.random() < 0.5 ? "rgba(255,238,205,.08)" : "rgba(70,38,14,.1)";
    g.fillRect(Math.random() * S, Math.random() * S, 2, 2);
  }
}

/** Cracks over one tile: more and darker as `level` (1–3) goes up. */
function paintCracks(g: CanvasRenderingContext2D, t: FloorTile, index: number, level: number, k: number, m: number): void {
  g.save();
  tilePath(g, t, k, m);
  g.clip();
  g.fillStyle = `rgba(38,18,8,${0.1 + 0.11 * level})`;
  g.fill();
  const cx = m + t.x * k;
  const cz = m - t.z * k;
  const reach = Math.max(t.r1 - t.r0, t.r0 === 0 ? t.r1 : ((t.r0 + t.r1) / 2) * t.span) * k;
  const lines = 2 + level * 2;
  g.lineCap = "round";
  g.lineJoin = "round";
  for (let i = 0; i < lines; i++) {
    let a = hash(index * 13 + i) * TAU;
    let x = cx + (hash(index * 7 + i * 3) - 0.5) * reach * 0.3;
    let z = cz + (hash(index * 5 + i * 11) - 0.5) * reach * 0.3;
    g.beginPath();
    g.moveTo(x, z);
    for (let s = 0; s < 5; s++) {
      a += (hash(index * 17 + i * 29 + s) - 0.5) * 1.5;
      x += Math.cos(a) * reach * 0.22;
      z += Math.sin(a) * reach * 0.22;
      g.lineTo(x, z);
    }
    g.strokeStyle = "rgba(20,8,3,.9)";
    g.lineWidth = 1.5 + level * 0.9;
    g.stroke();
    if (level >= 3) {
      // About to give: the abyss glows through.
      g.strokeStyle = "rgba(255,120,40,.5)";
      g.lineWidth = 1.2;
      g.stroke();
    }
  }
  g.restore();
}

interface LooseTile {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  falling: boolean;
  vy: number;
  spin: THREE.Vector3;
}

export class Floor {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private readonly material: THREE.MeshStandardMaterial;
  private readonly texture: THREE.CanvasTexture;
  private readonly canvas: HTMLCanvasElement;
  private readonly base: HTMLCanvasElement;
  /** Vertex range of each tile in the merged mesh, and the positions to put back when it stands again. */
  private readonly ranges: { start: number; count: number }[] = [];
  private readonly home: Float32Array;
  /** What each tile is drawn as (0–3 cracks, CRUMBLING, GONE). */
  private readonly shown: number[] = floorTiles.map(() => 0);
  private readonly loose = new Map<number, LooseTile>();
  private readonly rim: THREE.InstancedMesh;
  private readonly rimShown: number[] = [];
  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();

  constructor() {
    const b = emptyBuffers();
    for (const t of floorTiles) {
      const start = b.pos.length / 3;
      addTile(b, t, 0, 0);
      this.ranges.push({ start, count: b.pos.length / 3 - start });
    }
    const geometry = toGeometry(b);
    this.home = Float32Array.from(b.pos);

    const make = () => {
      const c = document.createElement("canvas");
      c.width = c.height = TEXTURE_SIZE;
      return c;
    };
    this.base = make();
    paintBase(this.base.getContext("2d")!, TEXTURE_SIZE);
    this.canvas = make();
    this.canvas.getContext("2d")!.drawImage(this.base, 0, 0);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.material = std(0xffffff, { map: this.texture, roughness: 0.95, vertexColors: true });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.receiveShadow = true;
    this.group.add(this.mesh);

    // The wall: two blocks per section, standing on a foundation that hangs on the side of the outer tiles.
    const n = arena.rim.segments * RIM_BLOCKS;
    this.rim = new THREE.InstancedMesh(G.box, std(0x9a6a42, { roughness: 0.9 }), n);
    this.rim.castShadow = this.rim.receiveShadow = true;
    for (let s = 0; s < arena.rim.segments; s++) {
      this.rimShown.push(-1);
      for (let k = 0; k < RIM_BLOCKS; k++) this.rim.setColorAt(s * RIM_BLOCKS + k, RIM_FRESH);
    }
    this.group.add(this.rim);
  }

  /** Top of wall block `k` of a section, for effects. */
  static rimBlock(segment: number, k: number): { x: number; z: number; angle: number; height: number } {
    const { a0, span } = rimArc(segment);
    const angle = a0 + (span * (k + 0.5)) / RIM_BLOCKS;
    const r = arena.radius + 0.45;
    return { x: Math.sin(angle) * r, z: Math.cos(angle) * r, angle, height: (segment * RIM_BLOCKS + k) % 2 ? 1.25 : 0.85 };
  }

  private setRim(segment: number, hp: number): void {
    const worn = 1 - hp / arena.rim.hp;
    for (let k = 0; k < RIM_BLOCKS; k++) {
      const i = segment * RIM_BLOCKS + k;
      const blk = Floor.rimBlock(segment, k);
      // A worn section sags and darkens; a broken one is gone.
      const h = blk.height * (1 - 0.3 * worn);
      const d = this.dummy;
      d.position.set(blk.x, (h - FLOOR_DEPTH) / 2, blk.z);
      d.rotation.set(0, blk.angle, 0);
      const w = (TAU * (arena.radius + 0.45)) / (arena.rim.segments * RIM_BLOCKS);
      d.scale.set(hp > 0 ? w * 1.02 : 0, hp > 0 ? h + FLOOR_DEPTH : 0, hp > 0 ? 0.9 : 0);
      d.updateMatrix();
      this.rim.setMatrixAt(i, d.matrix);
      this.rim.setColorAt(i, this.color.copy(RIM_FRESH).lerp(RIM_WORN, worn));
    }
    this.rim.instanceMatrix.needsUpdate = true;
    if (this.rim.instanceColor) this.rim.instanceColor.needsUpdate = true;
  }

  /** Shows or hides a tile in the merged mesh (a hidden tile is collapsed to a point). */
  private setStanding(tile: number, standing: boolean): void {
    const { start, count } = this.ranges[tile]!;
    const pos = this.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = start * 3; i < (start + count) * 3; i++) arr[i] = standing ? this.home[i]! : 0;
    pos.needsUpdate = true;
  }

  private addLoose(tile: number): LooseTile {
    const t = floorTiles[tile]!;
    const b = emptyBuffers();
    addTile(b, t, t.x, t.z);
    const material = this.material.clone();
    material.emissive = HOT.clone();
    material.emissiveIntensity = 0;
    const mesh = new THREE.Mesh(toGeometry(b), material);
    mesh.position.set(t.x, 0, t.z);
    this.group.add(mesh);
    const loose: LooseTile = { mesh, falling: false, vy: 0, spin: new THREE.Vector3() };
    this.loose.set(tile, loose);
    return loose;
  }

  private removeLoose(tile: number): void {
    const l = this.loose.get(tile);
    if (!l) return;
    this.group.remove(l.mesh);
    l.mesh.geometry.dispose();
    l.mesh.material.dispose();
    this.loose.delete(tile);
  }

  private repaint(): void {
    const g = this.canvas.getContext("2d")!;
    g.drawImage(this.base, 0, 0);
    const m = TEXTURE_SIZE / 2;
    const k = m / arena.radius;
    this.shown.forEach((level, i) => {
      // A tile on its way out wears the heaviest cracks.
      const cracks = level >= CRUMBLING ? 3 : level;
      if (cracks > 0) paintCracks(g, floorTiles[i]!, i, cracks, k, m);
    });
    this.texture.needsUpdate = true;
  }

  update(state: MatchState, time: number, dt: number): void {
    const { hp, crumbling } = state.floor;
    const left = new Map<number, number>();
    for (const c of crumbling) left.set(c.tile, c.time);
    let dirty = false;
    for (let i = 0; i < floorTiles.length; i++) {
      const h = hp[i]!;
      const want = h > 0 ? Math.min(3, Math.floor((1 - h / arena.floor.hp) * 3 + 0.999)) : left.has(i) ? CRUMBLING : GONE;
      const was = this.shown[i]!;
      if (want === was) continue;
      this.shown[i] = want;
      dirty = true;
      if (want < CRUMBLING) {
        // Standing (again): back into the merged mesh.
        if (was >= CRUMBLING) {
          this.setStanding(i, true);
          this.removeLoose(i);
        }
        continue;
      }
      if (was < CRUMBLING) this.setStanding(i, false);
      const loose = this.loose.get(i) ?? this.addLoose(i);
      loose.falling = want === GONE;
      if (loose.falling) {
        loose.vy = rand(-1.5, 0);
        loose.spin.set(rand(-1.6, 1.6), rand(-0.6, 0.6), rand(-1.6, 1.6));
      } else {
        // Rewound to before the drop: back in place, shaking.
        loose.mesh.position.y = 0;
        loose.mesh.rotation.set(0, 0, 0);
      }
    }
    if (dirty) this.repaint();

    for (const [tile, l] of this.loose) {
      const t = floorTiles[tile]!;
      if (l.falling) {
        l.vy -= GRAVITY * dt;
        l.mesh.position.y += l.vy * dt;
        l.mesh.rotation.x += l.spin.x * dt;
        l.mesh.rotation.y += l.spin.y * dt;
        l.mesh.rotation.z += l.spin.z * dt;
        l.mesh.material.emissiveIntensity = Math.max(0, l.mesh.material.emissiveIntensity - dt * 2);
        if (l.mesh.position.y < GONE_BELOW) this.removeLoose(tile);
        continue;
      }
      // The telegraph: the tile sags, shakes and flashes faster and brighter until it goes.
      const k = 1 - Math.min(1, (left.get(tile) ?? 0) / arena.floor.crumbleTime);
      const shake = dt > 0 ? 0.02 + 0.05 * k : 0;
      l.mesh.position.set(t.x + rand(-shake, shake), -0.05 - 0.12 * k, t.z + rand(-shake, shake));
      l.mesh.material.emissiveIntensity = 0.35 + 0.7 * k + (0.3 + 0.3 * k) * Math.sin(time * (10 + 26 * k));
    }

    for (let s = 0; s < state.rim.length; s++) {
      const h = state.rim[s]!;
      if (this.rimShown[s] === h) continue;
      this.rimShown[s] = h;
      this.setRim(s, h);
    }
  }
}
