import { describe, expect, it } from "vitest";
import { arena } from "@smash/content";
import { TICK_DT, blocker, championOfTeam, createMatch, step, type MatchState } from "@smash/sim";
import { KILL_CAM, KillCam, frameKill, type Frame } from "./killcam.ts";

const duel = (seed = 11): MatchState =>
  createMatch({ seed, mode: "duel", players: [{ champion: "ember", controller: "bot" }, { champion: "fang", controller: "bot" }] });

describe("kill cam replay", () => {
  it("re-simulates the final moments into exactly the live state", () => {
    const live = duel();
    const history: Frame[] = [];
    const want = Math.round(KILL_CAM.rewind / TICK_DT);
    for (let i = 0; i < 60 * 300; i++) {
      if (live.phase === "fight") {
        history.push({ state: structuredClone(live), input: null });
        if (history.length > want) history.shift();
      }
      if (step(live, [null, null]).some((e) => e.t === "roundEnd")) break;
    }
    expect(live.phase).toBe("roundEnd");
    expect(history).toHaveLength(want);
    const victim = live.units.find((u) => u.kind === "champion" && u.dead)!;
    const cam = new KillCam(history, frameKill(live, victim, undefined));
    let deaths = 0;
    while (cam.replaying) deaths += cam.stepReplay().filter((e) => e.t === "death").length;
    expect(deaths).toBe(1);
    expect(cam.state).toEqual(live);
  });

  it("slows down into the blow and returns to normal speed afterwards", () => {
    const frames: Frame[] = Array.from({ length: Math.round(KILL_CAM.rewind / TICK_DT) }, () => ({ state: duel(), input: null }));
    const s = frames[0]!.state;
    const cam = new KillCam(frames, frameKill(s, championOfTeam(s, 1), championOfTeam(s, 0)));
    expect(cam.timeScale()).toBeCloseTo(KILL_CAM.scaleLead);
    while (cam.replaying) cam.stepReplay();
    expect(cam.timeScale()).toBeCloseTo(KILL_CAM.scaleImpact);
    for (let i = 0; i < 60; i++) cam.liveTick();
    expect(cam.timeScale()).toBe(1);
    expect(cam.settled).toBe(true);
  });
});

describe("kill cam framing", () => {
  const setup = (place: (s: MatchState) => void) => {
    const s = duel();
    place(s);
    return { s, killer: championOfTeam(s, 0), victim: championOfTeam(s, 1) };
  };
  const camPos = (shot: ReturnType<typeof frameKill>) => ({ x: shot.focus.x + shot.side.x * shot.distance, z: shot.focus.z + shot.side.z * shot.distance });

  it("stands side-on to a close kill, low, inside the arena, with a clear view", () => {
    const { s, killer, victim } = setup((s) => {
      Object.assign(championOfTeam(s, 0), { x: -3, z: 12 });
      Object.assign(championOfTeam(s, 1), { x: -3, z: 10 });
    });
    const shot = frameKill(s, victim, killer);
    expect(shot.killer).toBe(killer.id);
    expect(shot.height).toBe(KILL_CAM.height);
    // The blow goes along z, so the camera looks along x.
    expect(Math.abs(shot.side.x)).toBeCloseTo(1);
    const cam = camPos(shot);
    expect(Math.hypot(cam.x, cam.z)).toBeLessThan(arena.radius);
    expect(blocker(s, cam, victim, 0.15)).toBeNull();
  });

  it("stays on the victim when the killer is far away", () => {
    const { s, killer, victim } = setup((s) => {
      Object.assign(championOfTeam(s, 0), { x: -4, z: 12 });
      Object.assign(championOfTeam(s, 1), { x: -4, z: -2 });
    });
    const shot = frameKill(s, victim, killer);
    expect(shot.killer).toBe(-1);
    expect(Math.hypot(shot.focus.x - victim.x, shot.focus.z - victim.z)).toBeLessThan(2);
  });

  it("picks the other side when a pillar is in the way, and rises above when both are", () => {
    // A stone pillar stands at (7.5, 7.5): put the victim just left of it, the blow along z.
    const { s, killer, victim } = setup((s) => {
      Object.assign(championOfTeam(s, 0), { x: 4.6, z: 9.5 });
      Object.assign(championOfTeam(s, 1), { x: 4.6, z: 7.5 });
    });
    const shot = frameKill(s, victim, killer);
    expect(shot.side.x).toBeLessThan(0);
    expect(blocker(s, camPos(shot), victim, 0.15)).toBeNull();

    // Wall the victim in on both sides: the camera gives up on the low angle.
    for (const x of [1.6, 7.6]) {
      s.obstacles.push({ ...s.obstacles.find((o) => o.kind === "stone")!, id: 9000 + x, x, z: 7.5, homeX: x, homeZ: 7.5 });
    }
    expect(frameKill(s, victim, killer).height).toBe(KILL_CAM.blockedHeight);
  });
});
