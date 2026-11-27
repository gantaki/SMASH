import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { playableChampions, type BotDifficulty } from "@smash/content";
import { AudioEngine } from "./audio/AudioEngine.ts";
import { Game, type EndReason, type GameMode, type TrainingStats } from "./game/Game.ts";
import { NetClient, type StartMessage } from "./net/NetClient.ts";
import { Menu, type PlayMode } from "./ui/Menu.tsx";
import { TrainingPanel } from "./ui/TrainingPanel.tsx";

type Screen = "menu" | "game" | "end";

const EMPTY_STATS: TrainingStats = { dps: 0, lastHit: 0, total: 0, dummyMoves: false, suddenDeath: false };
const DIFFICULTY_NAMES: Record<BotDifficulty, string> = { easy: "лёгкий", normal: "средний", hard: "сложный" };

export function App() {
  const audio = useMemo(() => new AudioEngine(), []);
  const net = useMemo(() => new NetClient(`Игрок${Math.floor(Math.random() * 900 + 100)}`), []);
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const hud = useRef<HTMLDivElement>(null);
  const game = useRef<Game | null>(null);
  /** Set when the server starts an online match; consumed by the next run. */
  const online = useRef<StartMessage | null>(null);

  const [screen, setScreen] = useState<Screen>("menu");
  const [champion, setChampion] = useState(playableChampions[0]!.id);
  const [mode, setMode] = useState<PlayMode>("duel");
  const [difficulty, setDifficulty] = useState<BotDifficulty>("normal");
  const [paused, setPaused] = useState(false);
  const [result, setResult] = useState<{ won: boolean; score: [number, number]; reason: EndReason; online: boolean } | null>(null);
  const [stats, setStats] = useState<TrainingStats>(EMPTY_STATS);
  // Bumping the run number gives the next match a fresh canvas (and WebGL context).
  const [run, setRun] = useState(0);

  // Browsers only allow audio after a user gesture: start loading sounds on the first click anywhere.
  useEffect(() => {
    const unlock = () => audio.unlock();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, [audio]);

  // The server decides when an online match begins (both players ready).
  useEffect(() => {
    net.onStart = (msg) => {
      online.current = msg;
      audio.play("ui_click");
      setPaused(false);
      setResult(null);
      setScreen("game");
      setRun((n) => n + 1);
    };
    return () => {
      net.onStart = null;
      net.close();
    };
  }, [net, audio]);

  const opponent = playableChampions.find((c) => c.id !== champion)?.id ?? champion;

  useEffect(() => {
    if (!canvas.current || !overlay.current || !hud.current) return;
    const start = screen === "menu" ? null : online.current;
    const gameMode: GameMode = screen === "menu" ? "demo" : start ? "online" : mode;
    const g = new Game({
      mode: gameMode,
      champion,
      opponent,
      difficulty,
      canvas: canvas.current,
      overlay: overlay.current,
      hud: hud.current,
      audio,
      online: start ? { net, start } : undefined,
      onMatchEnd: (won, score, reason) => {
        if (gameMode === "demo") return setRun((n) => n + 1);
        setResult({ won, score, reason, online: gameMode === "online" });
        setPaused(false);
        setScreen("end");
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
    online.current = null;
    audio.unlock();
    audio.play("ui_click");
    setPaused(false);
    setResult(null);
    setStats(EMPTY_STATS);
    setScreen("game");
    setRun((n) => n + 1);
  }, [audio]);

  const toMenu = useCallback(() => {
    // Walking out of an online match forfeits it.
    if (online.current && net.lobby?.inMatch) net.leave();
    online.current = null;
    setPaused(false);
    setResult(null);
    setScreen("menu");
    setRun((n) => n + 1);
  }, [net]);

  const pick = (id: string) => {
    audio.unlock();
    audio.play("ui_click");
    setChampion(id);
    if (screen === "menu") setRun((n) => n + 1);
  };

  const isOnline = screen !== "menu" && online.current !== null;
  return (
    <>
      <canvas key={run} ref={canvas} className="stage" tabIndex={0} aria-label="Арена" />
      <div ref={overlay} className="ov" />
      <div ref={hud} className="hud" hidden={screen !== "game"} />

      {screen === "menu" && (
        <Menu champion={champion} mode={mode} difficulty={difficulty} net={net} onChampion={pick} onMode={setMode} onDifficulty={setDifficulty} onStart={start} />
      )}

      {screen === "game" && mode === "training" && !isOnline && !paused && (
        <TrainingPanel champion={champion} stats={stats} onCommand={(c) => game.current?.command(c)} onTuning={(t) => game.current?.setTuning(t)} />
      )}

      {screen === "game" && paused && (
        <div className="screen">
          <div className="panel small">
            <h1>{isOnline ? "Меню" : "Пауза"}</h1>
            {isOnline && <p className="sub">Бой по сети не останавливается.</p>}
            <div className="row">
              <button className="go" onClick={() => game.current?.setPaused(false)}>
                Продолжить
              </button>
              <button className="ghost" onClick={toMenu}>
                {isOnline ? "Сдаться и выйти" : "Выйти в меню"}
              </button>
            </div>
          </div>
        </div>
      )}

      {screen === "end" && result && (
        <div className="screen">
          <div className="panel small">
            <h1 style={{ color: result.won ? "var(--ally)" : "var(--foe)" }}>
              {result.reason === "opponent_left" ? (result.won ? "Соперник вышел" : "Связь потеряна") : result.won ? "Победа" : "Поражение"}
            </h1>
            <p className="sub">
              Счёт {result.score[0]} : {result.score[1]}
              {result.online ? " · бой по сети" : ` · бот (${DIFFICULTY_NAMES[difficulty]})`}
            </p>
            <div className="row">
              {result.online ? (
                <button className="go" onClick={toMenu}>
                  В лобби: реванш
                </button>
              ) : (
                <>
                  <button className="go" onClick={start}>
                    Реванш
                  </button>
                  <button className="ghost" onClick={toMenu}>
                    Сменить чемпиона
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
