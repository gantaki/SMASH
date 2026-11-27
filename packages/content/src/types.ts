// Units: meters, seconds, meters/second. Angles in degrees. Colors are "#rrggbb".
// Everything here is plain data: adding a champion, ability or companion is a data change.
// New *mechanics* need a new `kind` here plus one behaviour in packages/sim/src/abilities.ts.

export type AbilitySlot = "primary" | "secondary" | "mobility" | "q" | "e" | "companion" | "ultimate";

export const ABILITY_SLOTS: readonly AbilitySlot[] = ["primary", "secondary", "mobility", "q", "e", "companion", "ultimate"];

/** Default key binding shown in the UI. */
export const SLOT_KEYS: Record<AbilitySlot, string> = {
  primary: "LMB",
  secondary: "RMB",
  mobility: "Space",
  q: "Q",
  e: "E",
  companion: "R",
  ultimate: "F",
};

/**
 * Kit template every champion follows (keeps champions comparable and readable for opponents):
 * primary = spammable basic attack · secondary = heavier skill-shot on a cooldown · mobility = escape / gap closer
 * q = control · e = defence · companion = one command for the companion · ultimate = costs full energy.
 */
export const SLOT_ROLES: Record<AbilitySlot, string> = {
  primary: "basic attack",
  secondary: "skill-shot",
  mobility: "mobility",
  q: "control",
  e: "defence",
  companion: "companion command",
  ultimate: "ultimate",
};

/** What happens to a target that gets hit. All fields are optional except damage. */
export interface OnHit {
  damage: number;
  stun?: number;
  /** Cannot move or use mobility, can still cast. */
  root?: number;
  /** `fading`: a fading snare. It starts at `amount` and wears off linearly over `duration`. */
  slow?: { amount: number; duration: number; fading?: boolean };
  burn?: { dps: number; duration: number };
  /** Drags the target toward the source, stopping `stopDistance` away. */
  pull?: { stopDistance: number; duration: number };
  /** Pushes the target away. Hitting an obstacle or the arena wall on the way is a slam (see rules.slam). */
  knockback?: { distance: number; duration: number; slamStun?: number; slamDamage?: number };
}

/** How a projectile looks; the client turns this into meshes and particles. */
export interface ProjectileVisual {
  core: string;
  glow: string;
  /** Core radius in meters (the glow is drawn larger). */
  size: number;
  heavy?: boolean;
}

export interface ProjectileSpec {
  speed: number;
  range: number;
  radius: number;
  onHit: OnHit;
  visual: ProjectileVisual;
  /** Speed added to a crate it hits. */
  cratePush?: number;
}

/** Sound ids resolved by the client (apps/client/src/audio). */
export interface AbilitySfx {
  cast?: string;
  fire?: string;
  hit?: string;
}

interface AbilityCommon {
  id: string;
  name: string;
  nameRu: string;
  descriptionRu: string;
  /** Icon id resolved by the client. */
  icon: string;
  /** Seconds. 0 for ultimates, which cost energy instead. */
  cooldown: number;
  energyCost?: number;
  /** Wind-up before the effect fires; shows a telegraph. Interrupted by stun and forced movement. */
  castTime?: number;
  /** Move speed multiplier while casting. */
  castMoveMultiplier?: number;
  /** After the effect fires: seconds before another ability can start. Movement is not restricted. */
  recovery?: number;
  /** Ability color for telegraph fills, particles and UI. */
  color: string;
  sfx?: AbilitySfx;
  /** Presentation ids, resolved by the client. */
  vfx?: { onHit?: string };
}

/** What a projectile does when it touches the caster's own companion. */
export type CompanionInteraction =
  | { kind: "split"; count: number; spreadDeg: number; projectile: ProjectileSpec }
  | { kind: "pullCaster"; stopDistance: number };

export interface ProjectileAbility extends AbilityCommon, ProjectileSpec {
  kind: "projectile";
  /** Hook: draws a chain, pulls crates to the caster. */
  hook?: boolean;
  throughCompanion?: CompanionInteraction;
}

export interface GroundAoeAbility extends AbilityCommon {
  kind: "groundAoe";
  maxRange: number;
  radius: number;
  /** Seconds between the marker appearing and the explosion (after the cast time, if any). */
  delay: number;
  onHit: OnHit;
  /** Speed given to crates inside the blast. */
  cratePush?: number;
  /** Purely visual: draw something falling from the sky during the delay. */
  falling?: boolean;
}

export interface ConeAbility extends AbilityCommon {
  kind: "cone";
  range: number;
  halfAngleDeg: number;
  onHit: OnHit;
  /** Used instead of onHit while the caster is empowered (consumes the buff). */
  empoweredOnHit?: OnHit;
  cratePush?: number;
}

export interface BlinkAbility extends AbilityCommon {
  kind: "blink";
  maxRange: number;
}

export interface LeapAbility extends AbilityCommon {
  kind: "leap";
  maxRange: number;
  /** Air time in seconds. The caster cannot be hit by ground effects' collision while airborne, but can be damaged. */
  duration: number;
  landing: { radius: number; onHit: OnHit; cratePush?: number };
}

export interface NovaAbility extends AbilityCommon {
  kind: "nova";
  radius: number;
  onHit: OnHit;
  shield?: { amount: number; duration: number };
  cratePush?: number;
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

/** Sends the champion's companion to the aim point. What it does there is in CompanionDef.command. */
export interface CompanionCommandAbility extends AbilityCommon {
  kind: "companionCommand";
}

export type Ability =
  | ProjectileAbility
  | GroundAoeAbility
  | ConeAbility
  | BlinkAbility
  | LeapAbility
  | NovaAbility
  | CounterAbility
  | ChannelAbility
  | CompanionCommandAbility;

export type AbilityKind = Ability["kind"];

export type CompanionAttack =
  | { kind: "ranged"; interval: number; range: number; projectile: ProjectileSpec }
  /** Guards the owner: engages enemy champions that come within guardRange of the owner, for guardTime seconds. */
  | { kind: "melee"; interval: number; damage: number; guardRange: number; guardTime: number; leash: number };

export type CompanionCommand =
  /** Flies to the point and holds it, attacking faster/further. */
  | { kind: "sentry"; maxRange: number; duration: number; interval: number; range: number }
  /** Sprints to the point; the first enemy champion touched takes onHit, then the companion fights for engageTime. */
  | { kind: "pounce"; maxRange: number; onHit: OnHit; engageTime: number; searchRange: number; searchEngageTime: number };

export interface CompanionDef {
  id: string;
  name: string;
  nameRu: string;
  hp: number;
  radius: number;
  moveSpeed: number;
  /** Speed while executing a command. */
  commandSpeed: number;
  /** Flying companions ignore obstacles. */
  flying: boolean;
  /** Where it idles relative to the owner: angle from the owner's facing, and distance. */
  follow: { angleDeg: number; distance: number };
  attack: CompanionAttack;
  command: CompanionCommand;
  color: string;
}

/**
 * The core numbers that define a champion's body. Everything else about a champion is its abilities.
 * Keep this list short: a new stat must be read by the sim and be visible to players.
 */
export interface ChampionStats {
  /** Health pool. Reference: squishy 170, average 195, tank 220. */
  hp: number;
  /** Top speed in m/s. Reference: 6.0 (ranged) to 6.4 (melee). The arena is 40 m across. */
  moveSpeed: number;
  /** Collision and hit radius in meters. */
  radius: number;
  /** Knockback and pull distances are divided by this. 1 = normal, above 1 = heavy. */
  weight: number;
}

/** How a bot plays the champion. Ability usage is decided per ability kind in packages/sim/src/bot.ts. */
export interface BotProfile {
  style: "ranged" | "melee";
  /** Distance to the enemy the bot tries to keep: approaches above max, retreats below min. */
  keepRange: { min: number; max: number };
}

export interface Champion {
  id: string;
  name: string;
  nameRu: string;
  roleRu: string;
  blurbRu: string;
  /** Shown in the champion picker. Training targets are not. */
  playable: boolean;
  stats: ChampionStats;
  /** Signature color for UI and VFX. */
  color: string;
  /** Particle gradient: start and end color. */
  particles: readonly [string, string];
  abilities: Partial<Record<AbilitySlot, Ability>>;
  companion?: CompanionDef;
  bot: BotProfile;
}

export interface Vec2Data {
  x: number;
  z: number;
}

export type ObstacleDef =
  /** Indestructible. Blocks movement, projectiles and line of sight. */
  | { kind: "stone"; x: number; z: number; radius: number }
  /** Breakable wall (oriented box). Rebuilds after rules.obstacles.woodRespawn. rotDeg 0 = long side along x. */
  | { kind: "wood"; x: number; z: number; halfWidth: number; halfDepth: number; rotDeg: number; hp: number }
  /** Movable. Pushed by knockbacks, pulled by hooks; hurts enemies when it flies into them. */
  | { kind: "crate"; x: number; z: number; radius: number };

export interface ArenaConfig {
  radius: number;
  /** Distance kept between a unit's centre and the arena wall. */
  wallMargin: number;
  spawns: readonly [Vec2Data, Vec2Data];
  obstacles: readonly ObstacleDef[];
  orb: {
    spawnAt: number;
    hp: number;
    radius: number;
    respawnDelay: number;
    reward: { heal: number; energy: number };
  };
  suddenDeath: SuddenDeathConfig;
}

/**
 * Sudden death ends rounds that drag on: the safe zone shrinks and rifts crack the floor open.
 * Rifts are spawned in point-symmetric pairs so neither side is favoured.
 */
export interface SuddenDeathConfig {
  /** Round time at which it starts. */
  startAt: number;
  zone: {
    shrinkSpeed: number;
    minRadius: number;
    damage: number;
    tickInterval: number;
  };
  rifts: {
    /** Seconds after sudden death starts when the first pair opens. */
    firstAfter: number;
    /** Seconds between pairs. */
    interval: number;
    maxPairs: number;
    length: { min: number; max: number };
    segments: number;
    /** Max heading change between segments. */
    jitterDeg: number;
    /** Half of the crack's width; a unit is "over the rift" within halfWidth + part of its radius. */
    halfWidth: number;
    /** Geyser cycle: dormant → warn (telegraph) → erupt (damage) → dormant. */
    cycle: { dormant: number; warn: number; erupt: number };
    /** The first warning after a rift opens lasts this long instead of cycle.warn. */
    openWarn: number;
    damage: number;
    tickInterval: number;
    slow?: { amount: number; duration: number };
  };
}

export interface MovementConfig {
  /** Seconds to reach top speed from standstill. 0 = instant. */
  accelTime: number;
  /** Seconds to stop from top speed. 0 = instant. */
  decelTime: number;
  /** How fast the body turns toward the aim point, rad/s (exponential smoothing rate). */
  turnRate: number;
  /** Same, while casting: the champion snaps to its target. */
  castTurnRate: number;
}

export interface MatchRules {
  tickRate: number;
  roundsToWin: number;
  countdown: number;
  roundEndDelay: number;
  inputBuffer: number;
  /** Cancelling your own wind-up or channel (C). The cooldown is on the cancel itself. */
  cancelCast: { cooldown: number };
  movement: MovementConfig;
  energy: { max: number; perDamage: number; perCompanionDamage: number; passivePerSecond: number };
  /** Knockback into an obstacle or the arena wall. Abilities can add to both numbers. */
  slam: { stun: number; damage: number; woodDamage: number; crateImpulse: number };
  burn: { tickInterval: number };
  /** Area effects reach a target's centre within their radius plus this fraction of the target's radius. */
  areaBodyFactor: number;
  projectile: {
    /** Distance in front of a champion / companion at which its projectiles appear. */
    muzzleOffset: number;
    companionMuzzleOffset: number;
    /** A projectile ignores its owner's companion for this many meters after launch. */
    companionArmDistance: number;
    companionTouchPad: number;
    /** Projectiles die this far inside the arena wall. */
    wallMargin: number;
    /** Seconds a hook takes to pull its caster to the companion. */
    pullCasterDuration: number;
    /** A hooked crate stops this far in front of the caster. */
    hookCrateStop: number;
  };
  companion: {
    respawn: number;
    killEnergy: number;
    /** Distance at which a commanded companion has arrived. */
    arriveDistance: number;
    /** Extra reach when a pouncing companion touches an enemy, and when it bites. */
    pounceTouchPad: number;
    bitePad: number;
    /** Move speed factor while chasing its target. */
    engageSpeedFactor: number;
    /** Enemy champions are preferred over companions by this many meters when picking a target. */
    championPriority: number;
  };
  obstacles: {
    woodRespawn: number;
    /** Seconds before retrying a rebuild when something stands in the wall's spot. */
    rebuildRetry: number;
    /** Crate collisions: share of velocity passed to another crate / kept after it; bounce off solids. */
    crateTransfer: number;
    crateKeepAfterCrate: number;
    crateBounce: number;
    crateKeepAfterBounce: number;
    crateKeepAfterHit: number;
    crateWallMargin: number;
    crateWallBounce: number;
    /** Deceleration of a sliding crate, m/s². */
    crateFriction: number;
    /** A crate faster than this hurts enemies it touches. */
    crateHitSpeed: number;
    crateHit: OnHit;
    /** Wood damage per m/s when a crate rams a wall. */
    crateRamDamagePerSpeed: number;
  };
}

/** Runtime multipliers for feel tuning (training mode panel). 1 everywhere in real matches. */
export interface Tuning {
  moveSpeed: number;
  projectileSpeed: number;
  castTime: number;
  cooldown: number;
  accelTime: number;
  decelTime: number;
}

export type BotDifficulty = "easy" | "normal" | "hard";

export interface BotDifficultyConfig {
  /** Seconds before the bot notices a projectile or a ground marker. */
  reaction: number;
  /** Aim error, as a fraction of the distance (sideways). */
  aimError: number;
  /** Chance to dodge a noticed threat. */
  dodge: number;
  /** Seconds between re-rolling the aim error. */
  think: number;
  /** How much of the target's velocity the bot leads (0..1). */
  lead: number;
  /** Multiplier on how often abilities are used. */
  rate: number;
  /** Extra seconds added to the basic attack cooldown. */
  primaryDelay: number;
}

export interface TrainingConfig {
  /** Seconds before a champion killed on the range stands back up. */
  respawn: number;
  dummy: {
    /** Seconds without taking damage before the dummy heals to full. */
    regenDelay: number;
    /** Strafing dummy: seconds between direction changes. */
    strafeInterval: number;
    spawn: Vec2Data;
  };
}
