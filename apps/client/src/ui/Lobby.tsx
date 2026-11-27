import { useEffect, useReducer, useState } from "react";
import { getChampion, isChampionId } from "@smash/content";
import type { NetClient } from "../net/NetClient.ts";

interface Props {
  net: NetClient;
  /** The champion selected in the menu: sent to the room as this player's pick. */
  champion: string;
}

const STATUS_TEXT: Record<NetClient["status"], string> = {
  idle: "не подключено",
  connecting: "подключение…",
  online: "на связи",
  offline: "нет связи",
  "no-server": "сервер не настроен",
};

/** Online duel lobby: create a room or join one by code/link, both players press Ready, the server starts the match. */
export function Lobby({ net, champion }: Props) {
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const [code, setCode] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    net.onChange = refresh;
    net.connect();
    return () => {
      net.onChange = null;
    };
  }, [net]);

  const { lobby, status } = net;
  const me = net.me;
  // Keep the room in step with the champion chosen in the menu.
  useEffect(() => {
    if (lobby && !lobby.inMatch && me && me.champion !== champion && isChampionId(champion)) net.pick(champion);
  }, [net, lobby, me, champion]);

  const link = lobby ? `${location.origin}/r/${lobby.code}${location.search}` : "";
  const copy = () => {
    void navigator.clipboard?.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  const other = lobby?.players.find((p) => p.id !== net.playerId);

  return (
    <div className="lobby">
      <p className="keys">
        Сервер: <b className={`status ${status}`}>{STATUS_TEXT[status]}</b>
        {status === "no-server" && " — игровой сервер ещё не развёрнут (см. README, раздел Deployment). Локально он запускается через pnpm dev."}
        {status === "offline" && (
          <>
            {" "}
            <button className="link" onClick={() => net.connect()}>
              Подключиться снова
            </button>
          </>
        )}
      </p>
      {!lobby ? (
        <div className="row">
          <button className="ghost" onClick={() => net.create()} disabled={status !== "online"}>
            Создать комнату
          </button>
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="КОД" maxLength={4} />
          <button className="ghost" onClick={() => net.join(code)} disabled={status !== "online" || code.length !== 4}>
            Войти
          </button>
        </div>
      ) : (
        <>
          <p className="keys">
            Комната <b>{lobby.code}</b> · отправь другу ссылку: <code>{link}</code>{" "}
            <button className="link" onClick={copy}>
              {copied ? "скопировано" : "копировать"}
            </button>
          </p>
          <ul className="players">
            {lobby.players.map((p) => (
              <li key={p.id} className={p.id === net.playerId ? "ally" : "enemy"}>
                {p.id === net.playerId ? "Ты" : p.name} — {p.champion ? getChampion(p.champion).nameRu : "выбирает героя…"} {p.ready ? "· готов ✓" : ""}
              </li>
            ))}
            {!other && <li className="waiting">Ждём второго игрока…</li>}
          </ul>
          <div className="row">
            <button className="go" onClick={() => net.setReady(!me?.ready)} disabled={!me?.champion}>
              {me?.ready ? "Не готов" : "Готов"}
            </button>
            <button className="ghost" onClick={() => net.leave()}>
              Выйти из комнаты
            </button>
            <span className="keys">{other ? "Бой начнётся, когда оба нажмут «Готов»." : "Герой выбирается карточками выше."}</span>
          </div>
        </>
      )}
      {net.error && <p className="keys warn">{net.error}</p>}
    </div>
  );
}
