import { rules } from "@smash/content";

/** Simulation tick length in seconds. */
export const TICK_DT = 1 / rules.tickRate;

/**
 * Turns variable frame time into whole fixed ticks.
 * The client calls `advance(frameSeconds)` every frame and runs `step` that many times;
 * `alpha` is how far it is between the last two ticks, for render interpolation.
 */
export function createTickClock(maxTicksPerFrame = 5) {
  let acc = 0;
  return {
    advance(seconds: number): number {
      acc += Math.max(0, seconds);
      let ticks = Math.floor(acc / TICK_DT + 1e-9);
      if (ticks > maxTicksPerFrame) {
        ticks = maxTicksPerFrame;
        acc = 0;
      } else {
        acc = Math.max(0, acc - ticks * TICK_DT);
      }
      return ticks;
    },
    get alpha(): number {
      return acc / TICK_DT;
    },
  };
}
