# SMASH

Fast top-down arena brawler for quick PvP with friends. Send a link, fight a best-of-3 in a few minutes. Runs in the browser.

## ▶ Play / test

| What | Link |
|---|---|
| **Production: game** (latest `main`) | https://smash-aleksandr-chernovs-projects-5d557d3c.vercel.app |
| Old single-file prototype | https://smash-aleksandr-chernovs-projects-5d557d3c.vercel.app/prototype/ |
| **Preview of a PR / branch** | link in the PR (Vercel bot comment) or on the deployments page |
| All deployments | https://vercel.com/aleksandr-chernovs-projects-5d557d3c/smash/deployments |

Every branch gets a stable preview alias that follows its latest push. Short branch names give `https://smash-git-<branch>-aleksandr-chernovs-projects-5d557d3c.vercel.app` (`/` becomes `-`, e.g. `feat/walls` → `smash-git-feat-walls-…`); long names are shortened with a hash (`prototype-companions` → `smash-git-prototype-fc037e-…`), so take those from the PR. Previews require a Vercel login (deployment protection); production is meant to be shared with friends.

- Design, rules, champions and architecture: [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md)
- Art style for champions, icons and interface: [`docs/ART_STYLE.md`](docs/ART_STYLE.md)
- Why a web stack: [`docs/adr/0001-web-stack.md`](docs/adr/0001-web-stack.md)
- Playable single-file prototype (feel and numbers reference): [`prototype/`](prototype/)

**Status:** M1 done; **M2 online 1v1 prototype (WebRTC P2P)** is playable in the browser (create/join `/r/CODE`, host-authoritative 60 Hz sim + 20 Hz snapshots + Guest prediction/reconciliation, rematch, ping). See [`docs/adr/0003-webrtc-p2p-prototype.md`](docs/adr/0003-webrtc-p2p-prototype.md).
Next: full **M2** dedicated server (`apps/server`) / binary protocol if needed.

## Quick start

Requires Node 22+ and pnpm 10+ (`corepack enable` gives you the pinned pnpm).

```bash
pnpm install
pnpm dev          # client on http://localhost:5173, server on ws://localhost:2567
```

Open the client, pick a champion from the tiles on the left, pick a mode in the bar at the bottom — **С ботом** (duel vs a bot), **Онлайн** (create a room or share `/r/CODE` over WebRTC P2P) or **Тренировка** (practice range) — and press the big button. Controls and arena rules are under **Как играть**.

| Command | What it does |
|---|---|
| `pnpm dev` | Client + server with hot reload |
| `pnpm test` | All unit tests (Vitest) + architecture guards |
| `pnpm typecheck` | TypeScript across every package |
| `pnpm build` | Production build of the client |
| `pnpm check` | typecheck + test + build (what CI runs) |
| `pnpm sim:batch [matches] [easy\|normal\|hard]` | Headless bot-vs-bot batch: win rates, round lengths, damage |
| `pnpm prototype` | Serves the prototype at http://localhost:5180/prototype/ |

## Deployment

- **Client + prototype → Vercel.** Linked to this repo: every push to `main` deploys production, every branch/PR gets a preview URL. Config in [`vercel.json`](vercel.json). `pnpm build:web` builds the client and lays out the site: `/` = client, `/prototype/` = the old prototype, `/r/CODE` → client.
- Vercel project settings: **Root Directory must stay empty** (repo root); build settings come from `vercel.json`.
- **Game server → optional for the P2P prototype.** Vercel does not run long-lived WebSocket servers, so the **Онлайн 1 на 1** prototype runs P2P over WebRTC (`trystero` public Nostr signaling) directly from the static Vercel site. Optionally set `VITE_ICE_SERVERS` (JSON array of `RTCIceServer`) if you want a custom TURN relay for strict NATs. When hosting `apps/server` separately later, set `VITE_SERVER_URL=wss://…` in Vercel and redeploy.

## Layout

```
apps/
  client/      Vite + React + Three.js
  server/      Node WebSocket room server
packages/
  sim/         deterministic simulation, shared by client and server (pure TS)
  content/     champions, abilities, arena and match rules (data)
  protocol/    client/server message types
assets/
  art/         champion portraits, select tiles, ability and interface icons
  vfx/         Spine exports (Ink Blade Hit)
  sfx/         sound effects (mp3)
  characters/  glTF characters (M3)
docs/          design doc, art style guide, ADRs
prototype/     single-file Three.js prototype
tests/         repo-wide guards
```

## Stack

TypeScript (strict) · Three.js · React · Vite · Web Audio · Node + ws · Vitest · pnpm workspaces. Details and reasoning in the design doc.
