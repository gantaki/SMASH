// Gameplay events emitted by step(). The client turns them into VFX, SFX, floating text and messages.
// They are plain data and carry positions so presentation never has to diff sim state.

import type { AbilitySlot } from "@smash/content";
import type { Phase } from "./state.ts";

export type StatusKind = "stun" | "slow" | "root" | "burn" | "shield" | "empowered" | "counter";

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
  | { t: "companionRespawn"; unit: number }
  | { t: "companionCommand"; unit: number; x: number; z: number }
  | { t: "companionAttack"; unit: number; target: number; heavy: boolean; x: number; z: number }
  | { t: "companionInteract"; kind: "split" | "pullCaster"; unit: number; x: number; z: number }
  | { t: "energy"; unit: number; amount: number }
  | { t: "obstacleHit"; id: number; x: number; z: number }
  | { t: "obstacleBreak"; id: number; x: number; z: number }
  | { t: "obstacleRebuild"; id: number }
  | { t: "crateBump"; id: number; x: number; z: number }
  | { t: "crateHit"; id: number; target: number; x: number; z: number }
  | { t: "orbSpawn" }
  | { t: "orbBreak"; by: number; heal: number; energy: number }
  | { t: "suddenDeath" }
  | { t: "riftOpen"; id: number }
  | { t: "riftWarn"; id: number }
  | { t: "riftErupt"; id: number };

export type SimEventType = SimEvent["t"];
