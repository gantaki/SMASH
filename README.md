# SMASH

Fast top-down arena brawler for quick PvP with friends. Send a link, fight a best-of-3 in a few minutes. Runs in the browser.

- Design, rules, champions and architecture: [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md)
- Why a web stack: [`docs/adr/0001-web-stack.md`](docs/adr/0001-web-stack.md)
- Playable single-file prototype (feel and numbers reference): [`prototype/`](prototype/)

**Status:** M0 (skeleton) done: monorepo, typed champion data, lobby server, client with a static arena, CI.
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
| `pnpm prototype` | Serves the old prototype at http://localhost:5180/prototype/ |

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
