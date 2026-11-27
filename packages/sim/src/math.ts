// 2D math on the ground plane (x, z). Plain objects, no classes, so state stays serializable.

export interface Vec2 {
  x: number;
  z: number;
}

export const TAU = Math.PI * 2;

export const vec = (x = 0, z = 0): Vec2 => ({ x, z });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, z: a.z + b.z });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, z: a.z - b.z });
export const scale = (a: Vec2, k: number): Vec2 => ({ x: a.x * k, z: a.z * k });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.z * b.z;
export const length = (a: Vec2): number => Math.hypot(a.x, a.z);
export const distance = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.z - b.z);

export const normalize = (a: Vec2, fallback: Vec2 = { x: 0, z: 1 }): Vec2 => {
  const l = length(a);
  return l > 1e-9 ? { x: a.x / l, z: a.z / l } : { ...fallback };
};

/** Limits a vector's length to `max`. */
export const clampLength = (a: Vec2, max: number): Vec2 => {
  const l = length(a);
  return l > max ? scale(a, max / l) : { ...a };
};

/** Facing angle in radians: 0 points to +z, PI/2 to +x (matches the renderer's rotation.y). */
export const angleOf = (dir: Vec2): number => Math.atan2(dir.x, dir.z);

/** Signed shortest difference a - b, in (-PI, PI]. */
export const angleDiff = (a: number, b: number): number => {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
};

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Distance from point p to segment ab. */
export const segmentDistance = (p: Vec2, a: Vec2, b: Vec2): number => {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 > 0 ? clamp(dot(sub(p, a), ab) / l2, 0, 1) : 0;
  return distance(p, add(a, scale(ab, t)));
};
