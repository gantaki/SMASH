import { useState } from "react";
import { isChampionId, playableChampions } from "@smash/content";
import { useLobby } from "../net/useLobby.ts";

/** Online rooms (M2). The lobby works; matches over the network are not implemented yet. */
export function Lobby() {
  const [name] = useState(() => `Игрок${Math.floor(Math.random() * 900 + 100)}`);
  const [code, setCode] = useState("");
  const net = useLobby(name);
  const me = net.lobby?.players.find((p) => p.id === net.playerId);
  const offline = net.status === "no-server" || net.status === "offline";

  return (
    <div className="lobby">
      <p className="keys">
        Сервер: <b className={`status ${net.status}`}>{net.status}</b>
        {offline && " — игровой сервер пока не развёрнут; локально он запускается через pnpm dev."}
      </p>
      {!net.lobby ? (
        <div className="row">
          <button className="ghost" onClick={net.create} disabled={net.status !== "online"}>
            Создать комнату
          </button>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="КОД" maxLength={4} />
          <button className="ghost" onClick={() => net.join(code)} disabled={net.status !== "online" || code.length !== 4}>
            Войти
          </button>
        </div>
      ) : (
        <>
          <p className="keys">
            Комната <b>{net.lobby.code}</b> · ссылка{" "}
            <code>
              {location.origin}/r/{net.lobby.code}
            </code>
          </p>
          <ul className="players">
            {net.lobby.players.map((p) => (
              <li key={p.id} className={p.team === 0 ? "ally" : "enemy"}>
                {p.name}
                {p.id === net.lobby?.hostId ? " (хост)" : ""} — {p.champion ?? "выбирает…"} {p.ready ? "✓" : ""}
              </li>
            ))}
          </ul>
          <div className="row">
            {playableChampions.map((c) => (
              <button key={c.id} className="ghost" aria-pressed={me?.champion === c.id} onClick={() => isChampionId(c.id) && net.pick(c.id)}>
                {c.nameRu}
              </button>
            ))}
            {me && (
              <button className="ghost" onClick={() => net.setReady(!me.ready)} disabled={!me.champion}>
                {me.ready ? "Не готов" : "Готов"}
              </button>
            )}
          </div>
        </>
      )}
      {net.error && <p className="keys warn">{net.error}</p>}
    </div>
  );
}
