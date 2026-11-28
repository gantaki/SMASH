// @smash/server — authoritative room server.
// M0: lobby only (create/join by code, pick champion, ready). M2 runs a sim per room.

import { randomInt, randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { champions, type ChampionId } from "@smash/content";
import {
  DEFAULT_SERVER_PORT,
  PROTOCOL_VERSION,
  decode,
  encode,
  isRoomCode,
  type ClientMessage,
  type LobbyState,
  type PlayerId,
  type ServerMessage,
} from "@smash/protocol";
import { RoomRegistry } from "./rooms.ts";

const port = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);
const rooms = new RoomRegistry((n) => randomInt(n));
const sockets = new Map<PlayerId, WebSocket>();
const names = new Map<PlayerId, string>();

const send = (ws: WebSocket, msg: ServerMessage) => {
  if (ws.readyState === WebSocket.OPEN) ws.send(encode(msg));
};

const broadcast = (lobby: LobbyState | null) => {
  if (!lobby) return;
  for (const p of lobby.players) {
    const ws = sockets.get(p.id);
    if (ws) send(ws, { t: "lobby", lobby });
  }
};

const isChampion = (v: unknown): v is ChampionId => typeof v === "string" && v in champions;

const wss = new WebSocketServer({ port });

wss.on("connection", (ws) => {
  const id = randomUUID();
  sockets.set(id, ws);
  names.set(id, "Player");
  send(ws, { t: "welcome", playerId: id });

  ws.on("message", (data) => {
    const msg = decode<ClientMessage>(String(data));
    if (!msg) return send(ws, { t: "error", code: "bad_message", message: "Unreadable message" });

    switch (msg.t) {
      case "hello":
        if (msg.version !== PROTOCOL_VERSION) {
          return send(ws, { t: "error", code: "bad_version", message: `Server speaks protocol v${PROTOCOL_VERSION}` });
        }
        names.set(id, String(msg.name ?? "Player").slice(0, 24) || "Player");
        return;
      case "create":
        return broadcast(rooms.create(id, names.get(id)!));
      case "join": {
        const code = String(msg.code ?? "").toUpperCase();
        const res = isRoomCode(code) ? rooms.join(code, id, names.get(id)!) : "room_not_found";
        if (typeof res === "string") return send(ws, { t: "error", code: res, message: `Cannot join ${code}` });
        return broadcast(res);
      }
      case "pick": {
        if (!isChampion(msg.champion)) return send(ws, { t: "error", code: "bad_message", message: "Unknown champion" });
        const lobby = rooms.pick(id, msg.champion);
        return lobby ? broadcast(lobby) : send(ws, { t: "error", code: "not_in_room", message: "Join a room first" });
      }
      case "ready": {
        const lobby = rooms.setReady(id, msg.ready === true);
        return lobby ? broadcast(lobby) : send(ws, { t: "error", code: "not_in_room", message: "Join a room first" });
      }
      case "leave":
        return broadcast(rooms.leave(id));
      default:
        return send(ws, { t: "error", code: "bad_message", message: "Unknown message type" });
    }
  });

  ws.on("close", () => {
    broadcast(rooms.leave(id));
    sockets.delete(id);
    names.delete(id);
  });
});

wss.on("listening", () => console.log(`SMASH server listening on ws://localhost:${port}`));
