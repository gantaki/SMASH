// Transport-agnostic online 1v1 gameplay & P2P room messages.
// Shared across WebRTC P2P now and the WebSocket room server later.

import { ABILITY_SLOTS, type AbilitySlot, type ChampionId } from "@smash/content";
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "./index.ts";

/** Send an authoritative snapshot every N simulation ticks (20 Hz at 60 Hz sim). */
export const NET_SNAPSHOT_EVERY_TICKS = 3;

export function generateRoomCode(randomInt: (n: number) => number): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)]!;
  }
  return code;
}

export interface NetInput {
  seq: number;
  moveX: number;
  moveZ: number;
  aimX: number;
  aimZ: number;
  press: AbilitySlot[];
  holdPrimary: boolean;
  cancel: boolean;
}

export interface NetSnapshot<TState = unknown, TEvent = unknown> {
  tick: number;
  ackSeq: number;
  state: TState;
  events: TEvent[];
}

export type PeerControlMessage =
  | { t: "hello"; name: string; champion: ChampionId; ready: boolean; wantsHost: boolean }
  | { t: "state"; name: string; champion: ChampionId; ready: boolean }
  | { t: "matchStart"; seed: number; hostChampion: ChampionId; guestChampion: ChampionId }
  | { t: "rematch" }
  | { t: "leave" };

export interface PingPacket {
  id: number;
  sentAt: number;
}

/** Deterministic host/guest role resolution between two peers in a 1v1 room. */
export function resolvePeerRole(
  selfId: string,
  selfWantsHost: boolean,
  peerId: string,
  peerWantsHost: boolean,
): "host" | "guest" {
  if (selfWantsHost !== peerWantsHost) return selfWantsHost ? "host" : "guest";
  return selfId < peerId ? "host" : "guest";
}

const VALID_SLOTS = new Set<string>(ABILITY_SLOTS);

/** Validates and clamps an untrusted NetInput payload from the network. */
export function sanitizeNetInput(raw: unknown): NetInput | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const seq = r.seq;
  if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 1) return null;

  const moveXRaw = typeof r.moveX === "number" && Number.isFinite(r.moveX) ? r.moveX : 0;
  const moveZRaw = typeof r.moveZ === "number" && Number.isFinite(r.moveZ) ? r.moveZ : 0;
  const len = Math.hypot(moveXRaw, moveZRaw);
  const moveX = len > 1 ? moveXRaw / len : moveXRaw;
  const moveZ = len > 1 ? moveZRaw / len : moveZRaw;

  const aimX = typeof r.aimX === "number" && Number.isFinite(r.aimX) ? r.aimX : 0;
  const aimZ = typeof r.aimZ === "number" && Number.isFinite(r.aimZ) ? r.aimZ : 0;

  const press: AbilitySlot[] = [];
  if (Array.isArray(r.press)) {
    for (const s of r.press) {
      if (typeof s === "string" && VALID_SLOTS.has(s)) {
        press.push(s as AbilitySlot);
        if (press.length >= 4) break;
      }
    }
  }

  return {
    seq,
    moveX,
    moveZ,
    aimX,
    aimZ,
    press,
    holdPrimary: r.holdPrimary === true,
    cancel: r.cancel === true,
  };
}
