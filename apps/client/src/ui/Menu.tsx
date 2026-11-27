import { useState } from "react";
import { ABILITY_SLOTS, BOT_DIFFICULTIES, arena, playableChampions, type BotDifficulty } from "@smash/content";
import { CHAMPION_EMBLEMS, KEY_LABELS } from "./icons.ts";
import { Lobby } from "./Lobby.tsx";

export type PlayMode = "duel" | "training";

const DIFFICULTY_LABELS: Record<BotDifficulty, string> = { easy: "Лёгкий", normal: "Средний", hard: "Сложный" };

interface Props {
  champion: string;
  mode: PlayMode;
  difficulty: BotDifficulty;
  onChampion(id: string): void;
  onMode(mode: PlayMode): void;
  onDifficulty(d: BotDifficulty): void;
  onStart(): void;
}

export function Menu(p: Props) {
  const [online, setOnline] = useState(() => location.pathname.startsWith("/r/"));
  const sd = arena.suddenDeath;
  return (
    <div className="screen">
      <div className="panel">
        <h1>SMASH</h1>
        <p className="sub">Арена-брауллер: дуэль 1 на 1 до двух выигранных раундов.</p>
        <div className="picks">
          {playableChampions.map((c) => (
            <button key={c.id} className="pick" aria-pressed={c.id === p.champion} style={{ "--c": c.color } as React.CSSProperties} onClick={() => p.onChampion(c.id)}>
              <div className="ph">
                <svg viewBox="0 0 48 48" dangerouslySetInnerHTML={{ __html: CHAMPION_EMBLEMS[c.id] ?? "" }} />
                <div>
                  <h2>{c.nameRu}</h2>
                  <div className="role">
                    {c.roleRu} · {c.stats.hp} здоровья · скорость {c.stats.moveSpeed}
                  </div>
                </div>
              </div>
              <p>{c.blurbRu}</p>
              <div className="ab">
                {ABILITY_SLOTS.map((s) => {
                  const a = c.abilities[s];
                  return a ? (
                    <div className="abrow" key={s}>
                      <kbd>{KEY_LABELS[s]}</kbd>
                      <div>
                        <b>{a.nameRu}</b> <span>— {a.descriptionRu}</span>
                      </div>
                    </div>
                  ) : null;
                })}
              </div>
            </button>
          ))}
        </div>
        <div className="row">
          <span className="lbl">Режим</span>
          <div className="seg">
            <button aria-pressed={p.mode === "duel"} onClick={() => p.onMode("duel")}>
              Бой с ботом
            </button>
            <button aria-pressed={p.mode === "training"} onClick={() => p.onMode("training")}>
              Тренировка
            </button>
          </div>
          {p.mode === "duel" && (
            <>
              <span className="lbl">Бот</span>
              <div className="seg">
                {BOT_DIFFICULTIES.map((d) => (
                  <button key={d} aria-pressed={p.difficulty === d} onClick={() => p.onDifficulty(d)}>
                    {DIFFICULTY_LABELS[d]}
                  </button>
                ))}
              </div>
            </>
          )}
          <button className="go" onClick={p.onStart}>
            {p.mode === "duel" ? "В бой" : "На полигон"}
          </button>
        </div>
        <p className="keys">
          <kbd>WASD</kbd> движение · мышь — прицел · <kbd>ЛКМ</kbd> <kbd>ПКМ</kbd> <kbd>Space</kbd> <kbd>Q</kbd> <kbd>E</kbd> способности · <kbd>R</kbd> или колесо —
          команда компаньону · <kbd>F</kbd> ультимейт за 100 энергии. ЛКМ можно зажать. У каждой атаки есть замах: его видно по полосе на земле.
        </p>
        <p className="keys">
          На {arena.orb.spawnAt}-й секунде в центре появляется сфера: кто её разобьёт, получит {arena.orb.reward.heal} здоровья и {arena.orb.reward.energy} энергии. С{" "}
          {sd.startAt}-й секунды арена рушится: безопасная зона сжимается, а пол раскалывают разломы — они светятся перед извержением и обжигают всех, кто стоит на
          трещине. Отбрасывание в препятствие или стену оглушает.
        </p>
        <p className="keys">
          <button className="link" onClick={() => setOnline(!online)}>
            {online ? "Скрыть онлайн-лобби" : "Онлайн-лобби (в разработке)"}
          </button>{" "}
          · <a href="/prototype/">старый прототип</a>
        </p>
        {online && <Lobby />}
      </div>
    </div>
  );
}
