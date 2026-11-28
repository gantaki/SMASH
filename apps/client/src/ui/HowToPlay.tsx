import { useEffect, useRef } from "react";
import { arena, rules } from "@smash/content";

const CONTROLS: readonly { keys: readonly string[]; text: string }[] = [
  { keys: ["WASD"], text: "движение" },
  { keys: ["Мышь"], text: "прицел" },
  { keys: ["ЛКМ", "ПКМ", "Space", "Q", "E"], text: "способности; ЛКМ можно зажать" },
  { keys: ["R", "Колесо"], text: `команда компаньону — ${rules.energy.commandCost} энергии, четверть шкалы` },
  { keys: ["X"], text: `ультимейт — вся шкала, ${rules.energy.max} энергии` },
  { keys: ["C"], text: "отменить замах — перезарядка не тратится" },
  { keys: ["Esc", "P"], text: "пауза" },
  { keys: ["M"], text: "звук" },
];

/** Controls and arena rules: everything the menu used to print on its front page. */
export function HowToPlay({ onClose }: { onClose(): void }) {
  const close = useRef<HTMLButtonElement>(null);
  const sd = arena.suddenDeath;

  useEffect(() => {
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="screen" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="panel how" role="dialog" aria-modal="true" aria-labelledby="how-title">
        <div className="how-head">
          <h2 id="how-title">Как играть</h2>
          <button ref={close} className="pill" onClick={onClose}>
            Закрыть
          </button>
        </div>

        <h3>Управление</h3>
        <dl className="controls">
          {CONTROLS.map((c) => (
            <div key={c.text}>
              <dt>
                {c.keys.map((k) => (
                  <kbd key={k}>{k}</kbd>
                ))}
              </dt>
              <dd>{c.text}</dd>
            </div>
          ))}
        </dl>

        <h3>Арена</h3>
        <ul className="how-rules">
          <li>Дуэль 1 на 1 до {rules.roundsToWin} побед в раундах.</li>
          <li>У каждой атаки есть замах: его видно по полосе на земле, от него можно уйти.</li>
          <li>
            На {arena.orb.spawnAt}-й секунде в центре появляется сфера. Кто её разобьёт, получит {arena.orb.reward.heal} здоровья и{" "}
            {arena.orb.reward.energy} энергии.
          </li>
          <li>
            С {sd.startAt}-й секунды арена рушится: безопасная зона сжимается, а пол раскалывают разломы. Они светятся перед извержением и
            обжигают всех, кто стоит на трещине.
          </li>
          <li>Отбрасывание в стену или препятствие оглушает.</li>
        </ul>

        <p className="keys">
          <a href="/prototype/">Старый прототип</a>
        </p>
      </div>
    </div>
  );
}
