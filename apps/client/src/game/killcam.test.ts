import { describe, expect, it } from "vitest";
import { arena } from "@smash/content";
import { TICK_DT, blocker, championOfTeam, createMatch, step, type MatchState } from "@smash/sim";
import { ReplayRecorder, type Replay } from "../net/replay.ts";
import { KILL_CAM, KillCam, frameKill, killCamDuration, planKillCam } from "./killcam.ts";

const duel = (seed = 11): MatchState =>
  createMatch({ seed, mode: "duel", players: [{ champion: "pyra", controller: "bot" }, { champion: "grakk", controller: "bot" }] });

describe("kill cam replay", () => {
  it("re-simulates the final moments into exactly the live state", () => {
    const live = duel();
    const recorder = new ReplayRecorder();
    for (let i = 0; i < 60 * 300; i++) {
      if (live.phase === "fight") recorder.record(live, [null, null]);
      if (step(live, [null, null]).some((e) => e.t === "roundEnd")) break;
    }
    expect(live.phase).toBe("roundEnd");
    const replay = recorder.take()!;
    expect(replay.inputs).toHaveLength(Math.round(KILL_CAM.rewind / TICK_DT));
    const victim = live.units.find((u) => u.kind === "champion" && u.dead)!;
    const cam = planKillCam(replay)!;
    expect(cam.shot.victim).toBe(victim.id);
    let deaths = 0;
    while (cam.replaying) deaths += cam.stepReplay().filter((e) => e.t === "death").length;
    expect(deaths).toBe(1);
    expect(cam.state).toEqual(live);
    // The recorder starts afresh for the next round.
    expect(recorder.take()).toBeNull();
  });

  it("has nothing to show when nobody dies in the recording", () => {
    const s = duel();
    expect(planKillCam({ start: s, inputs: Array.from({ length: 10 }, () => [null, null]) })).toBeNull();
  });

  it("slows down into the blow and returns to normal speed afterwards", () => {
    const s = duel();
    const ticks = Math.round(KILL_CAM.rewind / TICK_DT);
    const replay: Replay = { start: s, inputs: Array.from({ length: ticks }, () => [null, null]) };
    const cam = new KillCam(replay, frameKill(s, championOfTeam(s, 1), championOfTeam(s, 0)));
    expect(cam.timeScale()).toBeCloseTo(KILL_CAM.scaleLead);
    while (cam.replaying) cam.stepReplay();
    expect(cam.timeScale()).toBeCloseTo(KILL_CAM.scaleImpact);
    cam.advance(1);
    expect(cam.timeScale()).toBe(1);
    expect(cam.settled).toBe(true);
  });

  it("knows how long it lasts in real time (the host holds the match for that long online)", () => {
    const ticks = Math.round(KILL_CAM.rewind / TICK_DT);
    const seconds = killCamDuration(ticks);
    // Slower than real time throughout, but not endless.
    expect(seconds).toBeGreaterThan(KILL_CAM.rewind + KILL_CAM.flight + KILL_CAM.recover);
    expect(seconds).toBeLessThan(8);
    expect(killCamDuration(ticks * 2)).toBeGreaterThan(seconds);
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

  it("watches a fall into the abyss from above, looking down into the hole", () => {
    const { s, killer, victim } = setup((s) => {
      Object.assign(championOfTeam(s, 0), { x: -3, z: 12 });
      Object.assign(championOfTeam(s, 1), { x: -3, z: 10 });
    });
    const shot = frameKill(s, victim, killer, true);
    expect(shot.height).toBe(KILL_CAM.fall.height);
    expect(shot.lookHeight).toBeLessThan(0);
    expect(frameKill(s, victim, killer).lookHeight).toBe(KILL_CAM.lookHeight);
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
