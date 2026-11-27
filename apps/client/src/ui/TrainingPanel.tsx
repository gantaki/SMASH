import { useState } from "react";
import { defaultTuning, getChampion, type Tuning } from "@smash/content";
import type { TrainingCommand } from "@smash/sim";
import type { TrainingStats } from "../game/Game.ts";

interface Props {
  champion: string;
  stats: TrainingStats;
  onCommand(cmd: TrainingCommand): void;
  onTuning(t: Partial<Tuning>): void;
}

interface Slider {
  key: keyof Tuning;
  label: string;
  min: number;
  max: number;
  step: number;
  format(v: number, champion: string): string;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const ms = (v: number) => `${Math.round(v * 1000)} мс`;

const SLIDERS: Slider[] = [
  { key: "moveSpeed", label: "Скорость бега", min: 0.6, max: 1.5, step: 0.02, format: (v, c) => `${(getChampion(c).stats.moveSpeed * v).toFixed(1)} м/с` },
  { key: "accelTime", label: "Разгон", min: 0, max: 0.3, step: 0.01, format: ms },
  { key: "decelTime", label: "Торможение", min: 0, max: 0.3, step: 0.01, format: ms },
  { key: "projectileSpeed", label: "Скорость снарядов", min: 0.4, max: 1.8, step: 0.02, format: pct },
  { key: "castTime", label: "Длительность замаха", min: 0, max: 2, step: 0.05, format: pct },
  { key: "cooldown", label: "Перезарядка", min: 0, max: 1.5, step: 0.05, format: pct },
];

/** Practice range controls: dummy, sudden death, and live feel tuning (multipliers applied on top of content data). */
export function TrainingPanel({ champion, stats, onCommand, onTuning }: Props) {
  const [tuning, setTuning] = useState<Tuning>({ ...defaultTuning });
  const set = (key: keyof Tuning, value: number) => {
    setTuning({ ...tuning, [key]: value });
    onTuning({ [key]: value });
  };
  const reset = () => {
    setTuning({ ...defaultTuning });
    onTuning({ ...defaultTuning });
  };
  return (
    <aside className="training">
      <h3>Полигон</h3>
      <div className="dps">
        <div>
          <b>{stats.dps.toFixed(1)}</b>
          <span>урон/с</span>
        </div>
        <div>
          <b>{Math.round(stats.lastHit)}</b>
          <span>последний удар</span>
        </div>
        <div>
          <b>{Math.round(stats.total)}</b>
          <span>всего</span>
        </div>
      </div>
      <div className="cmds">
        <button onClick={() => onCommand({ t: "resetCooldowns" })}>
          <kbd>1</kbd> Сбросить перезарядки
        </button>
        <button onClick={() => onCommand({ t: "fillEnergy" })}>
          <kbd>2</kbd> Полная энергия
        </button>
        <button aria-pressed={stats.dummyMoves} onClick={() => onCommand({ t: "toggleDummyMove" })}>
          <kbd>3</kbd> Манекен ходит
        </button>
        <button aria-pressed={stats.suddenDeath} onClick={() => onCommand({ t: "toggleSuddenDeath" })}>
          <kbd>4</kbd> Разломы и зона
        </button>
        <button onClick={() => onCommand({ t: "resetArena" })}>
          <kbd>5</kbd> Сбросить арену
        </button>
      </div>
      <h3>Ощущение</h3>
      {SLIDERS.map((s) => (
        <label key={s.key} className="tune">
          <span>
            {s.label} <b>{s.format(tuning[s.key], champion)}</b>
          </span>
          <input type="range" min={s.min} max={s.max} step={s.step} value={tuning[s.key]} onChange={(e) => set(s.key, Number(e.target.value))} />
        </label>
      ))}
      <button className="reset" onClick={reset}>
        Вернуть значения по умолчанию
      </button>
      <p className="note">Ползунки меняют только эту тренировку. Понравившиеся значения переносятся в packages/content.</p>
    </aside>
  );
}
