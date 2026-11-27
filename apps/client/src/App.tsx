import { useEffect, useRef, useState } from "react";
import { ABILITY_SLOTS, SLOT_KEYS, championList } from "@smash/content";
import { ArenaView } from "./game/ArenaView.ts";
import { useLobby } from "./net/useLobby.ts";

export function App() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [name] = useState(() => `Player${Math.floor(Math.random() * 900 + 100)}`);
  const [code, setCode] = useState("");
  const net = useLobby(name);
  const me = net.lobby?.players.find((p) => p.id === net.playerId);

  useEffect(() => {
    const view = new ArenaView(canvas.current!);
    return () => view.dispose();
  }, []);

  return (
    <>
      <canvas ref={canvas} className="stage" />
      <main className="panel">
        <header>
          <h1>SMASH</h1>
          <span className={`status ${net.status}`}>server: {net.status}</span>
        </header>

        {(net.status === "no-server" || net.status === "offline") && (
          <p className="notice">
            {net.status === "no-server"
              ? "The multiplayer server is not deployed yet, so rooms are unavailable here."
              : "Cannot reach the game server. Start it with pnpm dev."}{" "}
            Meanwhile, <a href="/prototype/">play the prototype vs a bot</a>.
          </p>
        )}

        {!net.lobby ? (
          <section className="row">
            <button onClick={net.create} disabled={net.status !== "online"}>
              Create room
            </button>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="CODE" maxLength={4} />
            <button onClick={() => net.join(code)} disabled={net.status !== "online" || code.length !== 4}>
              Join
            </button>
          </section>
        ) : (
          <section>
            <p>
              Room <b>{net.lobby.code}</b> · share <code>{location.origin}/r/{net.lobby.code}</code>
            </p>
            <ul className="players">
              {net.lobby.players.map((p) => (
                <li key={p.id} className={p.team === 0 ? "ally" : "enemy"}>
                  {p.name}
                  {p.id === net.lobby?.hostId ? " (host)" : ""} — {p.champion ?? "picking…"} {p.ready ? "✓" : ""}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="champs">
          {championList.map((c) => (
            <button
              key={c.id}
              className={`champ ${me?.champion === c.id ? "picked" : ""}`}
              style={{ borderColor: c.color }}
              onClick={() => net.pick(c.id)}
              disabled={!net.lobby}
            >
              <b style={{ color: c.color }}>{c.name}</b> <small>{c.role} · {c.hp} HP</small>
              <span className="abilities">
                {ABILITY_SLOTS.map((s) => `${SLOT_KEYS[s]}: ${c.abilities[s].name}`).join(" · ")}
              </span>
            </button>
          ))}
        </section>

        {me && (
          <button onClick={() => net.setReady(!me.ready)} disabled={!me.champion}>
            {me.ready ? "Not ready" : "Ready"}
          </button>
        )}
        {net.error && <p className="error">{net.error}</p>}
        <p className="hint">
          M0 skeleton: lobby over WebSocket + static arena. Gameplay comes in M1. · <a href="/prototype/">Prototype</a>
        </p>
      </main>
    </>
  );
}
