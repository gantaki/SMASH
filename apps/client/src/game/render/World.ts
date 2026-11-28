// The arena: a slab floor over an abyss (Floor.ts draws the tiles and the wall), the stands across the chasm,
// pillars with braziers, plus the obstacles and the orb that the sim moves.

import * as THREE from "three";
import { arena } from "@smash/content";
import { tileSolid, type MatchState, type Obstacle } from "@smash/sim";
import { FLOOR_DEPTH, Floor } from "./Floor.ts";
import { G, GOLD, TAU, basic, canvasTexture, discard, keep, rand, rgb, std } from "./gfx.ts";
import type { Particles } from "./Particles.ts";

interface Fire {
  x: number;
  y: number;
  z: number;
  rate: number;
  size: number;
  /** Burns only while this obstacle stands (a pillar's brazier). */
  obstacle?: number;
}

interface ObstacleView {
  group: THREE.Group;
  /** Tinted as the obstacle loses health. */
  mat?: THREE.MeshStandardMaterial;
  rise: number;
  hit: number;
  /** Seconds since it started dropping into the abyss, or -1. */
  fall: number;
  tilt: { x: number; z: number };
}

const FIRE_A = rgb("#ffb84d");
const FIRE_B = rgb("#bf1f05");
const WOOD_FRESH = new THREE.Color(0xffffff);
const WOOD_WORN = new THREE.Color(0x5a3a22);
const STONE_FRESH = new THREE.Color(0xb27c4b);
const STONE_WORN = new THREE.Color(0x4f3220);
const WALL_FRESH = new THREE.Color(0x9aa38a);
const WALL_WORN = new THREE.Color(0x4a4a3c);
const WALL_HEIGHT = 1.7;
/** Seconds a raised wall takes to come up out of the floor. */
const WALL_RISE = 0.2;
/** How high a held crate floats over its holder's head. */
const HELD_HEIGHT = 2.9;
/** How deep the abyss is drawn, and how an obstacle drops into it. */
const ABYSS_DEPTH = 70;
const FALL_GRAVITY = 26;
const FALL_GONE = 2.4;
/** Distance from the arena to the stands: the width of the chasm. */
const CHASM = 7.6;

/** Rock wall of the abyss: dark at the top, lit from far below. */
function abyssWallTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 512, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, "#1b110b");
    grd.addColorStop(0.6, "#150906");
    grd.addColorStop(0.88, "#34100a");
    grd.addColorStop(1, "#6e260c");
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      g.fillStyle = Math.random() < 0.5 ? "rgba(0,0,0,.18)" : "rgba(255,170,110,.05)";
      g.fillRect(Math.random() * w, Math.random() * h, rand(2, 7), rand(10, 60));
    }
  });
}

/** What is at the bottom: a dark crust with glowing veins. */
function abyssFloorTexture(): THREE.CanvasTexture {
  return canvasTexture(512, 512, (g, S) => {
    const m = S / 2;
    const grd = g.createRadialGradient(m, m, 0, m, m, m);
    grd.addColorStop(0, "#8a3410");
    grd.addColorStop(0.5, "#551a08");
    grd.addColorStop(1, "#260a04");
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
    for (let i = 0; i < 70; i++) {
      g.fillStyle = `rgba(20,6,3,${rand(0.35, 0.7)})`;
      g.beginPath();
      g.ellipse(Math.random() * S, Math.random() * S, rand(14, 60), rand(10, 40), Math.random() * TAU, 0, TAU);
      g.fill();
    }
  });
}

function planks(g: CanvasRenderingContext2D, w: number, h: number, n: number, base: string): void {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const x = (i * w) / n;
    g.fillStyle = `rgba(${i % 2 ? 40 : 255},${i % 2 ? 22 : 220},${i % 2 ? 8 : 170},${rand(0.04, 0.1)})`;
    g.fillRect(x, 0, w / n, h);
    g.strokeStyle = "rgba(60,32,12,.25)";
    g.lineWidth = 1;
    for (let k = 0; k < 5; k++) {
      g.beginPath();
      const gx = x + rand(3, w / n - 3);
      g.moveTo(gx, 0);
      g.bezierCurveTo(gx + rand(-4, 4), h * 0.3, gx + rand(-4, 4), h * 0.7, gx + rand(-3, 3), h);
      g.stroke();
    }
    g.fillStyle = "rgba(40,20,6,.85)";
    g.fillRect(x, 0, 2, h);
  }
}

export class World {
  readonly group = new THREE.Group();
  private readonly floor = new Floor();
  private readonly fires: Fire[] = [];
  private readonly obstacles = new Map<number, ObstacleView>();
  private readonly dark = keep(std(0x7a4f2e, { roughness: 0.9 }));
  private readonly metal = keep(std(0x3a2b22, { roughness: 0.5, metalness: 0.6 }));
  private readonly coalMat = keep(basic(0xff6a1c));
  private woodTex!: THREE.CanvasTexture;
  private crateTex!: THREE.CanvasTexture;
  private readonly orb = new THREE.Group();
  private readonly orbCrystal: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private readonly orbLight = new THREE.PointLight(0xffcf6a, 0, 14, 1.6);
  private readonly pedestal = new THREE.Group();
  private orbFlash = 0;

  constructor(state: MatchState, private readonly particles: Particles) {
    const R = arena.radius;
    const add = (m: THREE.Object3D) => this.group.add(m);

    add(this.floor.group);

    // The abyss. The arena is the top of a hollow shaft: through a hole you look down into it, from outside it is
    // a column of rock. Across the chasm the stands rise from a cliff. Unlit and unfogged, so the glow far below shows.
    const rock = (side: THREE.Side) => new THREE.MeshBasicMaterial({ map: abyssWallTexture(), side, fog: false });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(R - 0.1, R * 0.82, ABYSS_DEPTH, 72, 1, true), rock(THREE.DoubleSide));
    shaft.position.y = -FLOOR_DEPTH - ABYSS_DEPTH / 2;
    add(shaft);
    const cliff = new THREE.Mesh(new THREE.CylinderGeometry(R + CHASM, R + CHASM, ABYSS_DEPTH, 80, 1, true), rock(THREE.BackSide));
    cliff.position.y = -ABYSS_DEPTH / 2;
    add(cliff);
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(R + CHASM, 64), new THREE.MeshBasicMaterial({ map: abyssFloorTexture(), fog: false }));
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.y = -ABYSS_DEPTH;
    add(bottom);

    [0x5c3b26, 0x513421, 0x472d1c, 0x3d2717].forEach((col, i) => {
      const r = R + CHASM + i * 3.2;
      const h = 1.4 + i * 1.5;
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 80, 1, true), std(col, { side: THREE.DoubleSide, roughness: 1 }));
      wall.position.y = h / 2;
      add(wall);
      const top = new THREE.Mesh(new THREE.RingGeometry(r, r + 3.2, 80), std(col, { roughness: 1 }));
      top.rotation.x = -Math.PI / 2;
      top.position.y = h;
      add(top);
    });

    const { dark, metal, coalMat } = this;
    this.woodTex = canvasTexture(256, 128, (g, w, h) => {
      planks(g, w, h, 6, "#8b5a2c");
      g.fillStyle = "#3b2a1c";
      for (const y of [h * 0.22, h * 0.78]) {
        for (let i = 0; i < 6; i++) {
          g.beginPath();
          g.arc(((i + 0.5) * w) / 6, y, 2.5, 0, TAU);
          g.fill();
        }
      }
    });
    this.crateTex = canvasTexture(128, 128, (g, w, h) => {
      planks(g, w, h, 4, "#9a6534");
      g.strokeStyle = "#4a3020";
      g.lineWidth = 12;
      g.strokeRect(6, 6, w - 12, h - 12);
      g.lineWidth = 10;
      g.beginPath();
      g.moveTo(10, h - 10);
      g.lineTo(w - 10, 10);
      g.stroke();
    });

    for (const o of state.obstacles) this.addObstacle(o);

    for (let k = 0; k < 4; k++) {
      const a = TAU / 8 + (k * TAU) / 4;
      // On the first tier of the stands, across the chasm.
      const x = Math.cos(a) * (R + CHASM + 1.2);
      const z = Math.sin(a) * (R + CHASM + 1.2);
      const y = 1.4;
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.65, 2.4, 12), dark);
      ped.position.set(x, y + 1.2, z);
      ped.castShadow = true;
      add(ped);
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.5, 0.5, 14), metal);
      bowl.position.set(x, y + 2.6, z);
      add(bowl);
      const coal = new THREE.Mesh(G.circle, coalMat);
      coal.scale.setScalar(0.8);
      coal.position.set(x, y + 2.87, z);
      add(coal);
      const light = new THREE.PointLight(0xff8a3a, 120, 34, 1.8);
      light.position.set(x, y + 3.6, z);
      add(light);
      this.fires.push({ x, y: y + 2.9, z, rate: 46, size: 1.1 });
    }

    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.2, 0.18, 24), std(0xa47148, { roughness: 0.8 }));
    pedestal.position.y = 0.09;
    pedestal.receiveShadow = true;
    const pr = new THREE.Mesh(G.ring, basic(0xe0a640, 0.9));
    pr.scale.setScalar(0.85);
    pr.position.y = 0.19;
    this.pedestal.add(pedestal, pr);
    add(this.pedestal);

    this.orbCrystal = new THREE.Mesh(G.oct, std(0xffd36b, { emissive: 0xffb020, emissiveIntensity: 1.2, roughness: 0.25, metalness: 0.2 }));
    this.orbCrystal.scale.set(0.6, 0.85, 0.6);
    this.orbCrystal.castShadow = true;
    const halo = new THREE.Mesh(G.sphere, basic(0xffc34a, 0.25, true));
    halo.scale.setScalar(1.15);
    this.orb.add(this.orbCrystal, halo);
    this.orb.position.set(0, 1.3, 0);
    this.orb.visible = false;
    add(this.orb);
    this.orbLight.position.set(0, 1.8, 0);
    add(this.orbLight);
  }

  /** Builds the model of an obstacle: the arena's own at the start, a raised wall when it appears. */
  private addObstacle(o: Obstacle): ObstacleView {
    const { dark, metal, coalMat } = this;
    const g = new THREE.Group();
    const part = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.y = y;
      m.castShadow = m.receiveShadow = true;
      g.add(m);
      return m;
    };
    const view: ObstacleView = { group: g, rise: 0, hit: 0, fall: -1, tilt: { x: rand(-0.5, 0.5), z: rand(-0.5, 0.5) } };
    if (o.kind === "stone") {
      const k = o.radius / 1.3;
      const stone = std(STONE_FRESH, { roughness: 0.85 });
      view.mat = stone;
      part(new THREE.CylinderGeometry(1.65 * k, 1.75 * k, 0.45, 20), dark, 0.22);
      part(new THREE.CylinderGeometry(1.2 * k, 1.3 * k, 2.2, 20), stone, 1.55);
      part(new THREE.BoxGeometry(2.8 * k, 0.4, 2.8 * k), dark, 2.85);
      part(new THREE.CylinderGeometry(0.75 * k, 0.45 * k, 0.45, 14), metal, 3.27);
      const coal = new THREE.Mesh(G.circle, coalMat);
      coal.scale.setScalar(0.66 * k);
      coal.position.y = 3.52;
      g.add(coal);
      this.fires.push({ x: o.x, y: 3.55, z: o.z, rate: 34, size: 0.85, obstacle: o.id });
    } else if (o.kind === "wood") {
      const mat = std(0xffffff, { map: this.woodTex, roughness: 0.9 });
      const wall = part(G.box, mat, 0.65);
      wall.scale.set(o.halfWidth * 2, 1.3, o.halfDepth * 2);
      for (const sx of [-1, 1]) {
        const post = part(G.box, dark, 0.78);
        post.scale.set(0.32, 1.55, o.halfDepth * 2 + 0.16);
        post.position.x = sx * (o.halfWidth - 0.1);
      }
      const beam = part(G.box, dark, 1.0);
      beam.scale.set(o.halfWidth * 2, 0.16, o.halfDepth * 2 + 0.08);
      g.rotation.y = -o.rot;
      view.mat = mat;
    } else if (o.kind === "wall") {
      // A slab of rough stone pushed up out of the floor: three blocks of uneven height.
      const mat = std(WALL_FRESH, { roughness: 0.95 });
      const n = 3;
      for (let i = 0; i < n; i++) {
        const h = WALL_HEIGHT * (i === 1 ? 1 : 0.86);
        const block = part(G.box, mat, h / 2);
        block.scale.set((o.halfWidth * 2) / n + 0.02, h, o.halfDepth * 2 + (i === 1 ? 0.1 : 0));
        block.position.x = (i - (n - 1) / 2) * ((o.halfWidth * 2) / n);
      }
      g.rotation.y = -o.rot;
      view.mat = mat;
      view.rise = WALL_RISE;
    } else {
      const mat = std(0xffffff, { map: this.crateTex, roughness: 0.85 });
      const c = part(G.box, mat, 0.525);
      c.scale.set(o.radius * 1.6, 1.05, o.radius * 1.6);
      view.mat = mat;
    }
    g.position.set(o.x, 0, o.z);
    this.group.add(g);
    this.obstacles.set(o.id, view);
    return view;
  }

  obstacleHit(id: number): void {
    const v = this.obstacles.get(id);
    if (v) v.hit = 0.15;
  }

  obstacleRebuilt(id: number): void {
    const v = this.obstacles.get(id);
    if (v) v.rise = 0.45;
  }

  flashOrb(): void {
    this.orbFlash = 0.12;
  }

  /** `pos` gives the interpolated position of anything that moves (crates, and the unit that holds one). */
  update(state: MatchState, time: number, dt: number, pos: (o: { id: number; x: number; z: number }) => { x: number; z: number }): void {
    this.floor.update(state, time, dt);
    // The orb hovers; its pedestal goes with the slab it stands on.
    this.pedestal.visible = tileSolid(state, 0);
    const standing = new Set(state.obstacles.filter((o) => o.alive).map((o) => o.id));
    for (const f of this.fires) {
      if (f.obstacle !== undefined && !standing.has(f.obstacle)) continue;
      const n = Math.floor(f.rate * dt + Math.random());
      if (n) this.particles.emit(f.x, f.y, f.z, { n, spd: 0.6, vy: 2.2, col: FIRE_A, col2: FIRE_B, life: 0.7, size: f.size, jit: 0.5, drag: 0.5 });
    }
    const present = new Set<number>();
    for (const o of state.obstacles) {
      present.add(o.id);
      // A wall raised since the last frame gets its model now.
      const v = this.obstacles.get(o.id) ?? this.addObstacle(o);
      if (o.fallen) {
        // Dropped with the floor under it: it tips over and goes down. (A wall that was already broken has nothing to drop.)
        if (v.fall < 0 && v.group.visible) v.fall = 0;
        if (v.fall < 0 || v.fall > FALL_GONE) {
          v.group.visible = false;
          continue;
        }
        v.fall += dt;
        v.group.position.y = -0.5 * FALL_GRAVITY * v.fall * v.fall;
        v.group.rotation.x = v.tilt.x * v.fall;
        v.group.rotation.z = v.tilt.z * v.fall;
        continue;
      }
      if (v.fall >= 0) {
        // Standing again (next round, kill cam rewind).
        v.fall = -1;
        v.group.rotation.x = v.group.rotation.z = 0;
        v.group.position.y = 0;
      }
      const k = Math.max(0, o.hp / o.maxHp);
      v.hit = Math.max(0, v.hit - dt);
      if (o.kind === "crate") {
        // Held overhead by a champion, or on the floor.
        const holder = o.heldBy >= 0 ? state.units.find((u) => u.id === o.heldBy) : undefined;
        v.group.visible = o.alive || !!holder;
        if (!v.group.visible) continue;
        const p = holder ? pos(holder) : pos(o);
        v.group.position.set(p.x, holder ? HELD_HEIGHT + Math.sin(time * 5) * 0.08 : 0, p.z);
        v.group.rotation.y = o.spin + (holder ? time * 1.5 : 0);
        v.mat?.color.copy(WOOD_FRESH).lerp(WOOD_WORN, (1 - k) * 0.8);
        continue;
      }
      v.group.visible = o.alive;
      if (!o.alive) continue;
      const wood = o.kind === "wood";
      if (wood) v.group.scale.y = 0.6 + 0.4 * k;
      if (o.kind === "wall") v.mat?.color.copy(WALL_FRESH).lerp(WALL_WORN, 1 - k);
      else v.mat?.color.copy(wood ? WOOD_FRESH : STONE_FRESH).lerp(wood ? WOOD_WORN : STONE_WORN, 1 - k);
      v.rise = Math.max(0, v.rise - dt);
      const shake = v.hit > 0 && dt > 0 ? (wood ? 0.06 : 0.035) : 0;
      // Rebuilt wood walls and raised stone walls come up out of the floor.
      const sunk = o.kind === "wall" ? WALL_HEIGHT * (v.rise / WALL_RISE) : 1.4 * (v.rise / 0.45);
      v.group.position.set(o.x + rand(-shake, shake), -sunk, o.z + rand(-shake, shake));
    }
    // Walls that are gone (time up, broken, burst) take their models with them.
    for (const [id, v] of this.obstacles) {
      if (present.has(id)) continue;
      discard(this.group, v.group);
      this.obstacles.delete(id);
    }
    const orb = state.orb;
    this.orb.visible = orb.alive;
    this.orbFlash = Math.max(0, this.orbFlash - dt);
    if (orb.alive) {
      this.orb.rotation.y += dt * 1.3;
      this.orb.position.y = 1.3 + Math.sin(time * 2) * 0.15;
      this.orbLight.intensity = 60 + Math.sin(time * 5) * 10;
      this.orbCrystal.material.emissiveIntensity = 1.2 + this.orbFlash * 12;
      if (Math.random() < dt * 10) {
        this.particles.emit(rand(-0.6, 0.6), rand(0.8, 1.8), rand(-0.6, 0.6), { spd: 0.3, vy: 0.8, col: rgb(GOLD), col2: rgb("#cc8a10"), life: 0.6, size: 0.22 });
      }
    } else this.orbLight.intensity = 0;
  }
}
