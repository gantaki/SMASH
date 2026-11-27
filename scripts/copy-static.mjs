// Copies the prototype and its Spine assets next to the client build,
// so a static host serves /prototype/ and /assets/vfx/ alongside the app.
import { cpSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = join(root, "apps/client/dist");

if (!existsSync(dist)) {
  console.error("apps/client/dist not found: run the client build first.");
  process.exit(1);
}

cpSync(join(root, "prototype"), join(dist, "prototype"), { recursive: true, filter: (src) => !src.endsWith(".md") });
cpSync(join(root, "assets/vfx"), join(dist, "assets/vfx"), { recursive: true, filter: (src) => !src.endsWith(".md") });
console.log("Copied prototype/ and assets/vfx/ into apps/client/dist");
