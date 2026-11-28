# ADR 0003: WebRTC P2P online 1v1 prototype on static Vercel

- **Status:** accepted · M2 prototype
- **Date:** 2026-11-27

## Context

The client is deployed as a static site on Vercel (`apps/client/dist`), which cannot host long-lived WebSocket game servers. Before investing in hosting and operating a dedicated `apps/server` instance for M2, we want a working online 1v1 prototype that friends can play directly via `/r/CODE` links on Vercel with zero backend setup.

## Decisions

1. **WebRTC DataChannel via `trystero` (public Nostr signaling).**
   - `apps/client/src/net/p2p.ts` joins a room keyed by the 4-character code (`identity: "none"` so separate tabs get distinct peer IDs) and uses public Google/Cloudflare STUN servers (with optional `VITE_ICE_SERVERS` JSON override to inject TURN relays).
   - No backend server is required for signaling or match transport.

2. **Host-authoritative 60 Hz sim + Guest prediction & reconciliation.**
   - Room creator (`wantsHost: true`, with deterministic lexicographical `peerId` tie-break in `resolvePeerRole`) runs `HostSession` (Team 0) at 60 Hz (`TICK_DT`), consumes sanitized `NetInput`s from the Guest, and emits `NetSnapshot`s every 3 ticks (20 Hz) plus on critical phase/round/match transitions.
   - Guest (`GuestSession`, Team 1) predicts its own champion locally at 60 Hz (`stepLocal`), applies authoritative `SimEvent`s from snapshots, and reconciles by cloning the snapshot state and replaying unacknowledged inputs (`applySnapshot`).
   - Kill cam is temporarily disabled in online mode (M2 server-held round end comes later).

3. **Transport-agnostic protocol (`packages/protocol/src/net.ts`).**
   - `NetInput`, `NetSnapshot`, `PeerControlMessage`, `PingPacket`, `sanitizeNetInput`, and `resolvePeerRole` live in `@smash/protocol` with no WebRTC or DOM dependencies.
   - `HostSession` and `GuestSession` (`apps/client/src/net/reconcile.ts`) depend only on `@smash/content`, `@smash/protocol`, and `@smash/sim`.

## Consequences

- Online 1v1 works directly on Vercel static hosting with `/r/CODE` invite links, live ping, and rematch.
- Migrating to the dedicated authoritative server (`apps/server`) later only requires swapping `createP2PRoom` for a WebSocket/WebTransport adapter carrying the same `NetInput` / `NetSnapshot` messages.
- Without a TURN server (`VITE_ICE_SERVERS`), ~10–20% of connections behind strict symmetric NATs or restrictive firewalls may fail to establish a direct P2P path.
- Public Nostr relays are shared community infrastructure; production scaling or matchmaking should move to dedicated signaling or `apps/server`.
