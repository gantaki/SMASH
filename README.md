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
- Why a web stack: [`docs/adr/0001-web-stack.md`](docs/adr/0001-web-stack.md)
- Playable single-file prototype (feel and numbers reference): [`prototype/`](prototype/)

**Status:** M1 done: the prototype's rules run in the deterministic simulation (`packages/sim`) from data (`packages/content`), and the client plays it offline: duel vs a bot (three difficulties), a **training range** with a dummy and live feel tuning, sound effects, wind-up telegraphs, sudden death with rifts.
**M2 is built**: online 1v1 through an authoritative server (rooms by link, client prediction, kill cam replay). It is tested with a simulated network and with two browsers against a local server; it still needs a hosted server and a playtest over the real internet.

## Quick start

Requires Node 22+ and pnpm 10+ (`corepack enable` gives you the pinned pnpm).

```bash
pnpm install
pnpm dev          # client on http://localhost:5173, server on ws://localhost:2567
```

Open the client, pick a champion and press **В бой** (duel vs a bot) or **Тренировка** (practice range). To play a friend: **Играть с другом по сети** → create a room → send the `/r/CODE` link → both press **Готов**. With `pnpm dev` this works between two tabs and across your local network (`http://<your-ip>:5173/r/CODE`).

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
- **Game server → not on Vercel.** Vercel does not run long-lived WebSocket servers, so the server needs a container host. Until one is set up, the deployed client is fully playable offline (bots, training), and the online lobby says the server is not configured.

### Hosting the game server

1. Deploy it. The repo has a [`Dockerfile`](Dockerfile) (any host: Fly.io, Railway, a VPS) and a [`render.yaml`](render.yaml) blueprint: on Render choose **New → Blueprint** and pick this repository. The free plan sleeps when idle, so the first connection after a pause takes up to a minute.
2. Check it: opening `https://<your-server-host>/` shows `{"ok":true,…}`.
3. Point the client at it: set `VITE_SERVER_URL=wss://<your-server-host>` in the Vercel project's environment variables and redeploy.

To try a server without redeploying the client, open the site with `?server=wss://<your-server-host>` once: the browser remembers it. The same trick works with a tunnel to `pnpm dev:server` on your own machine.

Pick a region close to the players: every 50 ms of round trip is 50 ms before the opponent's actions show up.

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
  vfx/         Spine exports (Ink Blade Hit)
  sfx/         sound effects (mp3)
  characters/  glTF characters (M3)
docs/          design doc, ADRs
prototype/     single-file Three.js prototype
tests/         repo-wide guards
```

## Stack

TypeScript (strict) · Three.js · React · Vite · Web Audio · Node + ws · Vitest · pnpm workspaces. Details and reasoning in the design doc.
