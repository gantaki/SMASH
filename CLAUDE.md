# CLAUDE.md

Instructions for agents working in this repository.

## Read first

- `docs/GAME_DESIGN.md`: vision, rules, champion numbers, architecture, roadmap. It is the source of truth; update it when a decision changes.
- `docs/adr/`: recorded decisions. Add a new ADR for any decision that changes the stack or the architecture.

## Commands

```bash
pnpm install
pnpm dev         # client :5173 + server :2567
pnpm check       # typecheck + test + build; must pass before every commit
```

## Architecture rules (enforced by tests/architecture.test.ts where possible)

1. `packages/sim`, `packages/content`, `packages/protocol` are pure TypeScript: no Three.js, React or DOM. Their tsconfig has no DOM lib.
2. The simulation is deterministic for a given seed and input stream: no `Math.random()`, `Date.now()` or `performance.now()`. Use `createRng` and the fixed tick (`TICK_DT`).
3. All gameplay numbers live in `packages/content`. No magic numbers in sim or client code.
4. The server decides hits and damage. The client predicts and presents; it never mutates sim state from rendering code.
5. Every gameplay change comes with a sim test (unit test or scripted scenario).
6. After balance or bot AI changes, run a headless bot-vs-bot batch and report the results.
7. `prototype/` is reference only. Read it for feel and numbers; never import from it.

## Conventions

- TypeScript strict, ES modules, imports with explicit `.ts` extensions inside packages.
- Workspace packages are consumed as source (`exports` points at `src/index.ts`); there is no build step for them.
- Units: meters, seconds, meters/second; angles in degrees in content data, radians in sim math. Facing angle 0 = +z, PI/2 = +x.
- Code, comments, docs and commit messages in English.
- Spine VFX: keep `.json`/`.skel` + `.atlas` + `.png` together in `assets/vfx/<effect>/`.

## Roadmap pointer

Current milestone is in `README.md` (Status). Milestone definitions: `docs/GAME_DESIGN.md` §7.
