import type { ChampionId } from "@smash/content";
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, type LobbyPlayer, type LobbyState, type PlayerId } from "@smash/protocol";

/** Duel rooms for now; 2v2 and 3v3 raise this (and the match needs teams of more than one). */
export const MAX_PLAYERS = 2;

export type JoinError = "room_not_found" | "room_full";

/** Lobby bookkeeping, independent of the transport so it can be unit-tested. */
export class RoomRegistry {
  private readonly rooms = new Map<string, LobbyState>();
  private readonly playerRoom = new Map<PlayerId, string>();

  constructor(private readonly randomInt: (n: number) => number) {}

  get roomCount(): number {
    return this.rooms.size;
  }

  byCode(code: string): LobbyState | undefined {
    return this.rooms.get(code);
  }

  roomOf(playerId: PlayerId): LobbyState | undefined {
    const code = this.playerRoom.get(playerId);
    return code ? this.rooms.get(code) : undefined;
  }

  create(id: PlayerId, name: string): LobbyState {
    this.leave(id);
    const code = this.freshCode();
    const lobby: LobbyState = { code, hostId: id, players: [], inMatch: false };
    this.rooms.set(code, lobby);
    this.addPlayer(lobby, id, name);
    return lobby;
  }

  join(code: string, id: PlayerId, name: string): LobbyState | JoinError {
    const lobby = this.rooms.get(code);
    if (!lobby) return "room_not_found";
    if (lobby.players.some((p) => p.id === id)) return lobby;
    if (lobby.players.length >= MAX_PLAYERS) return "room_full";
    this.leave(id);
    this.addPlayer(lobby, id, name);
    return lobby;
  }

  /** Removes the player. Returns the updated lobby, or null if the room was closed or the player was in none. */
  leave(id: PlayerId): LobbyState | null {
    const code = this.playerRoom.get(id);
    if (!code) return null;
    this.playerRoom.delete(id);
    const lobby = this.rooms.get(code);
    if (!lobby) return null;
    lobby.players = lobby.players.filter((p) => p.id !== id);
    if (lobby.players.length === 0) {
      this.rooms.delete(code);
      return null;
    }
    if (lobby.hostId === id) lobby.hostId = lobby.players[0]!.id;
    return lobby;
  }

  pick(id: PlayerId, champion: ChampionId): LobbyState | null {
    if (this.roomOf(id)?.inMatch) return this.roomOf(id) ?? null;
    return this.updatePlayer(id, (p) => {
      p.champion = champion;
      p.ready = false;
    });
  }

  setReady(id: PlayerId, ready: boolean): LobbyState | null {
    return this.updatePlayer(id, (p) => {
      p.ready = ready && p.champion !== null;
    });
  }

  /** Both seats taken, one player per team, everyone picked and ready, and no match running. */
  canStart(lobby: LobbyState): boolean {
    const teams = new Set(lobby.players.map((p) => p.team));
    return !lobby.inMatch && lobby.players.length === MAX_PLAYERS && teams.size === 2 && lobby.players.every((p) => p.ready && p.champion !== null);
  }

  setInMatch(lobby: LobbyState, inMatch: boolean): void {
    lobby.inMatch = inMatch;
    // Back in the lobby everyone has to ready up again for a rematch.
    if (!inMatch) for (const p of lobby.players) p.ready = false;
  }

  private updatePlayer(id: PlayerId, fn: (p: LobbyPlayer) => void): LobbyState | null {
    const lobby = this.roomOf(id);
    const player = lobby?.players.find((p) => p.id === id);
    if (!lobby || !player) return null;
    fn(player);
    return lobby;
  }

  private addPlayer(lobby: LobbyState, id: PlayerId, name: string): void {
    const t0 = lobby.players.filter((p) => p.team === 0).length;
    const t1 = lobby.players.length - t0;
    lobby.players.push({ id, name, team: t0 <= t1 ? 0 : 1, champion: null, ready: false });
    this.playerRoom.set(id, lobby.code);
  }

  private freshCode(): string {
    for (;;) {
      let code = "";
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_CODE_ALPHABET[this.randomInt(ROOM_CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
  }
}
