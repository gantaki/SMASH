// Wood walls rebuilding and crates sliding around.

import { rules } from "@smash/content";
import { applyOnHit, damageObstacle } from "./combat.ts";
import type { Ctx } from "./context.ts";
import { rimPenetration, solidAt } from "./floor.ts";
import { obstaclePenetration } from "./geometry.ts";
import { unitById } from "./state.ts";

/** Below this speed a crate is considered at rest (numerical cut-off). */
const CRATE_REST_SPEED = 0.05;

export function updateObstacles(ctx: Ctx): void {
  const { state, dt } = ctx;
  const fight = state.phase === "fight";
  const cfg = rules.obstacles;
  for (const o of state.obstacles) {
    if (o.kind === "wood") {
      if (o.alive || o.fallen || !fight) continue;
      o.respawn -= dt;
      if (o.respawn > 0) continue;
      // Rebuild only if nothing stands in the spot, and only on floor that is still there.
      o.alive = true;
      const occupied =
        !solidAt(state, o.x, o.z) ||
        state.units.some((u) => !u.dead && obstaclePenetration(o, u.x, u.z, u.radius)) ||
        state.obstacles.some((c) => c.kind === "crate" && obstaclePenetration(o, c.x, c.z, c.radius));
      if (occupied) {
        o.alive = false;
        o.respawn = cfg.rebuildRetry;
      } else {
        o.hp = o.maxHp;
        ctx.events.push({ t: "obstacleRebuild", id: o.id });
      }
      continue;
    }
    if (o.kind !== "crate" || !o.alive) continue;
    const speed = Math.hypot(o.vx, o.vz);
    if (speed <= CRATE_REST_SPEED) {
      o.vx = o.vz = 0;
      continue;
    }
    const next = Math.max(0, speed - cfg.crateFriction * dt);
    o.vx *= next / speed;
    o.vz *= next / speed;
    o.x += o.vx * dt;
    o.z += o.vz * dt;
    o.spin += next * dt * 0.5;
    for (const q of state.obstacles) {
      if (q === o) continue;
      const pen = obstaclePenetration(q, o.x, o.z, o.radius);
      if (!pen) continue;
      o.x += pen.nx * pen.depth;
      o.z += pen.nz * pen.depth;
      if (q.kind === "crate") {
        q.vx += o.vx * cfg.crateTransfer;
        q.vz += o.vz * cfg.crateTransfer;
        q.pusher = o.pusher;
        q.pusherTeam = o.pusherTeam;
        o.vx *= cfg.crateKeepAfterCrate;
        o.vz *= cfg.crateKeepAfterCrate;
      } else {
        const vn = o.vx * pen.nx + o.vz * pen.nz;
        if (vn < 0) {
          o.vx -= cfg.crateBounce * vn * pen.nx;
          o.vz -= cfg.crateBounce * vn * pen.nz;
        }
        o.vx *= cfg.crateKeepAfterBounce;
        o.vz *= cfg.crateKeepAfterBounce;
        if (q.kind === "wood") damageObstacle(ctx, q, speed * cfg.crateRamDamagePerSpeed);
      }
      ctx.events.push({ t: "crateBump", id: o.id, x: o.x, z: o.z });
    }
    // Bounces off the arena wall; through a gap it slides out and drops (terrain.ts).
    const wall = rimPenetration(state, o.x, o.z, cfg.crateWallMargin);
    if (wall) {
      o.x += wall.nx * wall.depth;
      o.z += wall.nz * wall.depth;
      o.vx *= -cfg.crateWallBounce;
      o.vz *= -cfg.crateWallBounce;
    }
    if (speed > cfg.crateHitSpeed && fight) {
      for (const t of state.units) {
        if (t.dead || (o.pusherTeam !== -1 && t.team === o.pusherTeam)) continue;
        if (t.kind === "champion" && t.leap) continue;
        if (Math.hypot(t.x - o.x, t.z - o.z) >= o.radius + t.radius) continue;
        const pusher = o.pusher >= 0 ? (unitById(state, o.pusher) ?? null) : null;
        // Knock the target along the crate's direction of travel.
        applyOnHit(ctx, t, cfg.crateHit, pusher, t.x - o.vx / speed, t.z - o.vz / speed, { dot: true });
        ctx.events.push({ t: "crateHit", id: o.id, target: t.id, x: t.x, z: t.z });
        o.vx *= cfg.crateKeepAfterHit;
        o.vz *= cfg.crateKeepAfterHit;
        break;
      }
    }
  }
}
