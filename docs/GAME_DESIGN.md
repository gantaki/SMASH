# Arena — Game Design & Tech Stack

> Working title. Living document: update it when a decision changes.
> Numbers below mirror `packages/content` (the source of truth for balance) and are **starting values, not final balance**.
> When a number here and the data disagree, the data wins: fix the doc.

---

## 1. Vision

A fast, top-down **arena brawler** in the spirit of Battlerite, built for **quick PvP sessions with friends**.
Send a link → friend joins in seconds → best-of-3 fight in a few minutes. No install, no farming, no levels: pure skill-shot combat.

### Pillars

1. **Skill over stats.** Aim, dodge, timing. Every dangerous ability is readable and dodgeable.
2. **Instant access.** Link to fight in under 15 seconds. Runs in the browser.
3. **Short and intense.** Rounds of ~30–90 s, matches of a few minutes.
4. **Readable from above.** Silhouettes, telegraphs, VFX all designed for a top-down camera.

### Non-goals (for now)

- Public matchmaking, ranked ladder, monetization.
- Mobile / touch controls (WASD + mouse only).
- Anti-cheat beyond server authority (friends-only rooms).

---

## 2. Core Gameplay

### Match flow

| Phase | Details |
|---|---|
| Lobby | Room by code/link, pick champion, ready up. Empty slots can be filled by bots. |
| Countdown | 3 s, champions frozen at spawns. |
| Round | Fight until one team is dead. |
| Round end | **Kill cam**: the final blow is replayed from the side in slow motion (≈3 s, Space skips it), then 2 s, then the next round. |
| Match | **Best of 3** (first to 2 round wins). |

Modes: **1v1 duel with AI companions** is developed and tested first; 2v2 / 3v3 later. Practice vs bots (easy / normal / hard).

**Training range**: no countdown and no round end. The opponent is a **dummy** (300 HP, heals to full 3 s after the last hit, can be told to strafe). A side panel shows damage per second and exposes range commands (keys 1–5: reset cooldowns, fill energy, dummy moves, sudden death on/off, reset arena) and **live feel tuning**: multipliers for move speed, acceleration, projectile speed, wind-up time and cooldowns. The sliders only affect that session; values that feel right are written back into `packages/content`.

Direction: keep Battlerite's skill-shot core, but add **companions** (each champion has a unique one) and **interactive obstacles** (§2.1, §2.2).

### Arena

- Circular arena, **radius 18 m** (36 m across; 20 m felt too roomy for a duel). Spawns at `z = ±10`.
- **4 pillars** at `(±7.5, ±7.5)`, radius 1.3 m. Block movement and projectiles.
- **Orb** (center): spawns at **15 s**, 40 HP, blocks movement and projectiles. The **last hitter** gets **+20 HP and +25 energy**. Respawns 20 s after being broken.
- **Sudden death** from **30 s** (ends rounds that drag on; see below).

**Sudden death** has two parts:

1. **The zone**: the safe radius shrinks by 0.3 m/s from 18 m down to 7 m. Outside: 5 damage every 0.5 s.
2. **Rifts**: every 7 s (first one 1.5 s in) the floor cracks open along a jagged line 7–10 m long (never longer than 1.2 zone radii). A rift starts near the zone edge and cuts **across** the arena beside the middle: it never comes within **3.5 m of the centre**, which always stays safe ground, and never within 2.5 m of another open rift. Rifts always open in **point-symmetric pairs** so neither side is favoured. At most **two pairs** are open: when a third opens, the oldest pair seals (1 s, harmless). Each rift is a geyser on a loop: **dormant 3.2 s → warning 1.1 s → eruption 0.9 s**. The warning is the telegraph (the crack's danger area brightens and flickers faster; the first warning after opening lasts 1.8 s). While erupting, anyone standing over the crack takes **8 damage every 0.3 s** and is slowed 30% for 0.6 s; leaping over it is safe. Rifts hit both teams and companions.

Design intent: the zone pushes players together, rifts cut the remaining space into lanes and punish standing still. Bots step off a rift when its warning starts.

### Controls

| Input | Action |
|---|---|
| WASD | Move (camera-relative) |
| Mouse | Aim (ground point under cursor) |
| LMB | Basic attack (hold to repeat) |
| RMB | Secondary ability |
| Space | Mobility |
| Q / E | Abilities |
| R / middle mouse | Command the companion (to the cursor) |
| F | Ultimate (costs 100 energy) |
| C | Cancel your own wind-up or channel |
| Esc / P | Pause (local) / menu |
| M | Mute |
| 1–5 | Training range commands |

Inputs are **buffered for 0.25 s**, so pressing during a cast or stun fires as soon as it becomes possible.

### Movement and pacing (the Battlerite reference)

What makes Battlerite feel the way it does, from Stunlock patch notes, the official data dump and dev blogs, and how we map it:

| Battlerite | Here |
|---|---|
| WASD movement independent of aim; the champion faces the cursor; near-instant acceleration ("all movement has to feel responsive") | Same model, a little more weight: **acceleration and deceleration 150 ms** (playtested; 40–60 ms felt weightless). A full reversal takes as long as a start. The same speed in every direction. |
| Base speed 3.4–4.2 units/s; a ranged basic attack reaches 7.2–8.5 units, i.e. **≈2.1 s of walking** | **About 6 m/s** (playtested): 5.5 for the slowest champions, 6.5 for the fastest. Fire Bolt reaches 13 m: **≈2.1 s of walking**. Same proportions, different unit. |
| **Every attack has a wind-up**: melee M1 ≈0.35 s, ranged M1 0.07–0.45 s, M2 ≈0.55 s. You keep moving while winding up, slower (melee M1 80%, ranged M1 20–60%). This is the "fighting game" rhythm. | Every attack has a wind-up with a ground telegraph and a cast bar: Fire Bolt 0.3 s at 55% speed, Cleave 0.28 s at 80%, heavier abilities 0.25–0.6 s at 40–60%. Aim stays free during the wind-up. |
| Basic projectiles fly at ≈5× walking speed (16–20 units/s), nukes 6–9× | Deliberately slower, for readability (playtested): Fire Bolt 19.3 m/s (3.2×), Fireball 14.5 m/s, Harpoon 17.4 m/s. |
| Space ability: ≈0.1 s cast, ≈8.5 s cooldown, 0.3–0.95 s air time | Blink (instant, 7 s), Leap (0.55 s air, 7 s). |
| Stuns ≈0.6 s, snares 15–50% for 0.5–2 s | Stuns 0.5–1.2 s, slows 30–50% for 0.6–1.5 s. |
| Sudden death at 1:30–2:00, orb at 20 s | Sudden death at 0:30 (rounds are short here), orb at 15 s. |

Rules that follow from this:

- **Cooldown and energy are paid when the ability fires**, not when the wind-up starts. An interrupted wind-up (stun, knockback, pull) costs nothing but the time.
- Tick rate is **60 Hz** and rendering interpolates between ticks, so input never waits more than one frame.
- **Cast cancelling (C)**, as in Battlerite: aborts your own wind-up or channel. A cancelled wind-up costs nothing (see above), a cancelled channel is not refunded. The cancel itself has a 1 s cooldown, so it is a feint, not a stutter-step. Bots cancel a wind-up that can no longer connect.
- **Fading snare**: a slow that starts at full strength and wears off linearly. Both basic attacks apply a light one (25% over 0.6–0.7 s), so a hit lets melee stay on its target and lets ranged keep its distance. Slows do not stack: the stronger one at the moment of the hit wins.
- **Sound follows the key press**: every wind-up starts a quiet cue immediately and the release sound plays when it fires. A cancelled or interrupted wind-up cuts its cue short.
- Not copied (yet): mounts, EX abilities, recovery health. Candidates for later.

### Resources

- **HP**: per champion (170–220 in the prototype).
- **Energy (0–100)**: +0.55 per point of damage dealt, +1.2/s passive. Resets every round. Ultimate costs 100.

### Ability archetypes

| Type | Example | Notes |
|---|---|---|
| Projectile skill-shot | Fire Bolt, Fireball, Harpoon | Line telegraph during the wind-up (its width is the projectile's hitbox). Movement slowed while winding up. Blocked by pillars and the orb. |
| Delayed ground AoE | Ring of Fire, Meteor | Circle telegraph that fills over the delay, with a ring closing in on its edge: when it touches, it explodes. Leaves a scorch mark. |
| Melee cone | Cleave, Shield Bash | Short wind-up with a cone telegraph, then a cone flash. |
| Mobility | Blink, Leap | Teleport or arc movement. |
| Stance / self-buff | Counter, Flame Shield | Timed windows. |
| Channel | Whirlwind | Unstoppable, damage pulses. |

### Status effects

`stun` · `slow` (flat or fading) · `root` ("pinned": cannot move or use mobility, can still cast) · `knockback` · `pull` · `burn` (damage over time) · `shield` (absorb) · `counter` (negates the next hit and punishes the attacker) · `empowered` · `unstoppable` (immune to crowd control).

A stun or forced movement **cancels a cast in progress**. Unstoppable ignores stun, slow, knockback and pull.

### 2.1 Companions (prototype, under playtest)

Each champion has a **unique companion** (more per champion later). Design rule: the companion is an **extension of the player's kit, not a second fighter**, so the duel stays a duel.

- **Default behaviour** without input (follow, guard, auto-attack), plus **one command key** (R / middle mouse): send it to the cursor.
- **Vulnerable**: has HP, dies, returns after **15 s**; the killer gains **+20 energy**. Enemy companions are valid targets for every ability.
- **Blocks enemy projectiles**, so it can be used as a shield.
- **Synergies** with its owner's abilities are where the depth comes from.
- Budget: companions should deal at most ~20–25% of a champion's total damage.

| Companion | Owner | HP | Default | Command | Synergy |
|---|---|---|---|---|---|
| **Wisp** (Огонёк) | Ember | 40 | Floats behind Ember, shoots sparks (4 dmg, every 1.2 s, range 8 m) | Flies to a point (max 11 m) and holds it for 6 s as a sentry (every 0.7 s, range 9 m). cd 5 s | **Fireball through the Wisp splits into 3** (12 dmg + burn 3/s for 2 s each) |
| **Hound** (Гончая) | Fang | 55 | Follows Fang, engages enemies within 4 m of him, bites 5 dmg/s | Sprints to a point (max 11 m); on contact bites 8 dmg and **pins (root) 0.8 s**, then fights for 3 s. cd 7 s | **Harpoon hitting the Hound pulls Fang to it** (gap closer) |

### 2.2 Obstacles (prototype, under playtest)

Material tells the rule at a glance:

| Material | Behaviour |
|---|---|
| **Stone** pillars | Indestructible. Block movement, projectiles and line of sight. |
| **Wood** walls (60 HP) | Take damage from projectiles, AoEs, melee, slams and flying crates; look damaged as HP drops; break, then **rebuild after 20 s** (only if nothing stands in the spot). |
| **Crates** | Movable. Pushed by knockback abilities, pulled by Harpoon. A crate moving faster than 3.5 m/s hits an enemy for 12 dmg and knocks them back 2.5 m (which can chain into a slam). |

**Slam rule:** any knockback that drives a target into an obstacle or the arena wall stuns for **0.6 s** and deals **10 dmg** (abilities can raise both). Pulls do not slam.

Prototype layout: 4 stone pillars at `(±7.5, ±7.5)`; wood walls 4 × 0.7 m at `(0, ±5)` and `(±12, 0)` (rotated 90°); crates at `(±3.5, 0)` and `(−12, 7)`, `(12, −7)`. Point-symmetric for fairness.

### Readability rules

- Team colors: **ally = cyan `#39d0ff`**, **enemy = red `#ff4d3d`**. Used for the ring under the feet, telegraph outlines and health bars.
- Every cast or delayed ability has a telegraph: outline in team color, fill in the ability color, fill progress = time left.
- Every wind-up is also visible **on the caster**: a cast bar under the health bar, a charge glow growing on the weapon, the ability's HUD slot lit.
- Projectiles carry a ground marker in the owner's team color, the size of their hitbox.
- Area hits flash the exact area that was hit; ultimates announce themselves with a ring, the ability name and a sound.
- Every gameplay event has a sound (`assets/sfx`), panned and attenuated by position.
- Off-screen enemies get an edge arrow.
- Floating damage numbers: white = dealt by you, red = taken by you.

---

## 3. Champions

A champion is **four core stats plus a kit**. Data lives in `packages/content/src/champions/<id>.ts`.

| Stat | Meaning | Reference range |
|---|---|---|
| `hp` | Health pool | 170 squishy · 195 average · 220 tank |
| `moveSpeed` | Top speed, m/s (the arena is 36 m across) | about 6; 5.5 slowest · 6.5 fastest (tested) |
| `radius` | Collision and hit radius | 0.7 m |
| `weight` | Divides knockback distance | 1 = normal, above 1 = heavy |

Every kit fills the same seven slots, so champions stay comparable and opponents know what to expect:

| Slot | Key | Role | Typical cooldown |
|---|---|---|---|
| primary | LMB | Spammable basic attack; the main energy source | 0.3–0.5 s after a 0.2–0.4 s wind-up |
| secondary | RMB | Heavier skill-shot | 4.5–6 s |
| mobility | Space | Escape or gap closer | 7 s |
| q | Q | Control (stun, knockback) | 8 s |
| e | E | Defence (shield, counter) | 9.5 s |
| companion | R | One command for the companion | 4.5–6 s |
| ultimate | F | Costs 100 energy | none |

### Ember (Искра) — Fire Mage, ranged

HP 170 · speed 6.0 m/s. Kites, applies burn, punishes bad positioning.

| Slot | Ability | Behaviour | Starting values |
|---|---|---|---|
| LMB | Fire Bolt | Projectile | Wind-up 0.3 s (move ×0.55), 19.3 m/s, range 13 m, 11 dmg + fading snare 25% over 0.7 s, cd 0.31 s |
| RMB | Fireball | Heavy projectile | Wind-up 0.6 s (move ×0.4), 14.5 m/s, range 15 m, 20 dmg + burn 4/s for 3 s, cd 4.4 s. Splits into 3 when passing through the Wisp |
| Space | Blink | Teleport to cursor | Up to 7 m, cd 7 s |
| Q | Ring of Fire | Delayed AoE at cursor | Wind-up 0.2 s, max range 11 m, r 2.6 m, delay 0.85 s, 18 dmg + stun 0.8 s, cd 8 s |
| E | Flame Shield | Knockback + shield | Enemies within 3.4 m: 6 dmg, knocked back 5 m (slam); pushes crates; shield 25 for 2.5 s, cd 9.5 s |
| R | Wisp | Companion command | See §2.1 |
| F | Meteor | Big delayed AoE | 100 energy, wind-up 0.3 s, max range 13 m, r 3.6 m, delay 1.2 s, 45 dmg + stun 0.5 s |

### Fang (Клык) — Warrior, melee

HP 220 · speed 6.4 m/s. Closes distance, hooks, doesn't let go.

| Slot | Ability | Behaviour | Starting values |
|---|---|---|---|
| LMB | Cleave | Melee cone | Wind-up 0.28 s (move ×0.8), range 2.9 m, ±60°, 14 dmg + fading snare 25% over 0.6 s, cd 0.37 s. Empowered: 26 dmg + slow 50% 1.5 s. On-hit VFX: **Ink Blade Hit** (Spine) |
| RMB | Harpoon | Hook | Wind-up 0.35 s (move ×0.4), 17.4 m/s, range 11 m, 10 dmg, pulls target to 1.5 m, cd 6 s. Pulls crates; hitting the Hound pulls Fang to it |
| Space | Leap | Arc jump | Up to 8 m in 0.55 s, landing marker shown. Landing r 2.4 m: 14 dmg + slow 40% 1.5 s, cd 7 s |
| Q | Shield Bash | Melee cone | Wind-up 0.25 s, range 3.1 m, ±52°, 10 dmg + stun 0.5 s, knockback 3 m; **slam: stun 1.2 s, +10 dmg**; pushes crates, cd 8 s |
| R | Hound | Companion command | See §2.1 |
| E | Counter | Stance | 1 s, move ×0.5. Negates a hit; attacker within 8 m: stun 1 s + 12 dmg; empowers next LMB for 3 s, cd 9.5 s |
| F | Whirlwind | Channel | 100 energy, 2.4 s, move ×1.15, unstoppable, 7 dmg every 0.3 s in r 3.2 m |

### Dummy (Манекен)

Training target: 300 HP, no abilities, not pickable.

### Adding content

- **New champion from existing mechanics**: add `packages/content/src/champions/<id>.ts` (stats, seven abilities, optional companion, bot profile), register it in `packages/content/src/index.ts`, add a model in `apps/client/src/game/render/Units.ts` and an emblem in `ui/icons.ts`. The sim, the bot (it decides per ability *kind*), the HUD, telegraphs and the menu pick it up from the data. `content.test.ts` checks the kit is complete and dodgeable.
- **New mechanic**: add a `kind` to the `Ability` union in `types.ts` and one function to `behaviors` in `packages/sim/src/abilities.ts` (TypeScript refuses to compile until every kind has one). Add a scenario test, a bot rule in `bot.ts` if bots should use it, and a telegraph in `Fx.ts` if it has a wind-up shape of its own.
- **New on-hit effect**: add a field to `OnHit` and handle it in `applyOnHit` (`combat.ts`).
- **New companion**: a `CompanionDef` in `companions.ts` (attack: ranged / melee; command: sentry / pounce).
- **New sound**: drop `assets/sfx/<id>.mp3`, add it to `apps/client/src/audio/manifest.ts`, reference the id from the ability's `sfx`.

### Bots

Same rules as players, no cheating: a bot produces the same per-tick input a human does (move, aim, pressed slots) and waits out the same wind-ups. Ability usage is decided per ability kind, so a champion built from existing kinds gets a working bot. Difficulty scales reaction time, aim error, target leading, dodge chance and ability use rate. Behaviours: keep preferred range, strafe, dodge projectiles and AoEs, use mobility/counter defensively, contest the orb, avoid the zone and erupting rifts, command the companion, attack the player's companion when it is close, shoot through breakable wood cover, look for slams (Shield Bash / Flame Shield with a wall behind the target). Fang bot combos *Hound pins → Harpoon to the Hound*.

---

## 4. Tech Stack

| Area | Choice | Notes |
|---|---|---|
| Language | **TypeScript** (strict) everywhere | One language for client, server and simulation. |
| Client renderer | **Three.js** (latest, from npm) | WebGL2. WebGPU renderer as a later option. |
| Build | **Vite** | |
| UI: menus, lobby, HUD | **React** | Per-frame HUD values (bars, cooldowns) are updated through refs/DOM, not React state. |
| Characters | **glTF 2.0** from Blender | All humanoids share **one skeleton** (Mixamo-compatible rig) so animations are reused without retargeting. meshopt/Draco geometry, KTX2 textures. |
| Animation | `THREE.AnimationMixer` + own state machine | Locomotion blend + upper-body action layer (attack while running). |
| VFX | Own GPU particle system + **Spine effects** via the official `spine-threejs` runtime | Effects authored in BoneGyre, exported to Spine 4.2. |
| Server | **Node.js** (LTS), authoritative rooms | Starting point: custom room server on `ws` / uWebSockets.js. Colyseus is an option (see open questions). |
| Transport | WebSocket, binary messages | Upgrade path: WebRTC DataChannels (unreliable) or WebTransport if packet loss hurts. |
| Serialization | Binary (DataView codecs or msgpack) | Shared in `packages/protocol`. |
| Monorepo | pnpm workspaces | See layout below. |
| Audio | Web Audio API, one-shot samples (`assets/sfx`, generated with ElevenLabs sound effects) | Engine in `apps/client/src/audio`; sound ids are referenced from ability data. |
| Tests | **Vitest** (simulation scenarios), headless bot-vs-bot batches (`pnpm sim:batch`), Playwright smoke + screenshot tests | |
| Hosting | Client: **Vercel** (static, auto-deploy from `main`, previews per PR). Game server: small VPS / container host close to players (Vercel does not run long-lived WebSocket servers) | |
| Desktop (later) | Tauri or Electron wrapper | Only if Steam becomes a goal. |

---

## 5. Architecture

### 5.1 Simulation core (`packages/sim`)

- Pure TypeScript. **No Three.js, no DOM, no `Date.now()`, no `Math.random()`** (seeded RNG only).
- **Fixed tick, 60 Hz** (`rules.tickRate`). `createMatch(config) → state`, `step(state, inputs) → events` (mutates the state in place).
- The state is **plain serializable data**: no classes, no functions, entities refer to each other by id. `JSON.parse(JSON.stringify(state))` continues identically (tested), which is what snapshots and rollback need in M2.
- Owns all gameplay: movement, collisions (circles vs circles and the arena edge), abilities, projectiles, ground effects, statuses, orb, zone, rounds.
- Emits **gameplay events**: `AbilityCast`, `ProjectileSpawned`, `Hit`, `StatusApplied`, `Died`, `OrbBroken`, `RoundEnded`, …
- Runs identically on the server (authoritative) and on the client (prediction, bots, offline practice).

| Module | Owns |
|---|---|
| `state.ts` | State types, `createMatch`, round reset |
| `match.ts` | `step`: phases, input, system order, round/match flow, training commands |
| `abilities.ts` | `tryCast → wind-up → fire`, one behaviour per ability kind |
| `combat.ts` | `hurt`, statuses, knockback/pull, slams, `applyOnHit` |
| `units.ts` | Champion timers, movement, casting, channelling, collisions |
| `projectiles.ts` | Projectiles, delayed ground effects |
| `companions.ts` | Companion AI |
| `obstacles.ts` | Wood walls rebuilding, crates |
| `hazards.ts` | Orb, sudden death (zone, rifts) |
| `bot.ts` | Bot AI |
| `headless.ts` | `runBotMatch` for batches and tests |

### 5.2 Content as data (`packages/content`)

- Champions and abilities are typed data: numbers, shapes, timings, statuses, VFX/SFX ids.
- Ability **behaviour** is a small set of reusable building blocks (projectile, cone, ground AoE, dash, stance, channel) plus hooks for special cases.
- Balance changes touch data only, never sim logic.

### 5.3 Netcode model

> Prototype note: an initial WebRTC P2P implementation (host-authoritative Team 0 + Guest prediction/reconciliation, 20 Hz snapshots) is live for static Vercel hosting — see [`docs/adr/0003-webrtc-p2p-prototype.md`](adr/0003-webrtc-p2p-prototype.md).

1. Client sends **inputs** every tick: move vector, aim point, pressed buttons, sequence number.
2. Server simulates authoritatively and sends **snapshots** (positions, HP, statuses, cooldowns) plus events.
3. Client **predicts its own champion** (movement, cast starts) and **reconciles**: on a snapshot, rewind to the server state and replay unacknowledged inputs.
4. Other entities are rendered **interpolated** ~100 ms in the past.
5. Own projectiles may be spawned predictively for responsiveness and matched to server ids.
6. **Hits and damage are decided only by the server.** Lag compensation (rewinding targets on hit checks) comes later, if needed.

### 5.4 Client (`apps/client`)

- Reads sim state, interpolates and drives meshes, animations, VFX, audio and HUD. **Never mutates sim state.**
- `game/Game.ts` runs the loop (fixed ticks + render interpolation) and input; `game/render/GameView.ts` owns the scene and maps events to effects and sounds; `render/Fx.ts` draws telegraphs, `render/Hazards.ts` the zone and rifts, `render/Overlay.ts` health and cast bars; `game/Hud.ts` the HUD; `ui/` the React menu and training panel.
- Maps gameplay events to presentation through data, e.g. `fang.cleave.onHit → vfx: "ink_blade_hit"`.
- Camera: perspective, FOV 45°, height ~26 m, ~12.5 m back, follows the player with look-ahead toward the cursor (28%, clamped to 6 m).
- **Kill cam** (`game/killcam.ts`): when a round is decided the client rewinds 0.6 s and **re-simulates** the final blow (the sim is deterministic and its state is plain data, so a short history of state + input is enough; in dev builds the replay is compared with the live state and a mismatch is logged). It is shown from a low side camera (1.9 m high, 8.5–13 m away, perpendicular to the line of the blow, on the side with a clear view), time eases from 0.5× down to 0.1× at the hit and back to normal, sounds are pitched down, the HUD gives way to letterbox bars. Space skips it; it is disabled with `prefers-reduced-motion`. Online (M2): the server has to hold the round-end phase for the kill cam's wall-clock length.
- **Ragdolls** (`render/Ragdoll.ts`): a champion that dies is thrown by the killing blow (speed grows with the blow's damage: a Cleave tosses the body a few meters, a Meteor across the arena), folds at the hips and neck, tumbles, bounces off the floor and slams into walls, pillars and crates; weapon and shield fly off on their own. The body flies away from where the hit physically came from (the attacker or its companion, a projectile's path, the centre of a blast), which the damage event reports separately from who gets the credit. Only a blow that landed within the last 0.4 s throws the body (the hit itself, or the wall slam right after it); when burn, the zone or a rift finishes the job later, the body just crumples. It is a four-point chain solved with position-based dynamics on the client: cosmetic only, the sim knows nothing about it. The kill cam stays in slow motion for the flight and follows the body. The model is put back together when the champion is alive again.

### 5.5 Server (`apps/server`)

- Room manager: create a room → short code → URL `/r/ABCD`.
- Lobby state: players, champion picks, ready flags, host. Bots fill empty slots.
- One sim instance per room; the room is destroyed when empty.
- Reconnect by room code within a grace period.

### 5.6 Repository layout

```
apps/
  client/        Vite + React + Three.js
  server/        Node room server
packages/
  sim/           deterministic game simulation (shared)
  content/       champions, abilities, arena, match rules (data)
  protocol/      message types (+ binary codecs in M2)
  vfx/           particle system + Spine effect player (added in M3)
assets/
  characters/    glTF + textures (M3)
  vfx/           Spine exports (.json/.skel + .atlas + .png)
docs/
  GAME_DESIGN.md this file
  adr/           architecture decision records
prototype/       single-file prototype (reference for feel and numbers)
tests/           repo-wide guards (architecture rules)
```

---

## 6. Art & VFX Direction

- **Camera-first design**: everything must read from ~60° pitch at gameplay zoom.
- Stylized 3D characters with strong silhouettes from above. Team-colored ring under the feet and a facing arrow.
- Arena look (prototype): sun-baked sandstone, warm dusk light, stone pillars with braziers.
- **VFX pipeline**: BoneGyre → Spine 4.2 export → `spine-threejs`. Effects are camera-facing billboards, mirrored to the hit direction, drawn on top of characters.
  - Prototype scale: **175 Spine px = 1 m**. Ink Blade Hit spawns 0.35 m in front of the target, 1.25 m high, ×1.3 for empowered hits.
  - Always export the **`.atlas`** together with the PNG. (The Ink Blade Hit atlas in `assets/vfx/` is reconstructed from the PNG; replace it with the real export.)
  - Lesson from the prototype: dark, small elements (ink puffs) get lost from the top-down camera and on dark targets. Check contrast and size at gameplay zoom before shipping an effect.

---

## 7. Roadmap

| Milestone | Goal | Done when |
|---|---|---|
| **M0** Skeleton ✅ | Monorepo, typed content, lobby server, client with static arena, CI, Vitest, architecture guards | `pnpm check` and `pnpm dev` work; two tabs meet in a lobby by link. |
| **M1** Sim port ✅ | Port prototype rules into `packages/sim` with tests; client renders it; offline vs bots; training range; sounds; wind-ups and sudden death rework | Prototype feel reproduced; bot-vs-bot matches finish without errors. |
| **M2** Online 1v1 | Rooms by link, prediction, reconciliation, interpolation | Two people in different places play a full match and it feels responsive. **Key risk check.** |
| **M3** Real assets | 3D characters on a shared skeleton, animation state machine, Spine VFX through `spine-threejs` | Both champions fully animated with final-style VFX. |
| **M4** Teams & lobby | 2v2 / 3v3, lobby, menus, reconnect | 3v3 with friends + bots. |
| **M5** Content & polish | More champions, sound, settings, optional desktop build | — |

---

## 8. Open Questions

- Pacing: move speed, acceleration, projectile speed and cooldowns were set from a first playtest on the training range. Wind-up lengths are per champion and still open.
- Round length: bot mirrors of Fang end in ≈10 s. Is time-to-kill too short once humans dodge?
- Rifts: 8 damage per 0.3 s, two pairs open at a time, centre kept clear — pressure or noise?
- Basic-attack snares (25%): do they make kiting or sticking too easy? Is a 1 s cancel cooldown the right price for a feint?
- Snapshot rate for M2 (the sim ticks at 60 Hz; snapshots can be 20–30 Hz).
- Custom room server vs Colyseus (Colyseus state sync may fight a custom prediction model).
- Is WebSocket good enough at real-world latency, or is WebRTC needed early?
- 3D character pipeline: who makes models and animations (Mixamo, AI-generated, outsourced)?
- Companion damage share and command cooldowns: does the companion feel useful without stealing the duel?
- Slam frequency: with this obstacle density, are slams too common?
- More companions per champion: chosen before the match, or swapped mid-match?
- Team sizes to prioritise after 1v1.
- Final game name.

---

## 9. Rules for Agents (Claude Code)

- `packages/sim` must never import Three.js, React or the DOM.
- All gameplay numbers live in `packages/content`. No magic numbers in sim or client code.
- Every gameplay change comes with a sim test (unit test or scripted scenario).
- The client never decides hits or damage; it predicts and presents.
- Keep the simulation deterministic for a given seed and input stream (no wall-clock time, no unseeded randomness).
- Run a headless bot-vs-bot batch (`pnpm sim:batch`) after balance or AI changes and report the results.
- Treat `prototype/` as reference only. Do not import from it.
