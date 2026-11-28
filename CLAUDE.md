# CLAUDE.md

Instructions for agents working in this repository.

## Read first

- `docs/GAME_DESIGN.md`: vision, rules, champion numbers, architecture, roadmap. It is the source of truth; update it when a decision changes.
- `docs/ART_STYLE.md`: the approved art style for champions, portraits and ability icons.
- `docs/adr/`: recorded decisions. Add a new ADR for any decision that changes the stack or the architecture.

## Commands

```bash
pnpm install
pnpm dev         # client :5173 + server :2567
pnpm check       # typecheck + test + build; must pass before every commit
pnpm sim:batch   # headless bot-vs-bot batch (rule 6); args: [matches] [easy|normal|hard]
```

## Architecture rules (enforced by tests/architecture.test.ts where possible)

1. `packages/sim`, `packages/content`, `packages/protocol` are pure TypeScript: no Three.js, React or DOM. Their tsconfig has no DOM lib.
2. The simulation is deterministic for a given seed and input stream: no `Math.random()`, `Date.now()` or `performance.now()`. Use `createRng` and the fixed tick (`TICK_DT`).
3. All gameplay numbers live in `packages/content`. No magic numbers in sim or client code. (Bot heuristics in `packages/sim/src/bot.ts` and numerical tolerances are the exception: they are not balance.)
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
- Sounds: `assets/sfx/<id>.mp3` + an entry in `apps/client/src/audio/manifest.ts`; abilities reference ids through `sfx`.
- Champion art: `assets/art/portraits/<championId>.webp` (cutout), `assets/art/tiles/<championId>.webp` (select tile), `assets/art/abilities/<iconId>.webp`, interface icons in `assets/art/ui/` + the id in `apps/client/src/ui/art.ts`. The approved style (hand-drawn ink, one palette per champion, one-object icons) is in `docs/ART_STYLE.md`; the generation recipe is in `assets/art/README.md`.
- UI text is Russian (`nameRu`, `descriptionRu`, `roleRu`, `blurbRu`), except the champions' names: a hero's `name` is an English proper noun and is shown as it is (Ember, not a translation), also inside Russian sentences. Identifiers, comments and docs stay English.
- Adding champions, ability kinds, companions: recipe in `docs/GAME_DESIGN.md` §3 "Adding content"; what a kit should contain (slot roles, knockback) in §3 "Character design guide" and §2.3.
- The dev client exposes the running `Game` as `window.__smash` for Playwright checks; look at a change in the browser before calling it done.

## Roadmap pointer

Current milestone is in `README.md` (Status). Milestone definitions: `docs/GAME_DESIGN.md` §7.
