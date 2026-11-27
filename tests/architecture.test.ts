// Guards the rules from docs/GAME_DESIGN.md §9: shared packages stay pure and deterministic.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const PURE_PACKAGES = ["packages/sim/src", "packages/content/src", "packages/protocol/src"];

const FORBIDDEN: [RegExp, string][] = [
  [/from\s+["']three["']/, "imports three"],
  [/from\s+["']react(-dom)?["']/, "imports react"],
  [/\bdocument\./, "touches the DOM (document)"],
  [/\bwindow\./, "touches the DOM (window)"],
  [/Math\.random\s*\(/, "uses Math.random (use the seeded Rng)"],
  [/Date\.now\s*\(/, "uses wall-clock time"],
  [/performance\.now\s*\(/, "uses wall-clock time"],
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("architecture", () => {
  for (const pkg of PURE_PACKAGES) {
    it(`${pkg} stays pure and deterministic`, () => {
      const problems: string[] = [];
      for (const file of sourceFiles(join(root, pkg))) {
        const text = readFileSync(file, "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/(^|[^:])\/\/.*$/gm, "$1");
        for (const [re, why] of FORBIDDEN) if (re.test(text)) problems.push(`${relative(root, file)}: ${why}`);
      }
      expect(problems).toEqual([]);
    });
  }
});
