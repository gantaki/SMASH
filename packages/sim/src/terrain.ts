// The arena coming apart: broken tiles drop, and whatever is left without floor under it goes into the abyss.
// A fall is death on the spot (GAME_DESIGN §2.4).

import { arena, getChampion } from "@smash/content";
import { kill } from "./combat.ts";
import type { Ctx } from "./context.ts";
import { rimArc, solidAt } from "./floor.ts";
import { championById, type Unit } from "./state.ts";

/** Units that the floor does not concern right now: in the air mid-leap, or a flying companion. */
function airborne(ctx: Ctx, u: Unit): boolean {
  if (u.kind === "champion") return !!u.leap;
  const owner = championById(ctx.state, u.owner);
  return !!owner && !!getChampion(owner.champion).companion?.flying;
}

export function updateTerrain(ctx: Ctx): void {
  const { state, events, dt } = ctx;
  const floor = state.floor;

  // Crumbling tiles run out of time and drop.
  const dropped: number[] = [];
  for (const c of floor.crumbling) {
    c.time -= dt;
    if (c.time <= 0) dropped.push(c.tile);
  }
  if (dropped.length) {
    floor.crumbling = floor.crumbling.filter((c) => c.time > 0);
    events.push({ t: "floorDrop", tiles: dropped });

    // A section of the arena wall goes with the floor it stood on (checked under both of its halves).
    const r = arena.radius - (arena.radius - arena.floor.centerRadius) / arena.floor.rings / 2;
    for (let segment = 0; segment < state.rim.length; segment++) {
      if (state.rim[segment]! <= 0) continue;
      const { a0, span } = rimArc(segment);
      const held = [0.25, 0.75].some((k) => solidAt(state, Math.sin(a0 + span * k) * r, Math.cos(a0 + span * k) * r));
      if (held) continue;
      state.rim[segment] = 0;
      const mid = a0 + span / 2;
      events.push({ t: "rimBreak", segment, x: Math.sin(mid) * arena.radius, z: Math.cos(mid) * arena.radius, fell: true });
    }
  }

  // Pillars and walls drop with the tile under their centre; a crate also when it slides over a hole or out through a gap.
  for (const o of state.obstacles) {
    if (o.fallen || solidAt(state, o.x, o.z)) continue;
    // A wood wall that is already broken cannot be rebuilt over a hole, but there is nothing left to fall.
    const standing = o.alive;
    o.fallen = true;
    o.alive = false;
    o.vx = o.vz = 0;
    if (standing) events.push({ t: "obstacleFall", id: o.id, x: o.x, z: o.z });
  }

  for (const u of state.units) {
    if (u.dead || airborne(ctx, u) || solidAt(state, u.x, u.z)) continue;
    // Whoever is shoving or dragging the unit at this moment gets the credit.
    const by = u.forced ? u.forced.source : -1;
    events.push({ t: "fall", unit: u.id, x: u.x, z: u.z, by });
    kill(ctx, u, by);
  }
}
