# Arena — Game Design & Tech Stack

> Working title. Living document: update it when a decision changes.
> Numbers below come from the playable prototype (single-file Three.js build) and are **starting values, not final balance**.

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
| Round end | ~2.6 s, then next round. |
| Match | **Best of 3** (first to 2 round wins). |

Modes: **1v1 duel** first, then 2v2 / 3v3. Practice vs bots (easy / normal / hard).

### Arena

- Circular arena, **radius 20 m**. Spawns at `z = ±10`.
- **4 pillars** at `(±7.5, ±7.5)`, radius 1.3 m. Block movement and projectiles.
- **Orb** (center): spawns at **15 s**, 40 HP, blocks movement and projectiles. The **last hitter** gets **+20 HP and +25 energy**. Respawns 20 s after being broken.
- **Shrinking zone**: from **70 s** the safe radius shrinks by 0.5 m/s down to 5 m. Outside: 5 damage every 0.5 s.

### Controls

| Input | Action |
|---|---|
| WASD | Move (camera-relative) |
| Mouse | Aim (ground point under cursor) |
| LMB | Basic attack (hold to repeat) |
| RMB | Secondary ability |
| Space | Mobility |
| Q / E | Abilities |
| F | Ultimate (costs 100 energy) |
| Esc / P | Pause (local) / menu |

Inputs are **buffered for 0.25 s**, so pressing during a cast or stun fires as soon as it becomes possible.

### Resources

- **HP**: per champion (170–220 in the prototype).
- **Energy (0–100)**: +0.55 per point of damage dealt, +1.2/s passive. Resets every round. Ultimate costs 100.

### Ability archetypes

| Type | Example | Notes |
|---|---|---|
| Projectile skill-shot | Fire Bolt | Blocked by pillars and the orb. |
| Cast-time skill-shot | Fireball, Harpoon | Shows a line telegraph during the cast. Movement slowed while casting. |
| Delayed ground AoE | Ring of Fire, Meteor | Circle telegraph that fills over the delay. |
| Melee cone | Cleave, Shield Bash | Instant, with a short cone flash. |
| Mobility | Blink, Leap | Teleport or arc movement. |
| Stance / self-buff | Counter, Flame Shield | Timed windows. |
| Channel | Whirlwind | Unstoppable, damage pulses. |

### Status effects

`stun` · `slow` · `knockback` · `pull` · `burn` (damage over time) · `shield` (absorb) · `counter` (negates the next hit and punishes the attacker) · `empowered` · `unstoppable` (immune to crowd control).

A stun or forced movement **cancels a cast in progress**. Unstoppable ignores stun, slow, knockback and pull.

### Readability rules

- Team colors: **ally = cyan `#39d0ff`**, **enemy = red `#ff4d3d`**. Used for the ring under the feet, telegraph outlines and health bars.
- Every cast or delayed ability has a telegraph: outline in team color, fill in the ability color, fill progress = time left.
- Off-screen enemies get an edge arrow.
- Floating damage numbers: white = dealt by you, red = taken by you.

---

## 3. Champions (prototype roster)

### Ember (Искра) — Fire Mage, ranged

HP 170 · speed 6.0 m/s. Kites, applies burn, punishes bad positioning.

| Slot | Ability | Behaviour | Starting values |
|---|---|---|---|
| LMB | Fire Bolt | Fast projectile | 30 m/s, range 14 m, 11 dmg, cd 0.5 s |
| RMB | Fireball | Cast-time projectile | Cast 0.45 s (move ×0.3), 20 m/s, range 15 m, 20 dmg + burn 4/s for 3 s, cd 4.5 s |
| Space | Blink | Teleport to cursor | Up to 7 m, cd 7 s |
| Q | Ring of Fire | Delayed AoE at cursor | Max range 11 m, r 2.6 m, delay 0.8 s, 18 dmg + stun 0.8 s, cd 9 s |
| E | Flame Shield | Knockback + shield | Enemies within 3.4 m: 6 dmg, knocked back 5 m; shield 25 for 2.5 s, cd 11 s |
| F | Meteor | Big delayed AoE | 100 energy, max range 13 m, r 3.6 m, delay 1.1 s, 45 dmg + stun 0.5 s |

### Fang (Клык) — Warrior, melee

HP 220 · speed 6.4 m/s. Closes distance, hooks, doesn't let go.

| Slot | Ability | Behaviour | Starting values |
|---|---|---|---|
| LMB | Cleave | Melee cone | Range 2.9 m, ±60°, 14 dmg, cd 0.6 s. Empowered: 26 dmg + slow 50% 1.5 s. On-hit VFX: **Ink Blade Hit** (Spine) |
| RMB | Harpoon | Cast-time hook | Cast 0.25 s (move ×0.4), 26 m/s, range 11 m, 10 dmg, pulls target to 1.5 m, cd 6 s |
| Space | Leap | Arc jump | Up to 8 m in 0.45 s. Landing r 2.4 m: 14 dmg + slow 40% 1.5 s, cd 8 s |
| Q | Shield Bash | Melee cone | Range 3.1 m, ±52°, 10 dmg + stun 1 s, cd 9 s |
| E | Counter | Stance | 1 s, move ×0.5. Negates a hit; attacker within 8 m: stun 1 s + 12 dmg; empowers next LMB for 3 s, cd 11 s |
| F | Whirlwind | Channel | 100 energy, 2.4 s, move ×1.15, unstoppable, 7 dmg every 0.3 s in r 3.2 m |

### Bots

Same rules as players, no cheating. Difficulty scales reaction time, aim error, target leading, dodge chance and ability use rate. Behaviours: keep preferred range, strafe, dodge projectiles and AoEs, use mobility/counter defensively, contest the orb, avoid the zone.

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
| Tests | **Vitest** (simulation), headless bot-vs-bot match runs, Playwright smoke + screenshot tests | |
| Hosting | Client: static hosting/CDN. Game server: small VPS / Docker close to players | |
| Desktop (later) | Tauri or Electron wrapper | Only if Steam becomes a goal. |

---

## 5. Architecture

### 5.1 Simulation core (`packages/sim`)

- Pure TypeScript. **No Three.js, no DOM, no `Date.now()`, no `Math.random()`** (seeded RNG only).
- **Fixed tick** (start with 30 Hz, configurable). `step(state, inputs) → state + events`.
- Owns all gameplay: movement, collisions (circles vs circles and the arena edge), abilities, projectiles, ground effects, statuses, orb, zone, rounds.
- Emits **gameplay events**: `AbilityCast`, `ProjectileSpawned`, `Hit`, `StatusApplied`, `Died`, `OrbBroken`, `RoundEnded`, …
- Runs identically on the server (authoritative) and on the client (prediction, bots, offline practice).

### 5.2 Content as data (`packages/content`)

- Champions and abilities are typed data: numbers, shapes, timings, statuses, VFX/SFX ids.
- Ability **behaviour** is a small set of reusable building blocks (projectile, cone, ground AoE, dash, stance, channel) plus hooks for special cases.
- Balance changes touch data only, never sim logic.

### 5.3 Netcode model

1. Client sends **inputs** every tick: move vector, aim point, pressed buttons, sequence number.
2. Server simulates authoritatively and sends **snapshots** (positions, HP, statuses, cooldowns) plus events.
3. Client **predicts its own champion** (movement, cast starts) and **reconciles**: on a snapshot, rewind to the server state and replay unacknowledged inputs.
4. Other entities are rendered **interpolated** ~100 ms in the past.
5. Own projectiles may be spawned predictively for responsiveness and matched to server ids.
6. **Hits and damage are decided only by the server.** Lag compensation (rewinding targets on hit checks) comes later, if needed.

### 5.4 Client (`apps/client`)

- Reads sim state, interpolates and drives meshes, animations, VFX, audio and HUD. **Never mutates sim state.**
- Maps gameplay events to presentation through data, e.g. `fang.cleave.onHit → vfx: "ink_blade_hit"`.
- Camera: perspective, FOV 45°, height ~26 m, ~12.5 m back, follows the player with look-ahead toward the cursor (28%, clamped to 6 m).

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
| **M1** Sim port | Port prototype rules into `packages/sim` with tests; client renders it; offline vs bots | Prototype feel reproduced; bot-vs-bot matches finish without errors. |
| **M2** Online 1v1 | Rooms by link, prediction, reconciliation, interpolation | Two people in different places play a full match and it feels responsive. **Key risk check.** |
| **M3** Real assets | 3D characters on a shared skeleton, animation state machine, Spine VFX through `spine-threejs` | Both champions fully animated with final-style VFX. |
| **M4** Teams & lobby | 2v2 / 3v3, lobby, menus, reconnect | 3v3 with friends + bots. |
| **M5** Content & polish | More champions, sound, settings, optional desktop build | — |

---

## 8. Open Questions

- Tick rate: 30 Hz enough, or 60 Hz?
- Custom room server vs Colyseus (Colyseus state sync may fight a custom prediction model).
- Is WebSocket good enough at real-world latency, or is WebRTC needed early?
- 3D character pipeline: who makes models and animations (Mixamo, AI-generated, outsourced)?
- Team sizes to prioritise after 1v1.
- Final game name.

---

## 9. Rules for Agents (Claude Code)

- `packages/sim` must never import Three.js, React or the DOM.
- All gameplay numbers live in `packages/content`. No magic numbers in sim or client code.
- Every gameplay change comes with a sim test (unit test or scripted scenario).
- The client never decides hits or damage; it predicts and presents.
- Keep the simulation deterministic for a given seed and input stream (no wall-clock time, no unseeded randomness).
- Run a headless bot-vs-bot batch after balance or AI changes and report the results.
- Treat `prototype/` as reference only. Do not import from it.
