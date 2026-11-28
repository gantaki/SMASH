// Gameplay events emitted by step(). The client turns them into VFX, SFX, floating text and messages.
// They are plain data and carry positions so presentation never has to diff sim state.

import type { AbilitySlot } from "@smash/content";
import type { Phase } from "./state.ts";

export type StatusKind = "stun" | "slow" | "root" | "burn" | "shield" | "empowered" | "counter" | "brace" | "hover";

export type ObstacleKind = "stone" | "wood" | "crate" | "wall";

export type ProjectileEndReason = "hit" | "blocked" | "expired" | "split" | "hook";

export type TargetKind = "champion" | "companion" | "orb";

export type SimEvent =
  | { t: "phase"; phase: Phase; round: number }
  | { t: "countdown"; n: number }
  /** winner -1: both champions died in the same tick; nobody scores and the round is replayed. */
  | { t: "roundEnd"; winner: 0 | 1 | -1; score: [number, number] }
  | { t: "matchEnd"; winner: 0 | 1; score: [number, number] }
  | { t: "castStart"; unit: number; slot: AbilitySlot; abilityId: string }
  /** reason "cancelled": the player aborted it; "interrupted": stun, knockback, pull or death. */
  | { t: "castCancel"; unit: number; slot: AbilitySlot; abilityId: string; reason: "cancelled" | "interrupted" }
  | { t: "abilityFire"; unit: number; slot: AbilitySlot; abilityId: string; x: number; z: number; aimX: number; aimZ: number; empowered: boolean }
  | { t: "projectileSpawn"; id: number; owner: number; abilityId: string | null; x: number; z: number }
  | { t: "projectileEnd"; id: number; x: number; z: number; reason: ProjectileEndReason; heavy: boolean; abilityId: string | null; team: 0 | 1 }
  | { t: "groundSpawn"; id: number; x: number; z: number; radius: number; abilityId: string }
  | { t: "groundBurst"; id: number; x: number; z: number; radius: number; abilityId: string; falling: boolean }
  | {
      t: "damage";
      /** Unit id, or -1 for the orb. */
      target: number;
      targetKind: TargetKind;
      /** Champion credited with the damage, or -1 (zone, rifts). */
      source: number;
      amount: number;
      absorbed: number;
      x: number;
      z: number;
      dot: boolean;
      /**
       * Where the hit physically came from, when it has a direction: the attacker (champion or companion),
       * a point behind a projectile on its path, the centre of a blast. Absent for burn, zone, rifts and slams.
       * `source` is who gets the credit, which for a companion is its owner standing somewhere else.
       */
      fromX?: number;
      fromZ?: number;
    }
  | { t: "meleeHit"; source: number; target: number; abilityId: string; empowered: boolean }
  | { t: "status"; unit: number; status: StatusKind; duration: number }
  | { t: "counter"; unit: number; attacker: number }
  | { t: "slam"; unit: number; x: number; z: number }
  | { t: "blink"; unit: number; fromX: number; fromZ: number; toX: number; toZ: number }
  | { t: "leapLand"; unit: number; x: number; z: number; radius: number; abilityId: string }
  | { t: "nova"; unit: number; x: number; z: number; radius: number; abilityId: string }
  | { t: "channelTick"; unit: number; x: number; z: number; radius: number; abilityId: string }
  | { t: "channelEnd"; unit: number }
  | { t: "death"; unit: number }
  | { t: "respawn"; unit: number }
  | { t: "companionDeath"; unit: number; killer: number }
  /** A companion appears beside its owner to carry out a command. */
  | { t: "companionSummon"; unit: number; x: number; z: number }
  /** The command is over and the companion leaves the field (unharmed). */
  | { t: "companionLeave"; unit: number; x: number; z: number }
  /** A rolling companion bounced off something. */
  | { t: "companionBounce"; unit: number; x: number; z: number }
  /** A companion opened a gravity well. */
  | { t: "companionWell"; unit: number; x: number; z: number; radius: number; duration: number }
  | { t: "companionCommand"; unit: number; x: number; z: number }
  | { t: "companionAttack"; unit: number; target: number; heavy: boolean; x: number; z: number }
  | { t: "companionInteract"; kind: "split" | "pullCaster"; unit: number; x: number; z: number }
  | { t: "energy"; unit: number; amount: number }
  | { t: "obstacleHit"; id: number; kind: ObstacleKind; x: number; z: number }
  | { t: "obstacleBreak"; id: number; kind: ObstacleKind; x: number; z: number }
  /** A wall was raised by an ability. */
  | { t: "wallRaise"; id: number; x: number; z: number }
  /** A raised wall's time was up and it crumbled. */
  | { t: "wallExpire"; id: number; x: number; z: number }
  /** A wall was burst by its owner's line ability: everything within `radius` was hit. */
  | { t: "wallShatter"; id: number; x: number; z: number; radius: number; abilityId: string }
  /** A ring of walls went up around (x, z). */
  | { t: "ringRaise"; id: number; x: number; z: number; radius: number; duration: number; abilityId: string }
  | { t: "line"; unit: number; x0: number; z0: number; x1: number; z1: number; halfWidth: number; abilityId: string }
  /** A charge caught `target` and is carrying it along. */
  | { t: "dashHit"; unit: number; target: number; abilityId: string }
  /** Two things traded places. `target` is a unit id, `obstacle` an obstacle id; the one that does not apply is -1. */
  | { t: "swap"; unit: number; target: number; obstacle: number; ax: number; az: number; bx: number; bz: number }
  | { t: "lift"; unit: number; obstacle: number; x: number; z: number }
  /** A held crate was thrown, or put down (`thrown` false). */
  | { t: "release"; unit: number; obstacle: number; x: number; z: number; thrown: boolean }
  /** The floor under the obstacle is gone and it went down with it. */
  | { t: "obstacleFall"; id: number; x: number; z: number }
  /** Floor tiles (ids = indices into floorTiles) took damage and still hold. */
  | { t: "floorCrack"; tiles: number[] }
  /** Tiles broke: they stay solid for arena.floor.crumbleTime, then drop. */
  | { t: "floorCrumble"; tiles: number[] }
  /** Tiles dropped into the abyss: holes from now on. */
  | { t: "floorDrop"; tiles: number[] }
  | { t: "rimHit"; segment: number; x: number; z: number }
  /** A section of the arena wall is gone. `fell`: the floor under it dropped, rather than it being broken. */
  | { t: "rimBreak"; segment: number; x: number; z: number; fell: boolean }
  /** A unit went into the abyss (a death or companionDeath event follows). `by`: champion who shoved or pulled it there, or -1. */
  | { t: "fall"; unit: number; x: number; z: number; by: number }
  | { t: "crateBump"; id: number; x: number; z: number }
  | { t: "crateHit"; id: number; target: number; x: number; z: number }
  | { t: "orbSpawn" }
  | { t: "orbBreak"; by: number; heal: number; energy: number }
  | { t: "suddenDeath" }
  | { t: "riftOpen"; id: number }
  | { t: "riftWarn"; id: number }
  | { t: "riftErupt"; id: number };

export type SimEventType = SimEvent["t"];
