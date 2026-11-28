// WebRTC P2P room transport via trystero (public Nostr signaling).
// Exposes typed channels matching packages/protocol so the transport can be swapped later.

import { joinRoom, type JsonValue, type Room } from "trystero";
import type { NetInput, PeerControlMessage, PingPacket } from "@smash/protocol";
import type { GameSnapshot, KillCamPacket } from "./reconcile.ts";

const APP_ID = "smash-arena-p2p-v1";

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

function resolveIceServers(): RTCIceServer[] {
  const raw = import.meta.env.VITE_ICE_SERVERS as string | undefined;
  if (!raw) return DEFAULT_ICE_SERVERS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return [...DEFAULT_ICE_SERVERS, ...(parsed as RTCIceServer[])];
    }
  } catch {
    // Ignore invalid VITE_ICE_SERVERS JSON and fall back to public STUN servers.
  }
  return DEFAULT_ICE_SERVERS;
}

export interface P2PRoom {
  readonly code: string;
  readonly ready: Promise<string>;
  sendControl(msg: PeerControlMessage): void;
  onControl(fn: (msg: PeerControlMessage, fromId: string) => void): () => void;
  sendInput(input: NetInput): void;
  onInput(fn: (input: NetInput, fromId: string) => void): () => void;
  sendSnap(snap: GameSnapshot): void;
  onSnap(fn: (snap: GameSnapshot, fromId: string) => void): () => void;
  /** Host → guest when a round is decided: the replay for the kill cam. Untrusted on arrival: check with isReplay(). */
  sendKillCam(packet: KillCamPacket): void;
  onKillCam(fn: (packet: unknown, fromId: string) => void): () => void;
  sendPing(p: PingPacket): void;
  onPing(fn: (p: PingPacket, fromId: string) => void): () => void;
  sendPong(p: PingPacket): void;
  onPong(fn: (p: PingPacket, fromId: string) => void): () => void;
  onPeerJoin(fn: (peerId: string) => void): () => void;
  onPeerLeave(fn: (peerId: string) => void): () => void;
  onError(fn: (message: string) => void): () => void;
  leave(): void;
}

function makeChannel<T>(room: Room, name: string) {
  const action = room.makeAction<JsonValue>(name);
  const listeners = new Set<(data: T, fromId: string) => void>();
  const unsub = action.onMessage((data, ctx) => {
    for (const fn of [...listeners]) fn(data as unknown as T, ctx.peerId);
  });
  return {
    send(data: T): void {
      void action.send(data as unknown as JsonValue).catch(() => {});
    },
    on(fn: (data: T, fromId: string) => void): () => void {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    dispose(): void {
      listeners.clear();
      unsub();
    },
  };
}

export function createP2PRoom(code: string): P2PRoom {
  const room = joinRoom(
    {
      appId: APP_ID,
      identity: "none",
      rtcConfig: { iceServers: resolveIceServers() },
    },
    code,
  );

  const ready = room.getSelf().then((self) => self.peerId);

  const control = makeChannel<PeerControlMessage>(room, "ctrl");
  const input = makeChannel<NetInput>(room, "inp");
  const snap = makeChannel<GameSnapshot>(room, "snap");
  const killCam = makeChannel<KillCamPacket>(room, "kcam");
  const ping = makeChannel<PingPacket>(room, "ping");
  const pong = makeChannel<PingPacket>(room, "pong");

  const joinListeners = new Set<(peerId: string) => void>();
  const leaveListeners = new Set<(peerId: string) => void>();
  const errorListeners = new Set<(message: string) => void>();

  const unsubJoin = room.onPeerJoin(
    ({ peerId }) => {
      for (const fn of [...joinListeners]) fn(peerId);
    },
    { replay: true },
  );
  const unsubLeave = room.onPeerLeave(({ peerId }) => {
    for (const fn of [...leaveListeners]) fn(peerId);
  });
  const unsubError = room.onError((err) => {
    for (const fn of [...errorListeners]) fn(err.message);
  });

  let left = false;

  return {
    code,
    ready,
    sendControl: control.send,
    onControl: control.on,
    sendInput: input.send,
    onInput: input.on,
    sendSnap: snap.send,
    onSnap: snap.on,
    sendKillCam: killCam.send,
    onKillCam: killCam.on,
    sendPing: ping.send,
    onPing: ping.on,
    sendPong: pong.send,
    onPong: pong.on,
    onPeerJoin(fn) {
      joinListeners.add(fn);
      return () => {
        joinListeners.delete(fn);
      };
    },
    onPeerLeave(fn) {
      leaveListeners.add(fn);
      return () => {
        leaveListeners.delete(fn);
      };
    },
    onError(fn) {
      errorListeners.add(fn);
      return () => {
        errorListeners.delete(fn);
      };
    },
    leave() {
      if (left) return;
      left = true;
      control.dispose();
      input.dispose();
      snap.dispose();
      killCam.dispose();
      ping.dispose();
      pong.dispose();
      joinListeners.clear();
      leaveListeners.clear();
      errorListeners.clear();
      unsubJoin();
      unsubLeave();
      unsubError();
      void room.leave().catch(() => {});
    },
  };
}
