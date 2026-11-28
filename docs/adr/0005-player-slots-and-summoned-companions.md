# ADR 0005: Player slots, and companions that exist only while summoned

Status: accepted

## Context

Two things outgrew the duel the simulation was written for.

- **Teams.** The state assumed one champion per team: `config.players` was a pair indexed by team, `step` took a pair of inputs indexed by team, bot scratch data was a pair, a round ended when "a champion" died. 2v2 needs more than one champion on a side.
- **Companions.** A companion was a permanent unit that followed its owner, attacked by itself and blocked shots for free. With destructible floor it had to path around holes all round long; with 2v2 there would be eight units on the field before anyone pressed a key.

## Decisions

1. **A player is a slot.** `config.players` is a list of two (a duel) or four (2v2). The slot is the index in that list; `ChampionUnit.slot` carries it; inputs to `step` and `state.bots` are indexed by slot.
2. **Slots alternate teams**: even slots are team 0, odd slots team 1. A duel keeps "slot = team", so every existing caller (`step(state, [a, b])`, snapshots, replays, the online prototype) is unchanged, and a team is never stored twice (it is `slot % 2`). The cost is that team sizes are always equal, which is what the modes need.
3. **A round ends when a whole team is down.** Both at once is still a draw. `championOfTeam` stays as "the first champion of a team" for the many places that only ever look at a duel; new code uses `championOfSlot` or filters by team.
4. **Bots pick the nearest enemy still standing** each tick. No target stickiness and no coordination with the ally: cheap, and good enough for a first 2v2.
5. **A companion is on the field only while it carries out a command.** `CompanionUnit.dead` means "not on the field" (never summoned, sent away, or killed); `respawn > 0` means it was killed and cannot be summoned yet. The command ability summons it beside the owner; every command ends in `leave`. The "follow" mode and the free default attack are gone, and `CompanionAttack` lost the numbers that only they used.
   - Reusing `dead` rather than adding an `away` flag keeps every existing filter (`enemiesOf`, `hittables`, the terrain and rift loops, the client's visibility) correct without touching it.
6. **Things an ability puts on the field are obstacles with an owner and a clock** (`kind: "wall"`, `temp`, `owner`, `source`), kept in `state.obstacles` and removed from the list when their time is up or they break. The client therefore builds obstacle models from state, lazily, and drops the ones that are gone. A Colosseum is its walls plus an entry in `state.arenas` (the area where slams are multiplied).

## Consequences

- Client code that wants "the player" must not assume one champion per team: the viewer is `championOfTeam(state, viewerTeam)` only because the human is always the first slot of their team. Online teams will need a `viewerSlot`.
- The kill cam frames the *last* death of the replay (the one that decided the round), not the first.
- Replays record inputs for slots 0 and 1 only: enough while the other slots are bots.
- A companion's cost is now all in its command (energy and cooldown); the "at most 20–25% of a champion's damage" budget is easier to hold, and summon-only kits (the Boulder as cover, the Moon as a well) became possible.
