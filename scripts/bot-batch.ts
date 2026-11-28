// Headless bot-vs-bot batch: `pnpm sim:batch [matches] [difficulty]`.
// Run it after balance or bot changes and report the table (CLAUDE.md rule 6).
import { playableChampions, type BotDifficulty } from "@smash/content";
import { runBotMatch } from "@smash/sim";

const matches = Number(process.argv[2] ?? 40);
const difficulty = (process.argv[3] ?? "normal") as BotDifficulty;
const ids = playableChampions.map((c) => c.id);
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "-");
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

console.log(`${matches} matches per pairing, ${difficulty} bots\n`);
const rows: Record<string, string | number>[] = [];
for (let i = 0; i < ids.length; i++) {
  for (let j = i; j < ids.length; j++) {
    const a = ids[i]!;
    const b = ids[j]!;
    let winsA = 0;
    let unfinished = 0;
    let rounds = 0;
    let sdRounds = 0;
    const times: number[] = [];
    const dmg = [0, 0, 0];
    let pushed = 0;
    let unforced = 0;
    let tiles = 0;
    let rim = 0;
    for (let m = 0; m < matches; m++) {
      // Alternate sides so spawn position does not bias the result.
      const flip = m % 2 === 1;
      const r = runBotMatch({ seed: 1000 + m * 7919 + i * 131 + j * 17, champions: flip ? [b, a] : [a, b], difficulty });
      if (r.winner === -1) unfinished++;
      else if ((r.winner === 0) !== flip) winsA++;
      times.push(...r.roundTimes);
      rounds += r.roundTimes.length;
      sdRounds += r.suddenDeathRounds;
      dmg[0] += r.damage[flip ? 1 : 0];
      dmg[1] += r.damage[flip ? 0 : 1];
      dmg[2] += r.damage[2];
      pushed += r.falls.pushed;
      unforced += r.falls.unforced;
      tiles += r.tilesDropped;
      rim += r.rimBroken;
    }
    const sorted = [...times].sort((x, y) => x - y);
    rows.push({
      pairing: `${a} (A) vs ${b}`,
      "win A": pct(winsA, matches - unfinished),
      "round avg s": avg(times).toFixed(1),
      "round p10–p90 s": `${sorted[Math.floor(sorted.length * 0.1)]?.toFixed(0)}–${sorted[Math.floor(sorted.length * 0.9)]?.toFixed(0)}`,
      "sudden death": pct(sdRounds, rounds),
      "dmg/round A": Math.round(dmg[0] / rounds),
      "dmg/round B": Math.round(dmg[1] / rounds),
      "env dmg/round": Math.round(dmg[2] / rounds),
      // Rounds that ended in the abyss: shoved there by the enemy / fell on their own.
      "ring-out": pct(pushed, rounds),
      "fell alone": pct(unforced, rounds),
      "tiles lost/round": (tiles / rounds).toFixed(1),
      "rim lost/round": (rim / rounds).toFixed(1),
      unfinished,
    });
  }
}
console.table(rows);

// 2v2: every way to split the roster into two pairs (when there are four champions to split).
if (ids.length === 4) {
  const [a, b, c, d] = ids as [string, string, string, string];
  const splits: [[string, string], [string, string]][] = [
    [[a, b], [c, d]],
    [[a, c], [b, d]],
    [[a, d], [b, c]],
  ];
  const teams: Record<string, string | number>[] = [];
  for (const [left, right] of splits) {
    let wins = 0;
    let unfinished = 0;
    const times: number[] = [];
    for (let m = 0; m < matches; m++) {
      // Slots alternate teams; alternate which pair gets team 0 so that the spawn side does not bias the result.
      const flip = m % 2 === 1;
      const [t0, t1] = flip ? [right, left] : [left, right];
      const r = runBotMatch({ seed: 5000 + m * 7919, champions: [t0[0], t1[0], t0[1], t1[1]], difficulty });
      if (r.winner === -1) unfinished++;
      else if ((r.winner === 0) !== flip) wins++;
      times.push(...r.roundTimes);
    }
    teams.push({ "2v2": `${left.join(" + ")} (A) vs ${right.join(" + ")}`, "win A": pct(wins, matches - unfinished), "round avg s": avg(times).toFixed(1), unfinished });
  }
  console.table(teams);
}
