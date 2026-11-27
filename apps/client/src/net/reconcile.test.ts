import { describe, expect, it } from "vitest";
import { championOfTeam, emptyInput, type PlayerInput } from "@smash/sim";
import { GuestSession, HostSession, type GameSnapshot, type OnlineMatchConfig } from "./reconcile.ts";

const CFG: OnlineMatchConfig = {
  seed: 123456,
  hostChampion: "ember",
  guestChampion: "fang",
};

const moveInput = (x: number, z: number, aimX = 0, aimZ = 0): PlayerInput => ({
  move: { x, z },
  aim: { x: aimX, z: aimZ },
  press: [],
  holdPrimary: false,
  cancel: false,
});

describe("netcode reconciliation", () => {
  it("converges Guest and Host state under simulated latency", () => {
    const host = new HostSession(CFG);
    const guest = new GuestSession(CFG);

    const inputDelay = 3;
    const snapDelay = 3;
    const inFlightInputs: { deliverAt: number; payload: unknown }[] = [];
    const inFlightSnaps: { deliverAt: number; payload: GameSnapshot }[] = [];

    // Run through countdown (3s = 180 ticks) + 60 ticks of movement + 20 ticks idle quiescence
    for (let t = 0; t < 260; t++) {
      // Deliver inputs arriving at tick t to host
      while (inFlightInputs.length && inFlightInputs[0]!.deliverAt <= t) {
        host.pushGuestInput(inFlightInputs.shift()!.payload);
      }
      // Deliver snapshots arriving at tick t to guest
      while (inFlightSnaps.length && inFlightSnaps[0]!.deliverAt <= t) {
        guest.applySnapshot(inFlightSnaps.shift()!.payload);
      }

      const guestLocal =
        t >= 180 && t < 240 ? moveInput(1, 0, 2, 4) : moveInput(0, 0, 0, 6);
      const hostLocal =
        t >= 180 && t < 240 ? moveInput(-1, 0, -2, -4) : moveInput(0, 0, 0, -6);

      const net = guest.stepLocal(guestLocal);
      inFlightInputs.push({ deliverAt: t + inputDelay, payload: net });

      const { snapshot } = host.stepTick(hostLocal);
      if (snapshot) inFlightSnaps.push({ deliverAt: t + snapDelay, payload: snapshot });
    }

    // Flush remaining snapshots and inputs so both settle
    for (let t = 260; t < 275; t++) {
      while (inFlightInputs.length && inFlightInputs[0]!.deliverAt <= t) {
        host.pushGuestInput(inFlightInputs.shift()!.payload);
      }
      while (inFlightSnaps.length && inFlightSnaps[0]!.deliverAt <= t) {
        guest.applySnapshot(inFlightSnaps.shift()!.payload);
      }
      const net = guest.stepLocal(emptyInput());
      inFlightInputs.push({ deliverAt: t + inputDelay, payload: net });
      const { snapshot } = host.stepTick(emptyInput());
      if (snapshot) inFlightSnaps.push({ deliverAt: t + snapDelay, payload: snapshot });
    }
    while (inFlightSnaps.length) {
      guest.applySnapshot(inFlightSnaps.shift()!.payload);
    }

    const hostG = championOfTeam(host.state, 1);
    const guestG = championOfTeam(guest.state, 1);
    const hostH = championOfTeam(host.state, 0);
    const guestH = championOfTeam(guest.state, 0);

    expect(guestG.x).toBeCloseTo(hostG.x, 4);
    expect(guestG.z).toBeCloseTo(hostG.z, 4);
    expect(guestG.hp).toBe(hostG.hp);
    expect(guestH.x).toBeCloseTo(hostH.x, 4);
    expect(guestH.z).toBeCloseTo(hostH.z, 4);
    expect(guest.state.phase).toBe("fight");
  });

  it("replays unacknowledged inputs cleanly without snapping Guest backwards", () => {
    const host = new HostSession(CFG);
    const guest = new GuestSession(CFG);

    // Advance past countdown in lockstep
    for (let t = 0; t < 180; t++) {
      host.pushGuestInput(guest.stepLocal(emptyInput()));
      const { snapshot } = host.stepTick(emptyInput());
      if (snapshot) guest.applySnapshot(snapshot);
    }

    // Guest moves right for 6 ticks; host only receives first 3 inputs
    const queued: unknown[] = [];
    for (let t = 0; t < 6; t++) {
      queued.push(guest.stepLocal(moveInput(1, 0)));
    }
    const predictedX = championOfTeam(guest.state, 1).x;
    expect(predictedX).toBeGreaterThan(0);

    let lastSnap: GameSnapshot | null = null;
    for (let t = 0; t < 3; t++) {
      host.pushGuestInput(queued[t]);
      const { snapshot } = host.stepTick(emptyInput());
      if (snapshot) lastSnap = snapshot;
    }
    expect(lastSnap).not.toBeNull();
    // Apply snapshot that only acknowledged the first 3 inputs; 3 remain unacknowledged
    guest.applySnapshot(lastSnap!);
    expect(guest.pendingCount).toBe(3);
    expect(championOfTeam(guest.state, 1).x).toBeCloseTo(predictedX, 4);
  });

  it("ignores stale or out-of-order snapshots", () => {
    const host = new HostSession(CFG);
    const guest = new GuestSession(CFG);

    const snaps: GameSnapshot[] = [];
    for (let t = 0; t < 9; t++) {
      host.pushGuestInput(guest.stepLocal(emptyInput()));
      const { snapshot } = host.stepTick(emptyInput());
      if (snapshot) snaps.push(snapshot);
    }

    expect(snaps.length).toBeGreaterThanOrEqual(3);
    const newest = snaps[snaps.length - 1]!;
    const older = snaps[0]!;

    expect(guest.applySnapshot(newest)).not.toBeNull();
    expect(guest.applySnapshot(older)).toBeNull();
    expect(guest.applySnapshot(newest)).toBeNull();
  });

  it("preserves press and cancel edges when trimming a burst guest input queue", () => {
    const host = new HostSession(CFG);
    // Advance past countdown
    for (let t = 0; t < 180; t++) host.stepTick(emptyInput());

    // Burst 8 inputs: slots 1 & 2 (which will be dropped during trim) carry 'q' and cancel: true
    for (let seq = 1; seq <= 8; seq++) {
      host.pushGuestInput({
        seq,
        moveX: 0,
        moveZ: 0,
        aimX: 0,
        aimZ: 5,
        press: seq === 1 ? ["q"] : [],
        holdPrimary: false,
        cancel: seq === 2,
      });
    }

    const { events } = host.stepTick(emptyInput());
    const guest = championOfTeam(host.state, 1);
    // Queue trimmed to 4 (dropping seq 1..4), so head (seq 5) absorbed 'q' and cancel=true.
    // On this tick, tryCast('q') starts or cancel ran before buffer; verify 'q' was processed (cast or cooldown started).
    const castQ = events.some((e) => e.t === "castStart" && e.unit === guest.id && e.slot === "q");
    expect(castQ || guest.cast?.slot === "q" || guest.cooldowns.q > 0).toBe(true);
  });

  it("delivers authoritative SimEvents exactly once per snapshot batch", () => {
    const host = new HostSession(CFG);
    const guest = new GuestSession(CFG);

    let hostEventCount = 0;
    let guestEventCount = 0;
    for (let t = 0; t < 185; t++) {
      host.pushGuestInput(guest.stepLocal(emptyInput()));
      const { events, snapshot } = host.stepTick(emptyInput());
      hostEventCount += events.length;
      if (snapshot) {
        const res = guest.applySnapshot(snapshot);
        if (res) guestEventCount += res.events.length;
      }
    }

    expect(hostEventCount).toBeGreaterThan(0);
    // At tick 185, tick 184 & 185 haven't been flushed unless critical, so trigger next snapshot at tick 186
    host.pushGuestInput(guest.stepLocal(emptyInput()));
    const last = host.stepTick(emptyInput());
    hostEventCount += last.events.length;
    if (last.snapshot) {
      const res = guest.applySnapshot(last.snapshot);
      if (res) guestEventCount += res.events.length;
    }

    expect(guestEventCount).toBe(hostEventCount);
  });
});
