// React hook managing the WebRTC P2P room lifecycle (create/join by /r/CODE, ready, match start, rematch, ping).

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChampionId } from "@smash/content";
import { generateRoomCode, isRoomCode, resolvePeerRole, type PeerControlMessage } from "@smash/protocol";
import { createP2PRoom, type P2PRoom } from "./p2p.ts";

export type OnlineStatus = "idle" | "waiting" | "connected" | "disconnected";

export interface OnlinePlayer {
  id: string;
  name: string;
  champion: ChampionId;
  ready: boolean;
}

export interface ActiveOnlineMatch {
  seed: number;
  hostChampion: ChampionId;
  guestChampion: ChampionId;
  role: "host" | "guest";
  room: P2PRoom;
}

export interface RematchState {
  mine: boolean;
  theirs: boolean;
}

export function codeFromUrl(): string | null {
  const m = location.pathname.match(/^\/r\/([A-Za-z0-9]+)\/?$/);
  const code = m?.[1]?.toUpperCase() ?? null;
  return code && isRoomCode(code) ? code : null;
}

export function useOnlineRoom(initialChampion: ChampionId) {
  const [name] = useState(() => `Игрок${Math.floor(Math.random() * 900 + 100)}`);
  const [code, setCode] = useState<string | null>(null);
  const [status, setStatus] = useState<OnlineStatus>("idle");
  const [role, setRole] = useState<"host" | "guest" | null>(null);
  const [pingMs, setPingMs] = useState<number | null>(null);
  const [me, setMe] = useState<{ name: string; champion: ChampionId; ready: boolean }>({
    name,
    champion: initialChampion,
    ready: false,
  });
  const [opponent, setOpponent] = useState<OnlinePlayer | null>(null);
  const [activeMatch, setActiveMatch] = useState<ActiveOnlineMatch | null>(null);
  const [rematchState, setRematchState] = useState<RematchState>({ mine: false, theirs: false });
  const [error, setError] = useState<string | null>(null);

  const roomRef = useRef<P2PRoom | null>(null);
  const wantsHostRef = useRef(false);
  const roleRef = useRef<"host" | "guest" | null>(null);
  const meRef = useRef(me);
  const opponentRef = useRef<OnlinePlayer | null>(opponent);
  const activeMatchRef = useRef<ActiveOnlineMatch | null>(activeMatch);
  const rematchRef = useRef(rematchState);

  meRef.current = me;
  opponentRef.current = opponent;
  activeMatchRef.current = activeMatch;
  rematchRef.current = rematchState;
  roleRef.current = role;

  const startMatchAsHost = useCallback((room: P2PRoom, opp: OnlinePlayer) => {
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const hostChampion = meRef.current.champion;
    const guestChampion = opp.champion;
    room.sendControl({ t: "matchStart", seed, hostChampion, guestChampion });
    setMe((prev) => ({ ...prev, ready: false }));
    setOpponent((prev) => (prev ? { ...prev, ready: false } : null));
    setRematchState({ mine: false, theirs: false });
    setActiveMatch({ seed, hostChampion, guestChampion, role: "host", room });
  }, []);

  const teardownRoom = useCallback((resetUrl: boolean) => {
    const existing = roomRef.current;
    if (existing) {
      try {
        existing.sendControl({ t: "leave" });
      } catch {
        // Ignore send errors while leaving.
      }
      existing.leave();
      roomRef.current = null;
    }
    setCode(null);
    setStatus("idle");
    setRole(null);
    setPingMs(null);
    setOpponent(null);
    setActiveMatch(null);
    setRematchState({ mine: false, theirs: false });
    setMe((prev) => ({ ...prev, ready: false }));
    if (resetUrl && location.pathname.startsWith("/r/")) {
      history.replaceState(null, "", "/");
    }
  }, []);

  const connectRoom = useCallback(
    (roomCode: string, wantsHost: boolean) => {
      teardownRoom(false);
      wantsHostRef.current = wantsHost;
      setCode(roomCode);
      setStatus("waiting");
      setRole(wantsHost ? "host" : null);
      setError(null);
      setOpponent(null);
      setActiveMatch(null);
      setRematchState({ mine: false, theirs: false });
      setMe((prev) => ({ ...prev, ready: false }));
      history.replaceState(null, "", `/r/${roomCode}`);

      const room = createP2PRoom(roomCode);
      roomRef.current = room;

      const sendHello = () => {
        const cur = meRef.current;
        room.sendControl({
          t: "hello",
          name: cur.name,
          champion: cur.champion,
          ready: cur.ready,
          wantsHost: wantsHostRef.current,
        });
      };

      room.onPeerJoin(() => {
        sendHello();
      });

      room.onPeerLeave((peerId) => {
        if (roomRef.current !== room) return;
        if (opponentRef.current?.id === peerId) {
          setOpponent(null);
          setStatus("disconnected");
          setPingMs(null);
          setRematchState({ mine: false, theirs: false });
        }
      });

      room.onError((msg) => {
        if (roomRef.current !== room) return;
        if (msg.includes("turn") || msg.includes("peer-connect")) {
          setError("Не удалось установить прямое P2P-соединение (возможен строгий NAT/файрвол).");
        } else {
          setError(`Ошибка сети: ${msg}`);
        }
      });

      room.onControl((msg: PeerControlMessage, fromId: string) => {
        if (roomRef.current !== room) return;
        if (opponentRef.current && opponentRef.current.id !== fromId) return;

        if (msg.t === "hello") {
          void room.ready.then((selfId) => {
            if (roomRef.current !== room) return;
            const resolved = resolvePeerRole(selfId, wantsHostRef.current, fromId, msg.wantsHost);
            const opp: OnlinePlayer = {
              id: fromId,
              name: msg.name,
              champion: msg.champion,
              ready: msg.ready,
            };
            roleRef.current = resolved;
            opponentRef.current = opp;
            setRole(resolved);
            setOpponent(opp);
            setStatus("connected");
            setError(null);
            // Reply with current state so the peer always has our latest pick & ready flag.
            const cur = meRef.current;
            room.sendControl({ t: "state", name: cur.name, champion: cur.champion, ready: cur.ready });
            if (resolved === "host" && !activeMatchRef.current && cur.ready && opp.ready) {
              startMatchAsHost(room, opp);
            }
          });
          return;
        }

        if (msg.t === "state") {
          const prev = opponentRef.current;
          const opp: OnlinePlayer = {
            id: fromId,
            name: msg.name,
            champion: msg.champion,
            ready: msg.ready,
          };
          opponentRef.current = opp;
          setOpponent(opp);
          setStatus("connected");
          if (!prev) sendHello();
          if (roleRef.current === "host" && !activeMatchRef.current && meRef.current.ready && opp.ready) {
            startMatchAsHost(room, opp);
          }
          return;
        }

        if (msg.t === "matchStart") {
          setMe((prev) => ({ ...prev, ready: false }));
          setOpponent((prev) => (prev ? { ...prev, ready: false } : null));
          setRematchState({ mine: false, theirs: false });
          setActiveMatch({
            seed: msg.seed,
            hostChampion: msg.hostChampion,
            guestChampion: msg.guestChampion,
            role: "guest",
            room,
          });
          return;
        }

        if (msg.t === "rematch") {
          const next = { ...rematchRef.current, theirs: true };
          rematchRef.current = next;
          setRematchState(next);
          if (roleRef.current === "host" && next.mine && opponentRef.current) {
            startMatchAsHost(room, opponentRef.current);
          }
          return;
        }

        if (msg.t === "leave") {
          setOpponent(null);
          setStatus("disconnected");
          setPingMs(null);
          setRematchState({ mine: false, theirs: false });
        }
      });

      room.onPing((p) => {
        room.sendPong(p);
      });
      room.onPong((p) => {
        setPingMs(Math.max(1, Math.round(performance.now() - p.sentAt)));
      });
    },
    [startMatchAsHost, teardownRoom],
  );

  // Periodic ping while connected.
  useEffect(() => {
    if (status !== "connected" || !roomRef.current) return;
    const room = roomRef.current;
    let seq = 0;
    const send = () => room.sendPing({ id: ++seq, sentAt: performance.now() });
    send();
    const timer = window.setInterval(send, 2000);
    return () => window.clearInterval(timer);
  }, [status, code]);

  // Auto-join from /r/CODE on initial mount.
  const autoJoined = useRef(false);
  useEffect(() => {
    if (autoJoined.current) return;
    autoJoined.current = true;
    const urlCode = codeFromUrl();
    if (urlCode) connectRoom(urlCode, false);
  }, [connectRoom]);

  // Clean up on unmount / tab close.
  useEffect(() => {
    const onUnload = () => {
      try {
        roomRef.current?.sendControl({ t: "leave" });
      } catch {
        // Ignore.
      }
      roomRef.current?.leave();
    };
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      onUnload();
    };
  }, []);

  const createRoom = useCallback(
    (champion: ChampionId) => {
      setMe((prev) => ({ ...prev, champion, ready: false }));
      const nextCode = generateRoomCode((n) => Math.floor(Math.random() * n));
      connectRoom(nextCode, true);
    },
    [connectRoom],
  );

  const joinRoomByCode = useCallback(
    (rawCode: string, champion: ChampionId) => {
      const normalized = rawCode.trim().toUpperCase();
      if (!isRoomCode(normalized)) {
        setError("Неверный код комнаты (нужны 4 символа).");
        return;
      }
      setMe((prev) => ({ ...prev, champion, ready: false }));
      connectRoom(normalized, false);
    },
    [connectRoom],
  );

  const leaveRoom = useCallback(() => {
    setError(null);
    teardownRoom(true);
  }, [teardownRoom]);

  const setChampion = useCallback((champion: ChampionId) => {
    setMe((prev) => {
      if (prev.champion === champion && !prev.ready) return prev;
      const next = { ...prev, champion, ready: false };
      meRef.current = next;
      roomRef.current?.sendControl({ t: "state", name: next.name, champion: next.champion, ready: false });
      return next;
    });
  }, []);

  const setReady = useCallback(
    (ready: boolean) => {
      const next = { ...meRef.current, ready };
      meRef.current = next;
      setMe(next);
      const room = roomRef.current;
      if (!room) return;
      room.sendControl({ t: "state", name: next.name, champion: next.champion, ready });
      if (ready && roleRef.current === "host" && opponentRef.current?.ready && !activeMatchRef.current) {
        startMatchAsHost(room, opponentRef.current);
      }
    },
    [startMatchAsHost],
  );

  const requestRematch = useCallback(() => {
    const room = roomRef.current;
    if (!room || status !== "connected") return;
    const next = { ...rematchRef.current, mine: true };
    rematchRef.current = next;
    setRematchState(next);
    room.sendControl({ t: "rematch" });
    if (roleRef.current === "host" && next.theirs && opponentRef.current) {
      startMatchAsHost(room, opponentRef.current);
    }
  }, [startMatchAsHost, status]);

  const clearActiveMatch = useCallback(() => {
    setActiveMatch(null);
    setRematchState({ mine: false, theirs: false });
  }, []);

  return {
    code,
    status,
    role,
    pingMs,
    me,
    opponent,
    activeMatch,
    rematchState,
    error,
    createRoom,
    joinRoom: joinRoomByCode,
    leaveRoom,
    setChampion,
    setReady,
    requestRematch,
    clearActiveMatch,
  };
}

export type OnlineRoomHandle = ReturnType<typeof useOnlineRoom>;
