import { useCallback, useEffect, useRef, useState } from "react";
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

export type ConnectionStatus = "connecting" | "online" | "offline";

const serverUrl = (): string =>
  import.meta.env.VITE_SERVER_URL ?? `ws://${location.hostname}:${DEFAULT_SERVER_PORT}`;

/** Room code from a `/r/ABCD` link, if any. */
const codeFromUrl = (): string | null => {
  const m = location.pathname.match(/^\/r\/([A-Za-z0-9]+)\/?$/);
  const code = m?.[1]?.toUpperCase() ?? null;
  return code && isRoomCode(code) ? code : null;
};

export function useLobby(name: string) {
  const ws = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [lobby, setLobby] = useState<LobbyState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback((msg: ClientMessage) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(encode(msg));
  }, []);

  useEffect(() => {
    const socket = new WebSocket(serverUrl());
    ws.current = socket;
    socket.onopen = () => {
      setStatus("online");
      socket.send(encode({ t: "hello", version: PROTOCOL_VERSION, name }));
      const code = codeFromUrl();
      if (code) socket.send(encode({ t: "join", code }));
    };
    socket.onclose = () => setStatus("offline");
    socket.onmessage = (e) => {
      const msg = decode<ServerMessage>(String(e.data));
      if (!msg) return;
      if (msg.t === "welcome") setPlayerId(msg.playerId);
      if (msg.t === "lobby") {
        setLobby(msg.lobby);
        setError(null);
        history.replaceState(null, "", `/r/${msg.lobby.code}`);
      }
      if (msg.t === "error") setError(msg.message);
    };
    return () => socket.close();
  }, [name]);

  return {
    status,
    playerId,
    lobby,
    error,
    create: () => send({ t: "create" }),
    join: (code: string) => send({ t: "join", code: code.toUpperCase() }),
    pick: (champion: ChampionId) => send({ t: "pick", champion }),
    setReady: (ready: boolean) => send({ t: "ready", ready }),
  };
}
