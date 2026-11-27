// Seeded RNG (mulberry32). The simulation must never call Math.random().

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Float in [lo, hi). */
  range(lo: number, hi: number): number;
  /** Integer in [0, n). */
  int(n: number): number;
  /** Current internal state, to snapshot and restore the stream. */
  state(): number;
}

export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo, hi) => lo + next() * (hi - lo),
    int: (n) => Math.floor(next() * n),
    state: () => s,
  };
}
