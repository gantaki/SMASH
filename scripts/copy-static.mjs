// Lays out the static site after the client build:
//   /            the game client (offline vs bots, training range); /r/CODE room links rewrite here (vercel.json)
//   /prototype/  the original single-file prototype, kept as the feel reference
//   /sfx, /vfx   repo-level assets/, copied by Vite (publicDir)
//   /assets/vfx/ the same Spine assets at the path the prototype loads them from
import { cpSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = join(root, "apps/client/dist");
const noDocs = (src) => !src.endsWith(".md");

if (!existsSync(join(dist, "index.html"))) {
  console.error("apps/client/dist/index.html not found: run the client build first.");
  process.exit(1);
}

cpSync(join(root, "prototype"), join(dist, "prototype"), { recursive: true, filter: noDocs });
cpSync(join(root, "assets/vfx"), join(dist, "assets/vfx"), { recursive: true, filter: noDocs });
console.log("Site layout: / = client, /prototype/ = prototype, /sfx + /vfx = assets");
