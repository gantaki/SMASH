import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isChampionId, playableChampions, type BotDifficulty, type ChampionId } from "@smash/content";
import { AudioEngine } from "./audio/AudioEngine.ts";
import { Game, type GameMode, type TrainingStats } from "./game/Game.ts";
import { useOnlineRoom } from "./net/useOnlineRoom.ts";
import { Menu, type PlayMode } from "./ui/Menu.tsx";
import { TrainingPanel } from "./ui/TrainingPanel.tsx";

type Screen = "menu" | "game" | "end";

/** How long the old demo fight keeps playing over the new one while it fades out; matches `stage-leave` in styles.css. */
const LEAVE_MS = 650;
const EMPTY_STATS: TrainingStats = { dps: 0, lastHit: 0, total: 0, dummyMoves: false, suddenDeath: false };
const DIFFICULTY_NAMES: Record<BotDifficulty, string> = { easy: "лёгкий", normal: "средний", hard: "сложный" };

const defaultChampion = (): ChampionId => {
  const id = playableChampions[0]!.id;
  return isChampionId(id) ? id : "pyra";
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
  // A champion swap is a cross-fade, not a cut: the old demo fight keeps playing on its own canvas, laid over the new
  // one, until it has faded out. `leaving` is the run number of that old fight, `leavingGame` the game still driving it.
  const [leaving, setLeaving] = useState<number | null>(null);
  const leavingGame = useRef<Game | null>(null);
  // Set just before a swap so that the effect cleanup hands the old game over instead of disposing it.
  const handOver = useRef(false);
  // The demo fades in from the background only when there is nothing to cross-fade from (first load, back from a match).
  const [fadeIn, setFadeIn] = useState(true);
  const swap = useRef(0);

  const online = useOnlineRoom(champion);

  const dropLeaving = useCallback(() => {
    window.clearTimeout(swap.current);
    leavingGame.current?.dispose();
    leavingGame.current = null;
    setLeaving(null);
  }, []);

  // Browsers only allow audio after a user gesture: start loading sounds on the first click anywhere.
  useEffect(() => {
    const unlock = () => audio.unlock();
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, [audio]);

  useEffect(() => {
    if (!online.activeMatch) return;
    dropLeaving();
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

  const isOnlineMatch = screen !== "menu" && online.activeMatch !== null;
  const gameMode: GameMode = screen === "menu" ? "demo" : isOnlineMatch ? "online" : mode === "online" ? "duel" : mode;

  useEffect(() => {
    if (!canvas.current || !overlay.current || !hud.current) return;
    const active = isOnlineMatch ? online.activeMatch : null;
    // Bots play someone else from the roster, drawn afresh for every match (without repeats while there are enough).
    const others = playableChampions.map((c) => c.id).filter((id) => id !== champion);
    for (let i = others.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [others[i], others[j]] = [others[j]!, others[i]!];
    }
    const pick = (i: number) => others[i % Math.max(1, others.length)] ?? champion;
    const g = new Game({
      mode: gameMode,
      champion,
      opponent: pick(0),
      ally: pick(2),
      opponent2: pick(1),
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
        // A demo that is fading out may still finish its match: only the current one restarts the loop.
        if (gameMode === "demo") {
          if (game.current === g) setRun((n) => n + 1);
        }
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
      if (handOver.current) handOver.current = false;
      else g.dispose();
      if (game.current === g) game.current = null;
    };
    // The match is rebuilt only when a new run starts; menu selections apply to the next run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  const start = useCallback(() => {
    dropLeaving();
    audio.unlock();
    audio.play("ui_click");
    setPaused(false);
    setOpponentLeft(false);
    setLastOnlineRole(null);
    setResult(null);
    setStats(EMPTY_STATS);
    setScreen("game");
    setRun((n) => n + 1);
  }, [audio, dropLeaving]);

  const toMenu = useCallback(() => {
    if (online.activeMatch || lastOnlineRole) {
      online.leaveRoom();
    }
    setPaused(false);
    setOpponentLeft(false);
    setLastOnlineRole(null);
    setResult(null);
    setScreen("menu");
    setFadeIn(true);
    setRun((n) => n + 1);
  }, [lastOnlineRole, online]);

  // The new demo fight starts at once; the old one plays on above it and fades away.
  const pick = (id: string) => {
    if (!isChampionId(id) || id === champion) return;
    audio.unlock();
    audio.play("ui_click");
    setChampion(id);
    online.setChampion(id);
    if (screen !== "menu") return;
    dropLeaving();
    leavingGame.current = game.current;
    handOver.current = game.current !== null;
    setLeaving(run);
    setFadeIn(false);
    setRun((n) => n + 1);
    swap.current = window.setTimeout(dropLeaving, LEAVE_MS);
  };

  const inGame = screen !== "menu";
  const displayScore: [number, number] | null = result
    ? lastOnlineRole === "guest"
      ? [result.score[1], result.score[0]]
      : result.score
    : null;

  return (
    <>
      <canvas key={`stage-${run}`} ref={canvas} className={screen === "menu" && fadeIn ? "stage demo" : "stage"} tabIndex={0} aria-label="Арена" />
      <div key={`ov-${run}`} ref={overlay} className="ov" />
      {leaving !== null && <canvas key={`stage-${leaving}`} className="stage leaving" aria-hidden="true" />}
      {leaving !== null && <div key={`ov-${leaving}`} className="ov leaving" />}
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
