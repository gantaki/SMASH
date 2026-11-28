// @smash/protocol — messages between client and server.
// M0: JSON lobby messages. M2 adds per-tick input/snapshot messages with binary codecs.

import type { ChampionId } from "@smash/content";

export const PROTOCOL_VERSION = 1;
export const DEFAULT_SERVER_PORT = 2567;

/** Room codes avoid look-alike characters (0/O, 1/I/L). */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 4;

export const isRoomCode = (s: string): boolean =>
  s.length === ROOM_CODE_LENGTH && [...s].every((ch) => ROOM_CODE_ALPHABET.includes(ch));

export type PlayerId = string;

export interface LobbyPlayer {
  id: PlayerId;
  name: string;
  team: 0 | 1;
  champion: ChampionId | null;
  ready: boolean;
}

export interface LobbyState {
  code: string;
  hostId: PlayerId;
  players: LobbyPlayer[];
}

export type ClientMessage =
  | { t: "hello"; version: number; name: string }
  | { t: "create" }
  | { t: "join"; code: string }
  | { t: "pick"; champion: ChampionId }
  | { t: "ready"; ready: boolean }
  | { t: "leave" };

export type ServerMessage =
  | { t: "welcome"; playerId: PlayerId }
  | { t: "lobby"; lobby: LobbyState }
  | { t: "error"; code: "bad_version" | "bad_message" | "room_not_found" | "room_full" | "not_in_room"; message: string };

export const encode = (msg: ClientMessage | ServerMessage): string => JSON.stringify(msg);

/** Parses a message; returns null if it is not an object with a string `t`. Fields are validated by the receiver. */
export function decode<T extends ClientMessage | ServerMessage>(raw: string): T | null {
  try {
    const v: unknown = JSON.parse(raw);
    return typeof v === "object" && v !== null && typeof (v as { t?: unknown }).t === "string" ? (v as T) : null;
  } catch {
    return null;
  }
}

export * from "./net.ts";

