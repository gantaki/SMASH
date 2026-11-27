// Shared geometries, materials and small helpers for the renderer.

import * as THREE from "three";

export const TAU = Math.PI * 2;
export const ALLY = 0x39d0ff;
export const FOE = 0xff4d3d;
export const GOLD = 0xffc93c;

export type RGB = [number, number, number];

/** Linear-space RGB triple for the particle shader. */
export const rgb = (c: THREE.ColorRepresentation): RGB => {
  const k = new THREE.Color(c);
  return [k.r, k.g, k.b];
};

export function basic(color: THREE.ColorRepresentation, opacity = 1, additive = false): THREE.MeshBasicMaterial {
  const translucent = opacity < 1 || additive;
  return new THREE.MeshBasicMaterial({
    color,
    transparent: translucent,
    opacity,
    depthWrite: !translucent,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
    fog: !additive,
  });
}

export function std(color: THREE.ColorRepresentation, opts: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...opts });
}

const flat = <T extends THREE.BufferGeometry>(g: T): T => {
  g.rotateX(-Math.PI / 2);
  return g;
};

const arrowShape = new THREE.Shape();
arrowShape.moveTo(0, -1.32);
arrowShape.lineTo(-0.24, -1.02);
arrowShape.lineTo(0.24, -1.02);
arrowShape.closePath();

/** Unit-sized geometries; ground shapes lie in the XZ plane. Never dispose these. */
export const G = {
  sphere: new THREE.SphereGeometry(1, 18, 12),
  box: new THREE.BoxGeometry(1, 1, 1),
  oct: new THREE.OctahedronGeometry(1, 0),
  circle: flat(new THREE.CircleGeometry(1, 56)),
  /** Thin ring, inner radius 0.9. */
  ring: flat(new THREE.RingGeometry(0.9, 1, 72)),
  /** Thick ring, inner radius 0.78. */
  band: flat(new THREE.RingGeometry(0.78, 1, 72)),
  /** Unit quad from z = 0 to z = 1, centred on x: scale to (width, 1, length). */
  line: flat(new THREE.PlaneGeometry(1, 1)).translate(0, 0, 0.5),
  arrow: flat(new THREE.ShapeGeometry(arrowShape)),
};

const sectorCache = new Map<number, THREE.BufferGeometry>();
/** Circle sector pointing at +z with the given half angle (radians). */
export function sector(half: number): THREE.BufferGeometry {
  const key = Math.round(half * 1000);
  let g = sectorCache.get(key);
  if (!g) {
    g = flat(new THREE.CircleGeometry(1, 32, -Math.PI / 2 - half, half * 2));
    sectorCache.set(key, g);
  }
  return g;
}

const shared = new Set<THREE.BufferGeometry>([...Object.values(G)]);

/** Removes an object and frees what it owns (shared geometries are kept). */
export function discard(parent: THREE.Object3D, o: THREE.Object3D): void {
  parent.remove(o);
  o.traverse((m) => {
    const mesh = m as THREE.Mesh;
    if (mesh.geometry && !shared.has(mesh.geometry) && ![...sectorCache.values()].includes(mesh.geometry)) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (!mat) return;
    for (const one of Array.isArray(mat) ? mat : [mat]) if (!one.userData.keep) one.dispose();
  });
}

/** Marks a material as shared so discard() leaves it alone. */
export const keep = <T extends THREE.Material>(m: T): T => {
  m.userData.keep = true;
  return m;
};

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const rand = (a: number, b: number): number => a + Math.random() * (b - a);

export function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d")!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
