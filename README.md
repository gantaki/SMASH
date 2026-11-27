# SMASH

Fast top-down arena brawler for quick PvP with friends. Send a link, fight a best-of-3 in a few minutes. Runs in the browser.

## ▶ Play / test

| What | Link |
|---|---|
| **Production: game** (prototype, latest `main`) | https://smash-aleksandr-chernovs-projects-5d557d3c.vercel.app |
| Production: real client (lobby skeleton) | https://smash-aleksandr-chernovs-projects-5d557d3c.vercel.app/app |
| **Preview of a PR / branch** | link in the PR (Vercel bot comment) or on the deployments page |
| All deployments | https://vercel.com/aleksandr-chernovs-projects-5d557d3c/smash/deployments |

Every branch gets a stable preview alias that follows its latest push. Short branch names give `https://smash-git-<branch>-aleksandr-chernovs-projects-5d557d3c.vercel.app` (`/` becomes `-`, e.g. `feat/walls` → `smash-git-feat-walls-…`); long names are shortened with a hash (`prototype-companions` → `smash-git-prototype-fc037e-…`), so take those from the PR. Previews require a Vercel login (deployment protection); production is meant to be shared with friends.

- Design, rules, champions and architecture: [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md)
- Why a web stack: [`docs/adr/0001-web-stack.md`](docs/adr/0001-web-stack.md)
- Playable single-file prototype (feel and numbers reference): [`prototype/`](prototype/)

**Status:** M0 (skeleton) done: monorepo, typed champion data, lobby server, client with a static arena, CI.
The prototype is ahead of the code: it already has companions and interactive obstacles (design doc §2.1–2.2).
Next: **M1**, porting the prototype rules into `packages/sim`.

## Quick start

Requires Node 22+ and pnpm 10+ (`corepack enable` gives you the pinned pnpm).

```bash
pnpm install
pnpm dev          # client on http://localhost:5173, server on ws://localhost:2567
```

Open the client, press **Create room**, send the `/r/CODE` link to a second tab or a friend on your network.

| Command | What it does |
|---|---|
| `pnpm dev` | Client + server with hot reload |
| `pnpm test` | All unit tests (Vitest) + architecture guards |
| `pnpm typecheck` | TypeScript across every package |
| `pnpm build` | Production build of the client |
| `pnpm check` | typecheck + test + build (what CI runs) |
| `pnpm prototype` | Serves the prototype at http://localhost:5180/prototype/ |

## Deployment

- **Client + prototype → Vercel.** Linked to this repo: every push to `main` deploys production, every branch/PR gets a preview URL. Config in [`vercel.json`](vercel.json). `pnpm build:web` builds the client and lays out the site: `/` = prototype (until M1 makes the client playable), `/prototype/` = same, `/app/` = client, `/r/CODE` → client.
- Vercel project settings: **Root Directory must stay empty** (repo root); build settings come from `vercel.json`.
- **Game server → not on Vercel.** Vercel does not run long-lived WebSocket servers. Until the server is hosted elsewhere (any small VPS / container host), the deployed client shows the arena, the champion list and a link to the prototype, but rooms are unavailable.
- When the server is hosted, set `VITE_SERVER_URL=wss://…` in the Vercel project's environment variables and redeploy.

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
  characters/  glTF characters (M3)
docs/          design doc, ADRs
prototype/     single-file Three.js prototype
tests/         repo-wide guards
```

## Stack

TypeScript (strict) · Three.js · React · Vite · Node + ws · Vitest · pnpm workspaces. Details and reasoning in the design doc.
