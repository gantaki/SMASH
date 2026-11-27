// Connection to the game server: lobby state for the menu, match messages for the running game.

import type { ChampionId } from "@smash/content";
import {
  DEFAULT_SERVER_PORT,
  PROTOCOL_VERSION,
  decode,
  encode,
  isRoomCode,
  type ClientMessage,
  type LobbyState,
  type ServerMessage,
} from "@smash/protocol";
import type { PlayerInput } from "@smash/sim";

export type NetStatus = "idle" | "connecting" | "online" | "offline" | "no-server";
export type StartMessage = Extract<ServerMessage, { t: "start" }>;
export type MatchMessage = Extract<ServerMessage, { t: "snap" | "killcam" | "end" }>;

const SERVER_KEY = "smash.server";

/**
 * Where the game server is. In order: `?server=wss://…` in the address (remembered for next time, handy for
 * testing against a tunnel), the build-time VITE_SERVER_URL, and in local dev ws://<page host>:2567.
 * An https page with none of these has no server to talk to.
 */
export function serverUrl(): string | null {
  const fromQuery = new URLSearchParams(location.search).get("server");
  try {
    if (fromQuery) localStorage.setItem(SERVER_KEY, fromQuery);
    const saved = fromQuery ?? localStorage.getItem(SERVER_KEY);
    if (saved) return saved;
  } catch {
    if (fromQuery) return fromQuery;
  }
  const configured = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (configured) return configured;
  if (location.protocol === "https:") return null;
  return `ws://${location.hostname}:${DEFAULT_SERVER_PORT}`;
}

/** Room code from a `/r/ABCD` link, if any. */
export function codeFromUrl(): string | null {
  const m = location.pathname.match(/^\/r\/([A-Za-z0-9]+)\/?$/);
  const code = m?.[1]?.toUpperCase() ?? null;
  return code && isRoomCode(code) ? code : null;
}

export class NetClient {
  status: NetStatus = "idle";
  playerId: string | null = null;
  lobby: LobbyState | null = null;
  error: string | null = null;
  /** Lobby, status or error changed (the menu re-renders). */
  onChange: (() => void) | null = null;
  /** The server started a match for this player. */
  onStart: ((msg: StartMessage) => void) | null = null;
  /** Snapshots, kill cam replays and the end of the match, for the running game. */
  onMatch: ((msg: MatchMessage) => void) | null = null;
  private ws: WebSocket | null = null;

  constructor(private readonly name: string) {}

  private set(patch: Partial<Pick<NetClient, "status" | "playerId" | "lobby" | "error">>): void {
    Object.assign(this, patch);
    this.onChange?.();
  }

  private send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encode(msg));
  }

  /** Opens the connection (no-op if it is already open or opening). Joins the room from a /r/CODE link. */
  connect(): void {
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) return;
    const url = serverUrl();
    if (!url) return this.set({ status: "no-server" });
    this.set({ status: "connecting", error: null });
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      return this.set({ status: "offline", error: `Некорректный адрес сервера: ${url}` });
    }
    this.ws = socket;
    socket.onopen = () => {
      this.set({ status: "online" });
      this.send({ t: "hello", version: PROTOCOL_VERSION, name: this.name });
      const code = codeFromUrl();
      if (code) this.send({ t: "join", code });
    };
    socket.onclose = () => {
      if (this.ws !== socket) return;
      this.ws = null;
      const wasInMatch = this.lobby?.inMatch;
      this.set({ status: "offline", lobby: null });
      // The connection dropped mid-match: tell the game it is over.
      if (wasInMatch) this.onMatch?.({ t: "end", reason: "opponent_left", winner: -1, score: [0, 0] });
    };
    socket.onmessage = (e) => {
      const msg = decode<ServerMessage>(String(e.data));
      if (!msg) return;
      switch (msg.t) {
        case "welcome":
          return this.set({ playerId: msg.playerId });
        case "lobby":
          history.replaceState(null, "", `/r/${msg.lobby.code}${location.search}`);
          return this.set({ lobby: msg.lobby, error: null });
        case "error":
          return this.set({ error: msg.message });
        case "start":
          return this.onStart?.(msg);
        default:
          return this.onMatch?.(msg);
      }
    };
  }

  close(): void {
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }

  get me() {
    return this.lobby?.players.find((p) => p.id === this.playerId) ?? null;
  }

  create(): void {
    this.send({ t: "create" });
  }

  join(code: string): void {
    this.send({ t: "join", code: code.toUpperCase() });
  }

  pick(champion: ChampionId): void {
    this.send({ t: "pick", champion });
  }

  setReady(ready: boolean): void {
    this.send({ t: "ready", ready });
  }

  /** Leaves the room (and forfeits a running match). */
  leave(): void {
    this.send({ t: "leave" });
    history.replaceState(null, "", `/${location.search}`);
    this.set({ lobby: null });
  }

  sendInput(seq: number, input: PlayerInput): void {
    this.send({ t: "input", seq, input });
  }
}
