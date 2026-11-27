// @smash/protocol — messages between client and server.
// JSON over WebSocket (compressed by permessage-deflate). Binary delta snapshots are a later optimisation:
// a duel's full state is a few kilobytes.

import type { ChampionId } from "@smash/content";
import type { MatchConfig, MatchState, PlayerInput, SimEvent } from "@smash/sim";

export const PROTOCOL_VERSION = 2;
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
  /** A match is running in this room. */
  inMatch: boolean;
}

/** Match state as sent over the wire: everything except the static config (sent once in `start`). */
export type NetState = Omit<MatchState, "config">;

/** One recorded tick for the kill cam replay: the state before it and both players' inputs. */
export interface NetFrame {
  state: NetState;
  inputs: [PlayerInput | null, PlayerInput | null];
}

export type MatchEndReason = "finished" | "opponent_left";

export type ClientMessage =
  | { t: "hello"; version: number; name: string }
  | { t: "create" }
  | { t: "join"; code: string }
  | { t: "pick"; champion: ChampionId }
  | { t: "ready"; ready: boolean }
  | { t: "leave" }
  /** One tick of input. `seq` increases by one per message; the server acknowledges the last one it consumed. */
  | { t: "input"; seq: number; input: PlayerInput };

export type ServerMessage =
  | { t: "welcome"; playerId: PlayerId }
  | { t: "lobby"; lobby: LobbyState }
  | { t: "error"; code: "bad_version" | "bad_message" | "room_not_found" | "room_full" | "not_in_room"; message: string }
  /** The match begins. `team` is the receiving player's team. */
  | { t: "start"; team: 0 | 1; config: MatchConfig; state: NetState }
  /** Authoritative state after tick `state.tick`, the events since the previous snapshot, and the last input consumed. */
  | { t: "snap"; ack: number; state: NetState; events: SimEvent[] }
  /** A round was decided: replay these frames. The server holds the match for `pause` seconds meanwhile. */
  | { t: "killcam"; frames: NetFrame[]; pause: number }
  | { t: "end"; reason: MatchEndReason; winner: 0 | 1 | -1; score: [number, number] };

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

export const stripConfig = (state: MatchState): NetState => {
  const { config: _config, ...rest } = state;
  return rest;
};

export const withConfig = (state: NetState, config: MatchConfig): MatchState => ({ ...state, config });
