import type { Rng } from "./rng.ts";
import type { SimEvent } from "./events.ts";
import type { MatchState } from "./state.ts";

/** Everything a system needs during one tick. */
export interface Ctx {
  state: MatchState;
  events: SimEvent[];
  rng: Rng;
  dt: number;
}
