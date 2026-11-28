# ADR 0002: Simulation architecture

Status: accepted · M1

## Context

M1 ports the single-file prototype into a simulation that the client runs offline now and the server will run authoritatively in M2 (prediction, reconciliation, rollback). The prototype mixed rules, rendering and closures (`onHit: t => burn(t, …)`) in one file, which can be neither serialized nor replayed, and adding a champion meant writing code in five places.

## Decisions

1. **One mutable, plain-data state.** `createMatch(config)` returns a `MatchState` made of plain objects and arrays; `step(state, inputs)` advances it by one fixed tick in place and returns events. Entities reference each other by numeric id, never by object reference. Nothing in the state is a function or a class instance. The RNG is a single integer in the state.
   - Why mutable: the per-tick allocation of an immutable state is wasted work at 60 Hz; rollback only needs `structuredClone` at the snapshot points.
   - Tested: a JSON round-trip of the state mid-match continues identically.
2. **Abilities are data + one behaviour per kind.** An ability is a record with a `kind` discriminator; the sim has one function per kind in a registry typed as `{ [K in AbilityKind]: Behavior<K> }`, so a new kind cannot be forgotten. Effects on targets are an `OnHit` record applied by one function (`applyOnHit`). Special cases that used to be code (Fireball splits on the Wisp, Harpoon pulls Grakk to the Hound) are data (`throughCompanion`).
3. **Events for presentation.** `step` returns plain `SimEvent`s that carry ids and positions. The client maps them to VFX, SFX, floating text and messages; it reads state for continuous things (positions, telegraphs from `unit.cast`). It never writes to the state. Debug actions on the training range go through `trainingCommand`, a sim function that is a no-op outside training mode.
4. **Bots are players.** `botInput` returns the same `PlayerInput` a human sends (move, aim, pressed slots), so bots pay the same wind-ups, buffers and cooldowns, and the same code path will serve as "input source" on the server. Bot decisions are per ability kind, driven by a small `BotProfile` on the champion.
5. **60 Hz tick.** The prototype ran on variable frame time; the design doc left 30 vs 60 Hz open. Offline, input latency at 30 Hz (33 ms + interpolation) is noticeable against the prototype. The sim costs microseconds per tick, so 60 Hz it is; the network snapshot rate is a separate decision for M2.
6. **Cooldown and energy are paid when the ability fires**, after the wind-up. Now that every attack has a wind-up, paying up front would make every interrupt cost a full cooldown (or 100 energy).
7. **Runtime tuning multipliers** (`state.tuning`) exist for the training range only: move speed, acceleration, projectile speed, wind-up time, cooldowns. They default to 1 and are part of the state, so they stay deterministic.

## Consequences

- Balance changes are data-only; `content.test.ts` guards kit completeness, tunnelling and dodgeability.
- `pnpm sim:batch` runs hundreds of bot matches per second, so balance can be checked without a browser.
- Gameplay numbers live in `packages/content`. Exceptions kept in the sim on purpose: bot heuristics (`bot.ts`) and numerical tolerances.
- The state is not yet minimal for the network (bot scratch data lives in it for determinism). M2 defines the snapshot subset.
