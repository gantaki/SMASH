import { describe, expect, it } from "vitest";
import { ROOM_CODE_LENGTH, decode, encode, isRoomCode, type ClientMessage } from "./index.ts";

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
});
