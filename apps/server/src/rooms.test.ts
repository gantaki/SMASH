import { describe, expect, it } from "vitest";
import { isRoomCode } from "@smash/protocol";
import { createRng } from "@smash/sim";
import { MAX_PLAYERS, RoomRegistry } from "./rooms.ts";

const registry = () => {
  const rng = createRng(7);
  return new RoomRegistry((n) => rng.int(n));
};

describe("RoomRegistry", () => {
  it("creates a room with a valid code and the creator as host", () => {
    const r = registry();
    const lobby = r.create("a", "Alice");
    expect(isRoomCode(lobby.code)).toBe(true);
    expect(lobby.hostId).toBe("a");
    expect(lobby.players).toHaveLength(1);
  });

  it("balances teams as players join", () => {
    const r = registry();
    const { code } = r.create("a", "A");
    r.join(code, "b", "B");
    const lobby = r.join(code, "c", "C");
    if (typeof lobby === "string") throw new Error(lobby);
    expect(lobby.players.map((p) => p.team)).toEqual([0, 1, 0]);
  });

  it("rejects unknown and full rooms", () => {
    const r = registry();
    expect(r.join("ZZZZ", "x", "X")).toBe("room_not_found");
    const { code } = r.create("p0", "P0");
    for (let i = 1; i < MAX_PLAYERS; i++) r.join(code, `p${i}`, `P${i}`);
    expect(r.join(code, "late", "Late")).toBe("room_full");
  });

  it("passes host on and closes empty rooms", () => {
    const r = registry();
    const { code } = r.create("a", "A");
    r.join(code, "b", "B");
    expect(r.leave("a")?.hostId).toBe("b");
    expect(r.leave("b")).toBeNull();
    expect(r.roomCount).toBe(0);
  });

  it("only lets players with a champion be ready, and re-picking clears ready", () => {
    const r = registry();
    r.create("a", "A");
    expect(r.setReady("a", true)?.players[0]?.ready).toBe(false);
    r.pick("a", "pyra");
    expect(r.setReady("a", true)?.players[0]?.ready).toBe(true);
    expect(r.pick("a", "grakk")?.players[0]?.ready).toBe(false);
  });
});
