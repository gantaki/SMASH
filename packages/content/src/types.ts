// Units: meters, seconds, meters/second. Angles in degrees.

export type ChampionId = "ember" | "fang";

export type AbilitySlot = "primary" | "secondary" | "mobility" | "q" | "e" | "ultimate";

export const ABILITY_SLOTS: readonly AbilitySlot[] = ["primary", "secondary", "mobility", "q", "e", "ultimate"];

/** Default key binding shown in the UI. */
export const SLOT_KEYS: Record<AbilitySlot, string> = {
  primary: "LMB",
  secondary: "RMB",
  mobility: "Space",
  q: "Q",
  e: "E",
  ultimate: "F",
};

/** What happens to a target that gets hit. */
export interface OnHit {
  damage: number;
  stun?: number;
  slow?: { amount: number; duration: number };
  burn?: { dps: number; duration: number };
  pull?: { stopDistance: number; duration: number };
  knockback?: { distance: number; duration: number };
}

interface AbilityCommon {
  id: string;
  name: string;
  nameRu: string;
  slot: AbilitySlot;
  /** Seconds. 0 for ultimates, which cost energy instead. */
  cooldown: number;
  energyCost?: number;
  /** Wind-up before the effect fires; shows a telegraph. */
  castTime?: number;
  /** Move speed multiplier while casting. */
  castMoveMultiplier?: number;
  /** Presentation ids, resolved by the client. */
  vfx?: { onHit?: string };
  description: string;
}

export interface ProjectileAbility extends AbilityCommon {
  kind: "projectile";
  speed: number;
  range: number;
  radius: number;
  onHit: OnHit;
}

export interface GroundAoeAbility extends AbilityCommon {
  kind: "groundAoe";
  maxRange: number;
  radius: number;
  delay: number;
  onHit: OnHit;
}

export interface ConeAbility extends AbilityCommon {
  kind: "cone";
  range: number;
  halfAngleDeg: number;
  onHit: OnHit;
  /** Used instead of onHit while the caster is empowered. */
  empoweredOnHit?: OnHit;
}

export interface BlinkAbility extends AbilityCommon {
  kind: "blink";
  maxRange: number;
}

export interface LeapAbility extends AbilityCommon {
  kind: "leap";
  maxRange: number;
  duration: number;
  landing: { radius: number; onHit: OnHit };
}

export interface ShieldBurstAbility extends AbilityCommon {
  kind: "shieldBurst";
  radius: number;
  onHit: OnHit;
  shield: { amount: number; duration: number };
}

export interface CounterAbility extends AbilityCommon {
  kind: "counter";
  duration: number;
  moveMultiplier: number;
  punishRange: number;
  punish: OnHit;
  empowerDuration: number;
}

export interface ChannelAbility extends AbilityCommon {
  kind: "channel";
  duration: number;
  moveMultiplier: number;
  tickInterval: number;
  radius: number;
  unstoppable: boolean;
  onTick: OnHit;
}

export type Ability =
  | ProjectileAbility
  | GroundAoeAbility
  | ConeAbility
  | BlinkAbility
  | LeapAbility
  | ShieldBurstAbility
  | CounterAbility
  | ChannelAbility;

export interface Champion {
  id: ChampionId;
  name: string;
  nameRu: string;
  role: string;
  hp: number;
  moveSpeed: number;
  radius: number;
  /** Signature color for UI and VFX, hex. */
  color: string;
  abilities: Record<AbilitySlot, Ability>;
}

export interface Vec2Data {
  x: number;
  z: number;
}

export interface ArenaConfig {
  radius: number;
  spawns: readonly [Vec2Data, Vec2Data];
  pillars: readonly (Vec2Data & { radius: number })[];
  orb: {
    spawnAt: number;
    hp: number;
    radius: number;
    respawnDelay: number;
    reward: { heal: number; energy: number };
  };
  zone: {
    startAt: number;
    shrinkSpeed: number;
    minRadius: number;
    damage: number;
    tickInterval: number;
  };
}

export interface MatchRules {
  tickRate: number;
  roundsToWin: number;
  countdown: number;
  roundEndDelay: number;
  inputBuffer: number;
  energy: { max: number; perDamage: number; passivePerSecond: number };
}
