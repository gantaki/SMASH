# ADR 0001: Web stack (TypeScript + Three.js) instead of Unity

- **Status:** accepted
- **Date:** 2026-11-27

## Context

SMASH is a Battlerite-like arena brawler for quick PvP sessions with friends: 3D characters with animations, 2D/3D VFX (Spine effects authored in BoneGyre), menus and an authoritative game server. Development is done mostly through AI coding agents.

Options considered:

1. **Unity 6.** Mature animation (Animator, humanoid retargeting, IK), VFX Graph, official spine-unity, off-the-shelf netcode with prediction/rollback (Netcode for Entities, Photon Fusion/Quantum), native Steam/console builds. Agents can drive the editor through MCP (official Unity MCP server in the Unity AI beta, plus community servers).
2. **Godot.** Text-based scenes are agent-friendly, real engine features, but no shared language with a web server and a smaller ecosystem.
3. **TypeScript + Three.js** in the browser, Node server.

## Decision

TypeScript + Three.js for the client, Node for the server, one shared TypeScript simulation package.

## Reasons

- **Link-to-fight in seconds.** The target play pattern (friends, short sessions, invites in a chat) depends on zero install. Unity web builds are heavy and slow to load.
- **Friends-only rooms remove the player-population risk** that usually argues for Steam distribution and matchmaking.
- **Shared simulation code** runs on the server (authority) and the client (prediction, bots, offline practice) without a second implementation.
- **Agent workflow.** Everything is text and code; agents can run headless matches, tests and screenshot checks in the cloud without a running editor.
- **Existing expertise:** React/TypeScript, Spine, BoneGyre.

## Consequences

- We build ourselves what Unity provides: animation state machine, VFX layer, netcode (prediction, reconciliation, interpolation), asset pipeline.
- Mitigations: all humanoids share one skeleton (no retargeting needed); Spine effects through the official `spine-threejs` runtime; start netcode simple (server authority + own-champion prediction) and validate early (milestone M2).
- WebSocket (TCP) may stutter under packet loss; upgrade path is WebRTC DataChannels or WebTransport.
- Revisit if the goal shifts to public matchmaking on Steam, consoles or a native mobile client.
