// Static arena: floor, rim, stands, pillars with braziers, plus the obstacles and the orb that the sim moves.

import * as THREE from "three";
import { arena } from "@smash/content";
import type { MatchState, Obstacle } from "@smash/sim";
import { G, GOLD, TAU, basic, canvasTexture, rand, rgb, std } from "./gfx.ts";
import type { Particles } from "./Particles.ts";

interface Fire {
  x: number;
  y: number;
  z: number;
  rate: number;
  size: number;
}

interface ObstacleView {
  group: THREE.Group;
  mat?: THREE.MeshStandardMaterial;
  rise: number;
  hit: number;
}

const FIRE_A = rgb("#ffb84d");
const FIRE_B = rgb("#bf1f05");
const WOOD_FRESH = new THREE.Color(0xffffff);
const WOOD_WORN = new THREE.Color(0x5a3a22);

function floorTexture(): THREE.CanvasTexture {
  return canvasTexture(1024, 1024, (g, S) => {
    const m = S / 2;
    const grd = g.createRadialGradient(m, m, 0, m, m, m);
    grd.addColorStop(0, "#c99a63");
    grd.addColorStop(0.65, "#b5834f");
    grd.addColorStop(1, "#8a5a30");
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
    const rings = [0.08, 0.15, 0.24, 0.35, 0.48, 0.62, 0.78, 0.95];
    g.lineWidth = 3;
    for (let i = 0; i < rings.length - 1; i++) {
      const n = 8 + i * 6;
      const r0 = rings[i]! * m;
      const r1 = rings[i + 1]! * m;
      const off = Math.random() * TAU;
      for (let k = 0; k < n; k++) {
        const a0 = off + (k / n) * TAU;
        const a1 = off + ((k + 1) / n) * TAU;
        g.beginPath();
        g.arc(m, m, r1, a0, a1);
        g.arc(m, m, r0, a1, a0, true);
        g.closePath();
        g.fillStyle = Math.random() < 0.5 ? `rgba(255,236,200,${rand(0.02, 0.08)})` : `rgba(80,44,18,${rand(0.03, 0.1)})`;
        g.fill();
        g.strokeStyle = "rgba(70,38,14,.45)";
        g.stroke();
      }
    }
    for (let i = 0; i < 11000; i++) {
      g.fillStyle = Math.random() < 0.5 ? "rgba(255,238,205,.08)" : "rgba(70,38,14,.1)";
      g.fillRect(Math.random() * S, Math.random() * S, 2, 2);
    }
    g.strokeStyle = "rgba(60,30,12,.6)";
    g.lineWidth = 16;
    g.beginPath();
    g.arc(m, m, m - 8, 0, TAU);
    g.stroke();
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
  private readonly fires: Fire[] = [];
  private readonly obstacles = new Map<number, ObstacleView>();
  private readonly orb = new THREE.Group();
  private readonly orbCrystal: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  private readonly orbLight = new THREE.PointLight(0xffcf6a, 0, 14, 1.6);
  private orbFlash = 0;

  constructor(state: MatchState, private readonly particles: Particles) {
    const R = arena.radius;
    const add = (m: THREE.Object3D) => this.group.add(m);

    const floor = new THREE.Mesh(new THREE.CircleGeometry(R + 0.2, 96), std(0xffffff, { map: floorTexture(), roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    add(floor);
    const outer = new THREE.Mesh(new THREE.RingGeometry(R, R + 7.6, 96), std(0x4a2f1f, { roughness: 1 }));
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.01;
    outer.receiveShadow = true;
    add(outer);

    const rim = new THREE.InstancedMesh(G.box, std(0x9a6a42, { roughness: 0.9 }), 72);
    const d = new THREE.Object3D();
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * TAU;
      const h = i % 2 ? 1.25 : 0.85;
      d.position.set(Math.cos(a) * (R + 0.5), h / 2, Math.sin(a) * (R + 0.5));
      d.rotation.set(0, -a - Math.PI / 2, 0);
      d.scale.set(1.72, h, 0.9);
      d.updateMatrix();
      rim.setMatrixAt(i, d.matrix);
    }
    rim.castShadow = rim.receiveShadow = true;
    add(rim);

    [0x5c3b26, 0x513421, 0x472d1c, 0x3d2717].forEach((col, i) => {
      const r = R + 7.6 + i * 3.2;
      const h = 1.4 + i * 1.5;
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 80, 1, true), std(col, { side: THREE.DoubleSide, roughness: 1 }));
      wall.position.y = h / 2;
      add(wall);
      const top = new THREE.Mesh(new THREE.RingGeometry(r, r + 3.2, 80), std(col, { roughness: 1 }));
      top.rotation.x = -Math.PI / 2;
      top.position.y = h;
      add(top);
    });

    const stone = std(0xb27c4b, { roughness: 0.85 });
    const dark = std(0x7a4f2e, { roughness: 0.9 });
    const metal = std(0x3a2b22, { roughness: 0.5, metalness: 0.6 });
    const coalMat = basic(0xff6a1c);
    const woodTex = canvasTexture(256, 128, (g, w, h) => {
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
    const crateTex = canvasTexture(128, 128, (g, w, h) => {
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

    for (const o of state.obstacles) {
      const g = new THREE.Group();
      const part = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.y = y;
        m.castShadow = m.receiveShadow = true;
        g.add(m);
        return m;
      };
      const view: ObstacleView = { group: g, rise: 0, hit: 0 };
      if (o.kind === "stone") {
        const k = o.radius / 1.3;
        part(new THREE.CylinderGeometry(1.65 * k, 1.75 * k, 0.45, 20), dark, 0.22);
        part(new THREE.CylinderGeometry(1.2 * k, 1.3 * k, 2.2, 20), stone, 1.55);
        part(new THREE.BoxGeometry(2.8 * k, 0.4, 2.8 * k), dark, 2.85);
        part(new THREE.CylinderGeometry(0.75 * k, 0.45 * k, 0.45, 14), metal, 3.27);
        const coal = new THREE.Mesh(G.circle, coalMat);
        coal.scale.setScalar(0.66 * k);
        coal.position.y = 3.52;
        g.add(coal);
        this.fires.push({ x: o.x, y: 3.55, z: o.z, rate: 34, size: 0.85 });
      } else if (o.kind === "wood") {
        const mat = std(0xffffff, { map: woodTex, roughness: 0.9 });
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
      } else {
        const c = part(G.box, std(0xffffff, { map: crateTex, roughness: 0.85 }), 0.525);
        c.scale.set(o.radius * 1.6, 1.05, o.radius * 1.6);
      }
      g.position.set(o.x, 0, o.z);
      add(g);
      this.obstacles.set(o.id, view);
    }

    for (let k = 0; k < 4; k++) {
      const a = TAU / 8 + (k * TAU) / 4;
      const x = Math.cos(a) * (R + 4);
      const z = Math.sin(a) * (R + 4);
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.65, 2.4, 12), dark);
      ped.position.set(x, 1.2, z);
      ped.castShadow = true;
      add(ped);
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.5, 0.5, 14), metal);
      bowl.position.set(x, 2.6, z);
      add(bowl);
      const coal = new THREE.Mesh(G.circle, coalMat);
      coal.scale.setScalar(0.8);
      coal.position.set(x, 2.87, z);
      add(coal);
      const light = new THREE.PointLight(0xff8a3a, 70, 26, 1.8);
      light.position.set(x, 3.6, z);
      add(light);
      this.fires.push({ x, y: 2.9, z, rate: 46, size: 1.1 });
    }

    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.2, 0.18, 24), std(0xa47148, { roughness: 0.8 }));
    pedestal.position.y = 0.09;
    pedestal.receiveShadow = true;
    add(pedestal);
    const pr = new THREE.Mesh(G.ring, basic(0xe0a640, 0.9));
    pr.scale.setScalar(0.85);
    pr.position.y = 0.19;
    add(pr);

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

  /** `pos` gives the interpolated position of a moving obstacle (crates). */
  update(state: MatchState, time: number, dt: number, pos: (o: Obstacle) => { x: number; z: number }): void {
    for (const f of this.fires) {
      const n = Math.floor(f.rate * dt + Math.random());
      if (n) this.particles.emit(f.x, f.y, f.z, { n, spd: 0.6, vy: 2.2, col: FIRE_A, col2: FIRE_B, life: 0.7, size: f.size, jit: 0.5, drag: 0.5 });
    }
    for (const o of state.obstacles) {
      const v = this.obstacles.get(o.id);
      if (!v) continue;
      if (o.kind === "wood") {
        v.group.visible = o.alive;
        if (!o.alive) continue;
        const k = Math.max(0, o.hp / o.maxHp);
        v.group.scale.y = 0.6 + 0.4 * k;
        v.mat?.color.copy(WOOD_FRESH).lerp(WOOD_WORN, 1 - k);
        v.rise = Math.max(0, v.rise - dt);
        v.hit = Math.max(0, v.hit - dt);
        const shake = v.hit > 0 ? 0.06 : 0;
        v.group.position.set(o.x + rand(-shake, shake), -1.4 * (v.rise / 0.45), o.z + rand(-shake, shake));
      } else if (o.kind === "crate") {
        const p = pos(o);
        v.group.position.set(p.x, 0, p.z);
        v.group.rotation.y = o.spin;
      }
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
