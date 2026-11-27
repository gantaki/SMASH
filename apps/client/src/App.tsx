import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { playableChampions, type BotDifficulty } from "@smash/content";
import { AudioEngine } from "./audio/AudioEngine.ts";
import { Game, type GameMode, type TrainingStats } from "./game/Game.ts";
import { Menu, type PlayMode } from "./ui/Menu.tsx";
import { TrainingPanel } from "./ui/TrainingPanel.tsx";

type Screen = "menu" | "game" | "end";

const EMPTY_STATS: TrainingStats = { dps: 0, lastHit: 0, total: 0, dummyMoves: false, suddenDeath: false };
const DIFFICULTY_NAMES: Record<BotDifficulty, string> = { easy: "лёгкий", normal: "средний", hard: "сложный" };

export function App() {
  const audio = useMemo(() => new AudioEngine(), []);
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const hud = useRef<HTMLDivElement>(null);
  const game = useRef<Game | null>(null);

  const [screen, setScreen] = useState<Screen>("menu");
  const [champion, setChampion] = useState(playableChampions[0]!.id);
  const [mode, setMode] = useState<PlayMode>("duel");
  const [difficulty, setDifficulty] = useState<BotDifficulty>("normal");
  const [paused, setPaused] = useState(false);
  const [result, setResult] = useState<{ won: boolean; score: [number, number] } | null>(null);
  const [stats, setStats] = useState<TrainingStats>(EMPTY_STATS);
  // Bumping the run number gives the next match a fresh canvas (and WebGL context).
  const [run, setRun] = useState(0);

  const opponent = playableChampions.find((c) => c.id !== champion)?.id ?? champion;
  const gameMode: GameMode = screen === "menu" ? "demo" : mode;

  useEffect(() => {
    if (!canvas.current || !overlay.current || !hud.current) return;
    const g = new Game({
      mode: gameMode,
      champion,
      opponent,
      difficulty,
      canvas: canvas.current,
      overlay: overlay.current,
      hud: hud.current,
      audio,
      onMatchEnd: (won, score) => {
        if (gameMode === "demo") setRun((n) => n + 1);
        else {
          setResult({ won, score });
          setScreen("end");
        }
      },
      onPause: setPaused,
      onTrainingStats: setStats,
    });
    game.current = g;
    // Handle for Playwright smoke tests and console debugging.
    if (import.meta.env.DEV) (window as unknown as { __smash?: Game }).__smash = g;
    return () => {
      g.dispose();
      game.current = null;
    };
    // The match is rebuilt only when a new run starts; menu selections apply to the next run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  const start = useCallback(() => {
    audio.unlock();
    audio.play("ui_click");
    setPaused(false);
    setResult(null);
    setStats(EMPTY_STATS);
    setScreen("game");
    setRun((n) => n + 1);
  }, [audio]);

  const toMenu = useCallback(() => {
    setPaused(false);
    setResult(null);
    setScreen("menu");
    setRun((n) => n + 1);
  }, []);

  const pick = (id: string) => {
    audio.unlock();
    audio.play("ui_click");
    setChampion(id);
    if (screen === "menu") setRun((n) => n + 1);
  };

  const inGame = screen !== "menu";
  return (
    <>
      <canvas key={run} ref={canvas} className="stage" tabIndex={0} aria-label="Арена" />
      <div ref={overlay} className="ov" />
      <div ref={hud} className="hud" hidden={!inGame || screen === "end"} />

      {screen === "menu" && <Menu champion={champion} mode={mode} difficulty={difficulty} onChampion={pick} onMode={setMode} onDifficulty={setDifficulty} onStart={start} />}

      {screen === "game" && mode === "training" && !paused && (
        <TrainingPanel champion={champion} stats={stats} onCommand={(c) => game.current?.command(c)} onTuning={(t) => game.current?.setTuning(t)} />
      )}

      {screen === "game" && paused && (
        <div className="screen">
          <div className="panel small">
            <h1>Пауза</h1>
            <div className="row">
              <button className="go" onClick={() => game.current?.setPaused(false)}>
                Продолжить
              </button>
              <button className="ghost" onClick={toMenu}>
                Выйти в меню
              </button>
            </div>
          </div>
        </div>
      )}

      {screen === "end" && result && (
        <div className="screen">
          <div className="panel small">
            <h1 style={{ color: result.won ? "var(--ally)" : "var(--foe)" }}>{result.won ? "Победа" : "Поражение"}</h1>
            <p className="sub">
              Счёт {result.score[0]} : {result.score[1]} · бот ({DIFFICULTY_NAMES[difficulty]})
            </p>
            <div className="row">
              <button className="go" onClick={start}>
                Реванш
              </button>
              <button className="ghost" onClick={toMenu}>
                Сменить чемпиона
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
