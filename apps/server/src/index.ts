// @smash/server — authoritative room server: lobby (create/join by code, pick, ready) and one NetMatch per room.
// Plain HTTP answers health checks on the same port, so container hosts can probe it.

import { randomInt, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { champions, rules, type ChampionId } from "@smash/content";
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
import type { Team } from "@smash/sim";
import { NetMatch } from "./match.ts";
import { RoomRegistry } from "./rooms.ts";

const port = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);
const rooms = new RoomRegistry((n) => randomInt(n));
const sockets = new Map<PlayerId, WebSocket>();
const names = new Map<PlayerId, string>();
/** Running matches by room code, and each player's seat in theirs. */
const matches = new Map<string, NetMatch>();
const seats = new Map<PlayerId, { code: string; team: Team }>();

const send = (ws: WebSocket | undefined, msg: ServerMessage) => {
  if (ws?.readyState === WebSocket.OPEN) ws.send(encode(msg));
};

const broadcast = (lobby: LobbyState | null) => {
  if (!lobby) return;
  for (const p of lobby.players) send(sockets.get(p.id), { t: "lobby", lobby });
};

const isChampion = (v: unknown): v is ChampionId => typeof v === "string" && v in champions;

function startMatch(lobby: LobbyState): void {
  const byTeam = (team: Team) => lobby.players.find((p) => p.team === team)!;
  const ids: [PlayerId, PlayerId] = [byTeam(0).id, byTeam(1).id];
  const match = new NetMatch(
    {
      seed: randomInt(0xffffffff),
      mode: "duel",
      players: [
        { champion: byTeam(0).champion!, controller: "human" },
        { champion: byTeam(1).champion!, controller: "human" },
      ],
    },
    (team, msg) => send(sockets.get(ids[team]), msg),
  );
  matches.set(lobby.code, match);
  ids.forEach((id, team) => seats.set(id, { code: lobby.code, team: team as Team }));
  rooms.setInMatch(lobby, true);
  broadcast(lobby);
  match.start();
}

function endMatch(code: string): void {
  matches.delete(code);
  for (const [id, seat] of seats) if (seat.code === code) seats.delete(id);
}

/** The player is gone (left or disconnected): their opponent wins by default and returns to the lobby. */
function dropFromMatch(id: PlayerId): void {
  const seat = seats.get(id);
  if (!seat) return;
  matches.get(seat.code)?.abandon(seat.team);
  endMatch(seat.code);
}

// Fixed-step loop: catch up on missed ticks, but never spiral after a long stall.
const TICK_MS = 1000 / rules.tickRate;
const MAX_CATCH_UP = 8;
let last = performance.now();
let owed = 0;
setInterval(() => {
  const now = performance.now();
  owed = Math.min(owed + (now - last) / TICK_MS, MAX_CATCH_UP);
  last = now;
  for (; owed >= 1; owed--) {
    for (const [code, match] of matches) {
      match.tick();
      if (!match.finished) continue;
      endMatch(code);
      const lobby = rooms.byCode(code);
      if (lobby) {
        rooms.setInMatch(lobby, false);
        broadcast(lobby);
      }
    }
  }
}, TICK_MS / 2);

const http = createServer((req, res) => {
  res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
  res.end(JSON.stringify({ ok: true, protocol: PROTOCOL_VERSION, rooms: rooms.roomCount, matches: matches.size, path: req.url }));
});
// A duel snapshot is a few kB of JSON thirty times a second: compression is worth it.
const wss = new WebSocketServer({ server: http, perMessageDeflate: { threshold: 256 } });

wss.on("connection", (ws) => {
  const id = randomUUID();
  sockets.set(id, ws);
  names.set(id, "Player");
  send(ws, { t: "welcome", playerId: id });

  const leave = () => {
    const lobby = rooms.roomOf(id);
    dropFromMatch(id);
    if (lobby?.inMatch) rooms.setInMatch(lobby, false);
    broadcast(rooms.leave(id));
  };

  ws.on("message", (data) => {
    const msg = decode<ClientMessage>(String(data));
    if (!msg) return send(ws, { t: "error", code: "bad_message", message: "Unreadable message" });

    switch (msg.t) {
      case "hello":
        if (msg.version !== PROTOCOL_VERSION) {
          return send(ws, { t: "error", code: "bad_version", message: `Server speaks protocol v${PROTOCOL_VERSION}; reload the page` });
        }
        names.set(id, String(msg.name ?? "Player").slice(0, 24) || "Player");
        return;
      case "input": {
        const seat = seats.get(id);
        if (seat) matches.get(seat.code)?.onInput(seat.team, msg.seq, msg.input);
        return;
      }
      case "create":
        leave();
        return broadcast(rooms.create(id, names.get(id)!));
      case "join": {
        const code = String(msg.code ?? "").toUpperCase();
        if (rooms.roomOf(id)?.code !== code) leave();
        const res = isRoomCode(code) ? rooms.join(code, id, names.get(id)!) : "room_not_found";
        if (typeof res === "string") return send(ws, { t: "error", code: res, message: res === "room_full" ? `Room ${code} is full` : `Room ${code} not found` });
        return broadcast(res);
      }
      case "pick": {
        if (!isChampion(msg.champion) || !champions[msg.champion].playable) {
          return send(ws, { t: "error", code: "bad_message", message: "Unknown champion" });
        }
        const lobby = rooms.pick(id, msg.champion);
        return lobby ? broadcast(lobby) : send(ws, { t: "error", code: "not_in_room", message: "Join a room first" });
      }
      case "ready": {
        const lobby = rooms.setReady(id, msg.ready === true);
        if (!lobby) return send(ws, { t: "error", code: "not_in_room", message: "Join a room first" });
        if (rooms.canStart(lobby)) return startMatch(lobby);
        return broadcast(lobby);
      }
      case "leave":
        return leave();
      default:
        return send(ws, { t: "error", code: "bad_message", message: "Unknown message type" });
    }
  });

  ws.on("close", () => {
    leave();
    sockets.delete(id);
    names.delete(id);
  });
});

http.listen(port, () => console.log(`SMASH server listening on :${port} (ws + http health check)`));
