import { describe, expect, it } from "vitest";
import { TICK_DT, angleDiff, angleOf, createRng, createTickClock, segmentDistance, vec } from "./index.ts";

describe("rng", () => {
  it("repeats the same stream for the same seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    const sa = Array.from({ length: 100 }, () => a.next());
    const sb = Array.from({ length: 100 }, () => b.next());
    expect(sa).toEqual(sb);
    expect(sa.every((v) => v >= 0 && v < 1)).toBe(true);
  });

  it("differs between seeds", () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next());
  });
});

describe("math", () => {
  it("uses +z as facing 0 and +x as PI/2", () => {
    expect(angleOf(vec(0, 1))).toBeCloseTo(0);
    expect(angleOf(vec(1, 0))).toBeCloseTo(Math.PI / 2);
  });

  it("wraps angle differences", () => {
    expect(angleDiff(0.1, Math.PI * 2 - 0.1)).toBeCloseTo(0.2);
  });

  it("measures distance to a segment", () => {
    expect(segmentDistance(vec(0, 1), vec(-1, 0), vec(1, 0))).toBeCloseTo(1);
    expect(segmentDistance(vec(3, 0), vec(-1, 0), vec(1, 0))).toBeCloseTo(2);
  });
});

describe("tick clock", () => {
  it("converts frame time into whole ticks", () => {
    const clock = createTickClock();
    expect(clock.advance(TICK_DT * 2.5)).toBe(2);
    expect(clock.alpha).toBeCloseTo(0.5);
    expect(clock.advance(TICK_DT * 0.5)).toBe(1);
  });

  it("caps ticks after a long stall", () => {
    const clock = createTickClock(5);
    expect(clock.advance(10)).toBe(5);
    expect(clock.alpha).toBe(0);
  });
});
