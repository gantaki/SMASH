import { useState } from "react";
import { getChampion, type ChampionId } from "@smash/content";
import type { OnlineRoomHandle } from "../net/useOnlineRoom.ts";

export interface LobbyProps {
  champion: ChampionId;
  online: OnlineRoomHandle;
}

/** WebRTC P2P room lobby: create or join by 4-char /r/CODE link, pick champion, ready up. Lives in the menu's play card. */
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
          <button className="go big" onClick={() => online.createRoom(champion)}>
            Создать комнату
          </button>
          <div className="lobby-join">
            <input
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
              placeholder="Код комнаты"
              maxLength={4}
              aria-label="Код комнаты"
            />
            <button className="ghost" onClick={() => online.joinRoom(codeInput, champion)} disabled={codeInput.trim().length !== 4}>
              Войти
            </button>
          </div>
          <p className="play-note">Играете напрямую, по ссылке — без сервера</p>
        </>
      ) : (
        <>
          <div className="lobby-head">
            <span>Комната</span>
            <b>{online.code}</b>
          </div>
          <p className={`net-status ${online.status}`}>
            {online.status === "waiting" && "Ждём соперника — отправьте другу ссылку"}
            {online.status === "connected" && `Соперник подключён${online.pingMs !== null ? ` · ${online.pingMs} мс` : ""}`}
            {online.status === "disconnected" && "Соперник отключился"}
          </p>
          <ul className="players">
            <li className="ally">
              <span>
                {online.me.name} · {getChampion(online.me.champion).nameRu}
              </span>
              <i className={online.me.ready ? "ready" : ""}>{online.me.ready ? "готов" : online.role === "host" ? "вы, хост" : "вы"}</i>
            </li>
            {online.opponent && (
              <li className="enemy">
                <span>
                  {online.opponent.name} · {getChampion(online.opponent.champion).nameRu}
                </span>
                <i className={online.opponent.ready ? "ready" : ""}>{online.opponent.ready ? "готов" : online.role === "guest" ? "хост" : "выбирает"}</i>
              </li>
            )}
          </ul>
          <div className="lobby-actions">
            <button className="ghost copy-btn" onClick={copyLink}>
              {copied ? "Скопировано" : "Скопировать ссылку"}
            </button>
            <button className="ghost" onClick={online.leaveRoom}>
              Выйти
            </button>
          </div>
          <p className="share">{shareUrl}</p>
          {online.status === "connected" && (
            <>
              <button className="go big" aria-pressed={online.me.ready} onClick={() => online.setReady(!online.me.ready)}>
                {online.me.ready ? "Не готов" : "Готов"}
              </button>
              <p className="play-note">Матч начнётся, когда готовы оба</p>
            </>
          )}
        </>
      )}
      {online.error && <p className="net-status disconnected">{online.error}</p>}
    </div>
  );
}
