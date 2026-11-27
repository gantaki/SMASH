// One GPU point cloud for every particle in the game. Purely cosmetic, so Math.random is fine here.

import * as THREE from "three";
import { TAU, type RGB } from "./gfx.ts";

export interface EmitOptions {
  n?: number;
  /** Speed of the random horizontal spread. */
  spd?: number;
  /** Random position jitter. */
  jit?: number;
  /** Constant upward velocity. */
  vy?: number;
  /** Random upward velocity, as a factor of spd. */
  up?: number;
  life?: number;
  size?: number;
  /** Size at the end of life (default 0). */
  size1?: number;
  grav?: number;
  drag?: number;
  col: RGB;
  col2?: RGB;
  /** Directional emission: unit vector and how much of the random spread to keep. */
  dx?: number;
  dz?: number;
  cone?: number;
}

interface Particle {
  life: number;
  max: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  s0: number;
  s1: number;
  g: number;
  dr: number;
  c: RGB;
  c2: RGB;
}

const MAX = 3600;

export class Particles {
  readonly points: THREE.Points;
  private readonly pos = new Float32Array(MAX * 3);
  private readonly col = new Float32Array(MAX * 3);
  private readonly size = new Float32Array(MAX);
  private readonly alpha = new Float32Array(MAX);
  private readonly list: Particle[] = [];
  private readonly geo = new THREE.BufferGeometry();
  private readonly mat: THREE.ShaderMaterial;
  private next = 0;

  constructor() {
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute("pcolor", new THREE.BufferAttribute(this.col, 3));
    this.geo.setAttribute("size", new THREE.BufferAttribute(this.size, 1));
    this.geo.setAttribute("alpha", new THREE.BufferAttribute(this.alpha, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { scale: { value: 800 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 pcolor; uniform float scale;
        varying float vA; varying vec3 vC;
        void main(){ vA = alpha; vC = pcolor; vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; varying vec3 vC;
        void main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float a = clamp(1.0 - r, 0.0, 1.0); a *= a;
          if (a * vA < 0.003) discard; gl_FragColor = vec4(vC, a * vA);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    const blank: RGB = [0, 0, 0];
    for (let i = 0; i < MAX; i++) {
      this.list.push({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, s0: 0, s1: 0, g: 0, dr: 0, c: blank, c2: blank });
    }
  }

  /** Keeps particle size constant in world units: call on resize. */
  setViewport(heightPx: number, fovDeg: number): void {
    this.mat.uniforms.scale!.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  emit(x: number, y: number, z: number, o: EmitOptions): void {
    const n = o.n ?? 1;
    for (let i = 0; i < n; i++) {
      const p = this.list[this.next]!;
      this.next = (this.next + 1) % MAX;
      const a = Math.random() * TAU;
      const s = (o.spd ?? 0) * (0.35 + Math.random() * 0.65);
      const j = o.jit ?? 0;
      let vx = Math.cos(a) * s;
      let vz = Math.sin(a) * s;
      if (o.dx !== undefined && o.dz !== undefined) {
        const k = o.cone ?? 0.3;
        vx = vx * k + o.dx * s;
        vz = vz * k + o.dz * s;
      }
      p.x = x + (Math.random() - 0.5) * j;
      p.y = y + (Math.random() - 0.5) * j * 0.5;
      p.z = z + (Math.random() - 0.5) * j;
      p.vx = vx;
      p.vz = vz;
      p.vy = (o.vy ?? 0) + (o.up ?? 0) * s * Math.random();
      p.max = p.life = (o.life ?? 0.5) * (0.6 + Math.random() * 0.7);
      p.s0 = (o.size ?? 0.4) * (0.7 + Math.random() * 0.6);
      p.s1 = o.size1 ?? 0;
      p.g = o.grav ?? 0;
      p.dr = o.drag ?? 0;
      p.c = o.col;
      p.c2 = o.col2 ?? o.col;
    }
  }

  update(dt: number): void {
    const { pos, col, size, alpha } = this;
    for (let i = 0; i < MAX; i++) {
      const p = this.list[i]!;
      if (p.life <= 0) {
        size[i] = 0;
        alpha[i] = 0;
        continue;
      }
      p.life -= dt;
      const k = Math.max(0, p.life / p.max);
      const t = 1 - k;
      const dr = Math.max(0, 1 - p.dr * dt);
      p.vx *= dr;
      p.vy *= dr;
      p.vz *= dr;
      p.vy -= p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.03) {
        p.y = 0.03;
        p.vy *= -0.3;
      }
      pos[i * 3] = p.x;
      pos[i * 3 + 1] = p.y;
      pos[i * 3 + 2] = p.z;
      col[i * 3] = p.c[0] + (p.c2[0] - p.c[0]) * t;
      col[i * 3 + 1] = p.c[1] + (p.c2[1] - p.c[1]) * t;
      col[i * 3 + 2] = p.c[2] + (p.c2[2] - p.c[2]) * t;
      size[i] = p.s1 + (p.s0 - p.s1) * k;
      alpha[i] = Math.min(1, k * 1.8);
    }
    for (const name of ["position", "pcolor", "size", "alpha"]) this.geo.attributes[name]!.needsUpdate = true;
  }

  clear(): void {
    for (const p of this.list) p.life = 0;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
