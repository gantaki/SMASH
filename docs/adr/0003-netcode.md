# ADR 0003: Netcode for online 1v1

Status: accepted · M2

## Context

The design asks for server authority with client prediction. The simulation is deterministic and its state is plain data (ADR 0002), a duel has ten-odd entities, and the audience is friends on ordinary connections (30–120 ms round trip).

## Decisions

1. **Authoritative server, same sim.** One `NetMatch` per room steps the shared `step()` at 60 Hz. The server never trusts the client beyond its inputs, which are rebuilt field by field (`sanitizeInput`).
2. **Inputs are a queue, not timestamps.** The client numbers its per-tick inputs; the server consumes one per tick, keeps at most three buffered, and reports the last consumed number with every snapshot. No clock synchronisation is needed. The cost: a drifting client clock shows up as an occasional starved or skipped tick (a one-tick correction), and the buffer adds up to 50 ms after a burst.
3. **Predict the whole world, not just the local champion.** On each snapshot the client clones the authoritative state and re-simulates its unacknowledged inputs with the full sim. This is a dozen lines because the sim is deterministic; it makes the local champion exact (including wind-ups, cooldowns, buffering, cancel) and keeps one timeline for rendering.
   - Trade-off: the opponent is *extrapolated* (assumed to keep their last movement and aim) instead of shown ~100 ms in the past as the M0 design doc planned. A change of direction appears one round trip late and is eased in by the view. If playtests show this reads badly, interpolating remote units is a client-only change.
4. **Presentation is split by who caused it.** The player's own actions are shown from the prediction immediately and remembered; when the server's copy of the same event arrives it is dropped. Everything else is shown only when the server reports it, so a predicted hit can never be shown and then taken back.
5. **Full-state JSON snapshots at 30 Hz, compressed by the WebSocket layer.** ≈7 kB raw, ≈2 kB on the wire, ≈56 kB/s per player. Simple and debuggable; binary deltas are an optimisation for when rooms grow.
6. **The kill cam is a server-provided replay.** The server keeps the last 0.6 s of (state, both inputs), sends them when a round ends and pauses the match; clients re-simulate. Clients do not need the opponent's inputs during normal play.
7. **Transport and time stay outside the logic.** `NetMatch` and `Prediction` take messages in and hand messages out; the socket code and the timer live in `apps/server/src/index.ts` and `apps/client/src/net/NetClient.ts`. `tests/netcode.test.ts` runs both ends over a simulated link with latency.

## Consequences

- A disconnect forfeits the match (no reconnect yet).
- Fairness depends on the server's location: both players pay their own latency, neither hosts.
- The server needs a container host; the static client stays on Vercel.
