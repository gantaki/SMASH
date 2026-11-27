# Prototype

Single-file playable prototype: 3D arena, 1v1 vs a bot, two champions (Ember, Fang), best-of-3, orb, shrinking zone, three bot difficulties. Fang's Cleave plays the **Ink Blade Hit** Spine effect on hit.

It is the **reference for feel and numbers** while porting to `packages/sim` (M1). Do not import from it.

## Run

The page loads its Spine assets from `../assets`, so serve it from the repo root:

```bash
pnpm prototype   # http://localhost:5180/prototype/
```

Three.js r128 is loaded from cdnjs, so the page needs internet access.

## What's inside `index.html`

- Game rules, abilities, statuses, bot AI: all in one `<script>`; numbers match `packages/content`.
- A minimal Spine 4.2 JSON player (region attachments; translate/rotate/scale with bezier curves; attachment sequences; rgba; additive slots), rendered as a camera-facing billboard. It replaces nothing in the real client: M3 uses the official `spine-threejs` runtime.
- Atlas regions for Ink Blade Hit are hardcoded (`INK_REG`); the same coordinates are in `assets/vfx/ink_blade_hit/ink_blade_hit.atlas`.
