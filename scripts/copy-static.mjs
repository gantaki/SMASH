// Lays out the static site after the client build:
//   /            the playable prototype (until M1 makes the real client playable)
//   /prototype/  the same prototype, stable link
//   /app/        the real client (lobby skeleton); /r/CODE room links rewrite here (vercel.json)
//   /assets/vfx/ Spine assets the prototype loads
import { cpSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = join(root, "apps/client/dist");
const noDocs = (src) => !src.endsWith(".md");

if (!existsSync(join(dist, "index.html"))) {
  console.error("apps/client/dist/index.html not found: run the client build first.");
  process.exit(1);
}

mkdirSync(join(dist, "app"), { recursive: true });
renameSync(join(dist, "index.html"), join(dist, "app/index.html"));
cpSync(join(root, "prototype"), join(dist, "prototype"), { recursive: true, filter: noDocs });
cpSync(join(root, "prototype/index.html"), join(dist, "index.html"));
cpSync(join(root, "assets/vfx"), join(dist, "assets/vfx"), { recursive: true, filter: noDocs });
console.log("Site layout: / = prototype, /prototype/ = prototype, /app/ = client, /assets/vfx/ = Spine assets");
