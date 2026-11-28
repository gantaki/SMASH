import { useState } from "react";
import { getChampion, type ChampionId } from "@smash/content";
import type { OnlineRoomHandle } from "../net/useOnlineRoom.ts";

export interface LobbyProps {
  champion: ChampionId;
  online: OnlineRoomHandle;
}

/** WebRTC P2P room lobby: create or join by 4-char /r/CODE link, pick champion, ready up. */
export function Lobby({ champion, online }: LobbyProps) {
  const [codeInput, setCodeInput] = useState("");
  const [copied, setCopied] = useState(false);

  const shareUrl = online.code ? `${location.origin}/r/${online.code}` : "";

  const copyLink = () => {
    if (!shareUrl || !navigator.clipboard) return;
    void navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="lobby">
      {!online.code ? (
        <>
          <div className="row lobby-entry">
            <button className="go" onClick={() => online.createRoom(champion)}>
              Создать комнату
            </button>
            <input
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
              placeholder="КОД"
              maxLength={4}
              aria-label="Код комнаты"
            />
            <button
              className="ghost"
              onClick={() => online.joinRoom(codeInput, champion)}
              disabled={codeInput.trim().length !== 4}
            >
              Войти
            </button>
          </div>
          <p className="keys">P2P через WebRTC — работает прямо в браузере по ссылке, без сервера.</p>
        </>
      ) : (
        <>
          <div className="lobby-head">
            <div>
              Комната <b>{online.code}</b>{" "}
              <span className={`net-status ${online.status}`}>
                {online.status === "waiting" && "· Ждём соперника… Отправь ссылку другу"}
                {online.status === "connected" &&
                  `· Подключено (P2P${online.pingMs !== null ? ` · ${online.pingMs} мс` : ""})`}
                {online.status === "disconnected" && "· Соперник отключился"}
              </span>
            </div>
            <div className="lobby-actions">
              <button className="ghost copy-btn" onClick={copyLink}>
                {copied ? "Скопировано!" : "Скопировать ссылку"}
              </button>
              <button className="ghost" onClick={online.leaveRoom}>
                Выйти
              </button>
            </div>
          </div>
          <p className="keys">
            Ссылка для друга: <code>{shareUrl}</code>
          </p>
          <ul className="players">
            <li className="ally">
              {online.me.name} (вы{online.role === "host" ? ", хост" : ""}) — {getChampion(online.me.champion).nameRu}{" "}
              {online.me.ready ? "✓" : ""}
            </li>
            {online.opponent && (
              <li className="enemy">
                {online.opponent.name}
                {online.role === "guest" ? " (хост)" : ""} — {getChampion(online.opponent.champion).nameRu}{" "}
                {online.opponent.ready ? "✓" : ""}
              </li>
            )}
          </ul>
          {online.status === "connected" && (
            <div className="row">
              <span className="keys" style={{ margin: 0 }}>
                Когда оба нажмут «Готов», матч начнётся автоматически.
              </span>
              <button
                className="go"
                aria-pressed={online.me.ready}
                onClick={() => online.setReady(!online.me.ready)}
              >
                {online.me.ready ? "Не готов" : "Готов"}
              </button>
            </div>
          )}
        </>
      )}
      {online.error && <p className="keys warn">{online.error}</p>}
    </div>
  );
}
