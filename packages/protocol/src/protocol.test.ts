import { describe, expect, it } from "vitest";
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  decode,
  encode,
  generateRoomCode,
  isRoomCode,
  resolvePeerRole,
  sanitizeNetInput,
  type ClientMessage,
} from "./index.ts";

describe("protocol", () => {
  it("round-trips messages", () => {
    const msg: ClientMessage = { t: "pick", champion: "fang" };
    expect(decode<ClientMessage>(encode(msg))).toEqual(msg);
  });

  it("rejects garbage", () => {
    expect(decode("not json")).toBeNull();
    expect(decode("[1,2]")).toBeNull();
    expect(decode('{"x":1}')).toBeNull();
  });

  it("validates room codes", () => {
    expect(isRoomCode("AB2C".slice(0, ROOM_CODE_LENGTH))).toBe(true);
    expect(isRoomCode("AB0C")).toBe(false);
    expect(isRoomCode("abc")).toBe(false);
  });

  it("generates valid room codes", () => {
    let i = 0;
    const code = generateRoomCode((n) => (i++ * 7) % n);
    expect(code).toHaveLength(ROOM_CODE_LENGTH);
    expect(isRoomCode(code)).toBe(true);
    for (const ch of code) expect(ROOM_CODE_ALPHABET.includes(ch)).toBe(true);
  });

  it("resolves peer roles symmetrically across all wantsHost combinations", () => {
    expect(resolvePeerRole("a", true, "b", false)).toBe("host");
    expect(resolvePeerRole("b", false, "a", true)).toBe("guest");

    expect(resolvePeerRole("z", false, "a", true)).toBe("guest");
    expect(resolvePeerRole("a", true, "z", false)).toBe("host");

    // Both want host or neither wants host -> lexicographical tie-breaker
    for (const both of [true, false]) {
      const rA = resolvePeerRole("aaa", both, "bbb", both);
      const rB = resolvePeerRole("bbb", both, "aaa", both);
      expect(rA).toBe("host");
      expect(rB).toBe("guest");
    }
  });

  it("sanitizes NetInput and rejects malformed payloads", () => {
    expect(sanitizeNetInput(null)).toBeNull();
    expect(sanitizeNetInput({ seq: 0 })).toBeNull();
    expect(sanitizeNetInput({ seq: 1.5 })).toBeNull();
    expect(sanitizeNetInput({ seq: -2 })).toBeNull();

    const ok = sanitizeNetInput({
      seq: 5,
      moveX: 3,
      moveZ: 4,
      aimX: Number.POSITIVE_INFINITY,
      aimZ: 2.5,
      press: ["q", "bogus", "ultimate"],
      holdPrimary: 1,
      cancel: true,
    });
    expect(ok).not.toBeNull();
    expect(ok!.seq).toBe(5);
    expect(Math.hypot(ok!.moveX, ok!.moveZ)).toBeCloseTo(1, 5);
    expect(ok!.aimX).toBe(0);
    expect(ok!.aimZ).toBe(2.5);
    expect(ok!.press).toEqual(["q", "ultimate"]);
    expect(ok!.holdPrimary).toBe(false);
    expect(ok!.cancel).toBe(true);
  });
});
