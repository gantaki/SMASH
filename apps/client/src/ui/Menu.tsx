import { useState } from "react";
import { ABILITY_SLOTS, BOT_DIFFICULTIES, getChampion, playableChampions, rules, type AbilitySlot, type BotDifficulty, type ChampionId } from "@smash/content";
import type { OnlineRoomHandle } from "../net/useOnlineRoom.ts";
import { ABILITY_ART, PORTRAITS } from "./art.ts";
import { HowToPlay } from "./HowToPlay.tsx";
import { ABILITY_ICONS, CHAMPION_EMBLEMS, KEY_LABELS } from "./icons.ts";
import { Lobby } from "./Lobby.tsx";

export type PlayMode = "duel" | "online" | "training";

const MODES: readonly { id: PlayMode; label: string }[] = [
  { id: "duel", label: "С ботом" },
  { id: "online", label: "Онлайн" },
  { id: "training", label: "Тренировка" },
];
const DIFFICULTY_LABELS: Record<BotDifficulty, string> = { easy: "Лёгкий", normal: "Средний", hard: "Сложный" };

interface Props {
  champion: ChampionId;
  mode: PlayMode;
  difficulty: BotDifficulty;
  online: OnlineRoomHandle;
  onChampion(id: string): void;
  onMode(mode: PlayMode): void;
  onDifficulty(d: BotDifficulty): void;
  onStart(): void;
}

/** Painted icon when the pack has one, the line icon otherwise. */
export function AbilityIcon({ icon }: { icon: string }) {
  const art = ABILITY_ART[icon];
  return art ? <img src={art} alt="" draggable={false} /> : <svg viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ABILITY_ICONS[icon] ?? "" }} />;
}

/** Main menu: the demo fight stays visible; the menu is a champion on the left and a play card on the right. */
export function Menu(p: Props) {
  const [slot, setSlot] = useState<AbilitySlot>("primary");
  const [help, setHelp] = useState(false);
  const c = getChampion(p.champion);
  const shown = c.abilities[slot] ?? c.abilities.primary;
  const portrait = PORTRAITS[c.id];

  return (
    <div className="menu" style={{ "--c": c.color } as React.CSSProperties}>
      <header className="menu-top">
        <div className="wordmark">SMASH</div>
        <button className="pill" onClick={() => setHelp(true)}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17v.01" />
          </svg>
          Как играть
        </button>
      </header>

      {portrait && <img key={c.id} className="portrait" src={portrait} alt="" draggable={false} />}

      <main className="menu-main">
        <section className="hero" aria-label="Чемпион">
          <div className="champs">
            {playableChampions.map((ch) => (
              <button key={ch.id} className="champ" aria-pressed={ch.id === p.champion} style={{ "--c": ch.color } as React.CSSProperties} onClick={() => p.onChampion(ch.id)}>
                <svg viewBox="0 0 48 48" aria-hidden="true" dangerouslySetInnerHTML={{ __html: CHAMPION_EMBLEMS[ch.id] ?? "" }} />
                {ch.nameRu}
              </button>
            ))}
          </div>

          <div>
            <div className="eyebrow">{c.roleRu}</div>
            <h1 className="hero-name">{c.nameRu}</h1>
          </div>

          <p className="hero-blurb">{c.blurbRu}</p>

          <dl className="stats">
            <div>
              <dt>здоровье</dt>
              <dd>{c.stats.hp}</dd>
            </div>
            <div>
              <dt>скорость</dt>
              <dd>{c.stats.moveSpeed}</dd>
            </div>
          </dl>

          <div className="kit">
            <div className="kit-row">
              {ABILITY_SLOTS.map((s) => {
                const a = c.abilities[s];
                return a ? (
                  <div className="kit-slot" key={s}>
                    <button
                      className="tile"
                      aria-pressed={a === shown}
                      aria-label={`${a.nameRu}, ${KEY_LABELS[s]}`}
                      style={{ "--c": a.color } as React.CSSProperties}
                      onPointerEnter={() => setSlot(s)}
                      onFocus={() => setSlot(s)}
                      onClick={() => setSlot(s)}
                    >
                      <AbilityIcon icon={a.icon} />
                    </button>
                    <kbd>{KEY_LABELS[s]}</kbd>
                  </div>
                ) : null;
              })}
            </div>
            {shown && (
              <p className="kit-info">
                <b>{shown.nameRu}</b> — {shown.descriptionRu}
              </p>
            )}
          </div>
        </section>

        <section className="play" aria-label="Режим игры">
          <div className="tabs">
            {MODES.map((m) => (
              <button key={m.id} aria-pressed={p.mode === m.id} onClick={() => p.onMode(m.id)}>
                {m.label}
              </button>
            ))}
          </div>

          {p.mode === "duel" && (
            <>
              <div className="play-row">
                <span>Бот</span>
                <div className="tabs small">
                  {BOT_DIFFICULTIES.map((d) => (
                    <button key={d} aria-pressed={p.difficulty === d} onClick={() => p.onDifficulty(d)}>
                      {DIFFICULTY_LABELS[d]}
                    </button>
                  ))}
                </div>
              </div>
              <button className="go big" onClick={p.onStart}>
                В бой
              </button>
              <p className="play-note">Дуэль 1 на 1 до {rules.roundsToWin} побед</p>
            </>
          )}

          {p.mode === "online" && <Lobby champion={p.champion} online={p.online} />}

          {p.mode === "training" && (
            <>
              <button className="go big" onClick={p.onStart}>
                На полигон
              </button>
              <p className="play-note">Манекен, счётчик урона и ползунки баланса</p>
            </>
          )}
        </section>
      </main>

      {help && <HowToPlay onClose={() => setHelp(false)} />}
    </div>
  );
}
