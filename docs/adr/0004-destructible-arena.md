# ADR 0004: Destructible arena in the simulation state

Status: accepted

## Context

Destruction of the arena became a core mechanic (GAME_DESIGN §2.4): attacks break the floor, the wall around the arena and the obstacles, and under the arena is an abyss where a fall is death. Until now the arena was a fixed circle: its edge was a clamp on the radius in five places, the floor did not exist in the simulation at all, and stone pillars could not take damage.

The mechanic has to live in the deterministic simulation (it decides who dies), survive a JSON copy of the state (snapshots, kill cam replays, rollback), and stay cheap enough to check for every unit every tick.

## Decisions

1. **The floor is a fixed layout of tiles plus per-tile health in the state.** The layout (a round slab and rings of tiles, `arena.floor`) is content and is computed once in `packages/sim/src/floor.ts`; the state only holds `floor.hp[]` (one number per tile) and `floor.crumbling[]` (broken tiles that have not dropped yet, with a timer). "Is there floor at (x, z)" is one polar lookup: O(1), no search.
   - Why tiles and not free-form holes (circles cut out of the floor): tiles give a telegraph per piece, a readable grid for players, an exact and cheap point query, and a state that is a flat array of numbers. Free-form holes would need polygon clipping in the sim and in the renderer.
   - Why rings and not a square or hex grid: the arena is round, so rings give a clean edge with whole tiles, tiles of nearly equal size, and exactly two tiles under each section of the wall. Another arena shape would add another layout kind next to this one; the queries (`tileAt`, `solidAt`) are the interface the rest of the sim uses.
2. **The arena wall is sections with health in the state** (`rim[]`), not a property of the radius. Everything that used to clamp to the radius now asks `rimPenetration`, which answers "no wall here" where a section is gone.
3. **One rule decides what an attack damages, and it is in the ability data.** Abilities that strike the ground carry `floorDamage` (required by the types on ground blasts and leap landings); everything else can only damage structures. The sim has two entry points: `damageFloor` and `damageStructuresInArea` (plus `damageObstacle` / `damageRim` for single hits).
4. **Falling is a separate system that runs after all movement** (`terrain.ts`, last before the round check): drop the tiles whose time is up, then anything left without floor under its centre goes: wall sections, obstacles, units. A unit that falls is killed outright (`kill`), bypassing `hurt`, so shields and counters do not apply; the unit's current knockback or pull gives the credit.
5. **A broken tile stays solid while it crumbles.** The telegraph is part of the rule, not of the presentation: `solidAt` is true for a crumbling tile, `safeAt` is not (bots and companions use `safeAt`).
6. **The client draws the floor from state, not from events.** Events only trigger dust, sound and camera shake. The kill cam re-simulates the last moments from an earlier state, so tiles have to be able to come back; a state-driven view gets that for free.
7. **Bots avoid holes by predicting their own path** with the same acceleration model as walking, rather than by a repulsion force: a force lets momentum carry a bot over the corner of a missing tile (measured over 60 Ember mirror matches: 73 bots walked into a hole with two look-ahead points on a straight line, none with path prediction).

## Consequences

- The state grew by 469 + 36 numbers: about **1.9 kB of the 9.2 kB JSON snapshot** sent 20 times a second in the P2P prototype. Acceptable there; when M2 defines the snapshot subset and a binary protocol, the floor should be sent as a delta (it changes a few times per round).
- `tileSolid` scans the `crumbling` list; it holds at most a few dozen entries in play. If a design ever crumbles hundreds of tiles at once, give the state a per-tile timer instead.
- Obstacles gained `fallen`; stone pillars have health. `rules.slam.woodDamage` became `structureDamage`.
- Positions beyond the arena radius are now reachable (through a gap), for one tick, before the unit falls. Code that assumed "every unit is inside the radius" must not: use the floor queries.
- Rifts and the sudden-death zone are unchanged and do not interact with the floor yet (open question in GAME_DESIGN §8).
