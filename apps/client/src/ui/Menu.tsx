import { useLayoutEffect, useRef, useState } from "react";
import { ABILITY_SLOTS, BOT_DIFFICULTIES, getChampion, playableChampions, rules, type AbilitySlot, type BotDifficulty, type ChampionId } from "@smash/content";
import type { OnlineRoomHandle } from "../net/useOnlineRoom.ts";
import { ABILITY_ART, MODE_ART, PORTRAITS, TILES } from "./art.ts";
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
/** How long the outgoing portrait stays mounted to fade out; matches `portrait-out` in styles.css. */
const PORTRAIT_FADE_MS = 220;

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

/** Drawn icon when the pack has one, the line icon otherwise. */
export function AbilityIcon({ icon }: { icon: string }) {
  const art = ABILITY_ART[icon];
  return art ? <img src={art} alt="" draggable={false} /> : <svg viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ABILITY_ICONS[icon] ?? "" }} />;
}

/** The champion that was shown before the current one, for as long as its portrait takes to fade out. */
function usePrevious(id: ChampionId): ChampionId | null {
  const [prev, setPrev] = useState<ChampionId | null>(null);
  const current = useRef(id);
  // Layout effect: the outgoing portrait must be back in the tree before the browser paints the new one.
  useLayoutEffect(() => {
    if (current.current === id) return;
    setPrev(current.current);
    current.current = id;
    const t = window.setTimeout(() => setPrev(null), PORTRAIT_FADE_MS);
    return () => window.clearTimeout(t);
  }, [id]);
  return prev;
}

/**
 * Main menu. The demo fight stays visible in the middle: the champion picker and the picked champion's kit are on the
 * left, the portrait on the right, the play controls at the bottom centre.
 */
export function Menu(p: Props) {
  const [slot, setSlot] = useState<AbilitySlot>("primary");
  const [help, setHelp] = useState(false);
  const c = getChampion(p.champion);
  const prev = usePrevious(p.champion);
  const shown = c.abilities[slot] ?? c.abilities.primary;
  const portrait = PORTRAITS[c.id];
  const leaving = prev ? PORTRAITS[prev] : undefined;

  return (
    <div className="menu" style={{ "--c": c.color } as React.CSSProperties}>
      <header className="menu-top" inert={help}>
        <div className="wordmark">SMASH</div>
        <button className="pill" onClick={() => setHelp(true)}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17v.01" />
          </svg>
          Как играть
        </button>
      </header>

      {leaving && <img key={`out-${prev}`} className="portrait out" src={leaving} alt="" draggable={false} />}
      {portrait && <img key={c.id} className="portrait" src={portrait} alt="" draggable={false} />}

      <main className="menu-main" inert={help}>
        <section className="hero" aria-label="Чемпион">
          <div className="champs">
            {playableChampions.map((ch) => {
              const tile = TILES[ch.id];
              return (
                <button key={ch.id} className="champ" aria-pressed={ch.id === p.champion} style={{ "--c": ch.color } as React.CSSProperties} onClick={() => p.onChampion(ch.id)}>
                  <span className="champ-face">
                    {tile ? (
                      <img src={tile} alt="" draggable={false} />
                    ) : (
                      <svg viewBox="0 0 48 48" aria-hidden="true" dangerouslySetInnerHTML={{ __html: CHAMPION_EMBLEMS[ch.id] ?? "" }} />
                    )}
                  </span>
                  {ch.nameRu}
                </button>
              );
            })}
          </div>

          {/* Keyed by champion: the block replays its entrance when the pick changes. */}
          <div className="hero-info" key={c.id}>
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
              <div title="Чем больше вес, тем короче отлетает чемпион от толчка">
                <dt>вес</dt>
                <dd>{c.stats.weight}</dd>
              </div>
            </dl>

            <div className="kit">
              <div className="kit-row">
                {ABILITY_SLOTS.map((s) => {
                  const a = c.abilities[s];
                  return a ? (
                    <div className={`kit-slot ${s}`} key={s}>
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
                  {shown.energyCost ? <span className="cost"> · {shown.energyCost === rules.energy.max ? "вся шкала энергии" : `${shown.energyCost} энергии`}</span> : null}
                </p>
              )}
            </div>
          </div>
        </section>

        <section className="playbar" aria-label="Режим игры">
          <div className="modes">
            {MODES.map((m) => (
              <button key={m.id} className="mode" aria-pressed={p.mode === m.id} onClick={() => p.onMode(m.id)}>
                <img src={MODE_ART[m.id]} alt="" draggable={false} />
                {m.label}
              </button>
            ))}
          </div>

          {p.mode === "duel" && (
            <div className="playbar-row">
              <div className="levels" role="group" aria-label="Сложность бота">
                {BOT_DIFFICULTIES.map((d) => (
                  <button key={d} aria-pressed={p.difficulty === d} onClick={() => p.onDifficulty(d)}>
                    {DIFFICULTY_LABELS[d]}
                  </button>
                ))}
              </div>
              <button className="go big" onClick={p.onStart}>
                В бой
              </button>
            </div>
          )}

          {p.mode === "online" && <Lobby champion={p.champion} online={p.online} />}

          {p.mode === "training" && (
            <div className="playbar-row">
              <p className="playbar-note">Манекен, счётчик урона и ползунки баланса</p>
              <button className="go big" onClick={p.onStart}>
                На полигон
              </button>
            </div>
          )}
        </section>
      </main>

      {help && <HowToPlay onClose={() => setHelp(false)} />}
    </div>
  );
}
