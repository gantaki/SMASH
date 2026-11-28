import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isChampionId, playableChampions, type BotDifficulty, type ChampionId } from "@smash/content";
import { AudioEngine } from "./audio/AudioEngine.ts";
import { Game, type GameMode, type TrainingStats } from "./game/Game.ts";
import { useOnlineRoom } from "./net/useOnlineRoom.ts";
import { Menu, type PlayMode } from "./ui/Menu.tsx";
import { TrainingPanel } from "./ui/TrainingPanel.tsx";

type Screen = "menu" | "game" | "end";

/** Fade-out of the demo fight before a champion swap; matches `.stage.out` in styles.css. */
const STAGE_FADE_MS = 220;
const EMPTY_STATS: TrainingStats = { dps: 0, lastHit: 0, total: 0, dummyMoves: false, suddenDeath: false };
const DIFFICULTY_NAMES: Record<BotDifficulty, string> = { easy: "лёгкий", normal: "средний", hard: "сложный" };

const defaultChampion = (): ChampionId => {
  const id = playableChampions[0]!.id;
  return isChampionId(id) ? id : "ember";
};

export function App() {
  const audio = useMemo(() => new AudioEngine(), []);
  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const hud = useRef<HTMLDivElement>(null);
  const game = useRef<Game | null>(null);

  const [screen, setScreen] = useState<Screen>("menu");
  const [champion, setChampion] = useState<ChampionId>(defaultChampion);
  const [mode, setMode] = useState<PlayMode>(() => (location.pathname.startsWith("/r/") ? "online" : "duel"));
  const [difficulty, setDifficulty] = useState<BotDifficulty>("normal");
  const [paused, setPaused] = useState(false);
  const [opponentLeft, setOpponentLeft] = useState(false);
  const [lastOnlineRole, setLastOnlineRole] = useState<"host" | "guest" | null>(null);
  const [result, setResult] = useState<{ won: boolean; score: [number, number] } | null>(null);
  const [stats, setStats] = useState<TrainingStats>(EMPTY_STATS);
  // Bumping the run number gives the next match a fresh canvas (and WebGL context).
  const [run, setRun] = useState(0);
  // True while the demo fight is fading out before it restarts with another champion.
  const [stageOut, setStageOut] = useState(false);
  const swap = useRef(0);

  const online = useOnlineRoom(champion);

  // Browsers only allow audio after a user gesture: start loading sounds on the first click anywhere.
  useEffect(() => {
    const unlock = () => audio.unlock();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, [audio]);

  useEffect(() => {
    if (!online.activeMatch) return;
    // A champion swap may still be waiting to restart the demo: it must not restart the match.
    window.clearTimeout(swap.current);
    setStageOut(false);
    setOpponentLeft(false);
    setPaused(false);
    setResult(null);
    setLastOnlineRole(online.activeMatch.role);
    setScreen("game");
    setRun((n) => n + 1);
  }, [online.activeMatch]);

  useEffect(() => {
    game.current?.setPing(online.pingMs);
  }, [online.pingMs, run]);

  const opponent = playableChampions.find((c) => c.id !== champion)?.id ?? champion;
  const isOnlineMatch = screen !== "menu" && online.activeMatch !== null;
  const gameMode: GameMode = screen === "menu" ? "demo" : isOnlineMatch ? "online" : mode === "online" ? "duel" : mode;

  useEffect(() => {
    if (!canvas.current || !overlay.current || !hud.current) return;
    const active = isOnlineMatch ? online.activeMatch : null;
    const g = new Game({
      mode: gameMode,
      champion,
      opponent,
      difficulty,
      canvas: canvas.current,
      overlay: overlay.current,
      hud: hud.current,
      audio,
      online: active
        ? {
            role: active.role,
            seed: active.seed,
            hostChampion: active.hostChampion,
            guestChampion: active.guestChampion,
            room: active.room,
            onOpponentLeft: () => setOpponentLeft(true),
          }
        : undefined,
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
    g.setPing(online.pingMs);
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
    window.clearTimeout(swap.current);
    setStageOut(false);
    audio.unlock();
    audio.play("ui_click");
    setPaused(false);
    setOpponentLeft(false);
    setLastOnlineRole(null);
    setResult(null);
    setStats(EMPTY_STATS);
    setScreen("game");
    setRun((n) => n + 1);
  }, [audio]);

  const toMenu = useCallback(() => {
    if (online.activeMatch || lastOnlineRole) {
      online.leaveRoom();
    }
    setPaused(false);
    setOpponentLeft(false);
    setLastOnlineRole(null);
    setResult(null);
    setScreen("menu");
    setRun((n) => n + 1);
  }, [lastOnlineRole, online]);

  // The menu shows the new pick at once; the demo fight behind it fades out, restarts with the new champion and fades in.
  const pick = (id: string) => {
    if (!isChampionId(id) || id === champion) return;
    audio.unlock();
    audio.play("ui_click");
    setChampion(id);
    online.setChampion(id);
    if (screen !== "menu") return;
    setStageOut(true);
    window.clearTimeout(swap.current);
    swap.current = window.setTimeout(() => {
      setRun((n) => n + 1);
      setStageOut(false);
    }, STAGE_FADE_MS);
  };

  const inGame = screen !== "menu";
  const displayScore: [number, number] | null = result
    ? lastOnlineRole === "guest"
      ? [result.score[1], result.score[0]]
      : result.score
    : null;

  return (
    <>
      <canvas key={run} ref={canvas} className={`stage${screen === "menu" ? " demo" : ""}${stageOut ? " out" : ""}`} tabIndex={0} aria-label="Арена" />
      <div ref={overlay} className={stageOut ? "ov out" : "ov"} />
      <div ref={hud} className="hud" hidden={!inGame || screen === "end"} />

      {screen === "menu" && (
        <Menu
          champion={champion}
          mode={mode}
          difficulty={difficulty}
          online={online}
          onChampion={pick}
          onMode={setMode}
          onDifficulty={setDifficulty}
          onStart={start}
        />
      )}

      {screen === "game" && mode === "training" && !isOnlineMatch && !paused && (
        <TrainingPanel champion={champion} stats={stats} onCommand={(c) => game.current?.command(c)} onTuning={(t) => game.current?.setTuning(t)} />
      )}

      {screen === "game" && isOnlineMatch && opponentLeft && (
        <div className="screen">
          <div className="panel small">
            <h1>Соперник отключился</h1>
            <p className="sub">P2P-соединение с соперником прервано.</p>
            <div className="row">
              <button className="go" onClick={toMenu}>
                Выйти в меню
              </button>
            </div>
          </div>
        </div>
      )}

      {screen === "game" && paused && !opponentLeft && (
        <div className="screen">
          <div className="panel small">
            <h1>{isOnlineMatch ? "Меню" : "Пауза"}</h1>
            {isOnlineMatch && <p className="sub">Матч продолжается в фоне</p>}
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

      {screen === "end" && result && displayScore && (
        <div className="screen">
          <div className="panel small">
            <h1 style={{ color: result.won ? "var(--ally)" : "var(--foe)" }}>{result.won ? "Победа" : "Поражение"}</h1>
            <p className="sub">
              Счёт {displayScore[0]} : {displayScore[1]} ·{" "}
              {lastOnlineRole ? "онлайн 1 на 1 (P2P)" : `бот (${DIFFICULTY_NAMES[difficulty]})`}
            </p>
            {lastOnlineRole && online.status !== "connected" && <p className="keys warn">Соперник покинул комнату.</p>}
            <div className="row">
              {lastOnlineRole ? (
                <>
                  {online.status === "connected" && (
                    <button className="go" onClick={online.requestRematch} disabled={online.rematchState.mine}>
                      {online.rematchState.mine
                        ? "Ждём соперника…"
                        : online.rematchState.theirs
                          ? "Соперник ждёт — Реванш!"
                          : "Реванш"}
                    </button>
                  )}
                  <button className="ghost" onClick={toMenu}>
                    Выйти в меню
                  </button>
                </>
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
