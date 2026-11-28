// Units: meters, seconds, meters/second. Angles in degrees. Colors are "#rrggbb".
// Everything here is plain data: adding a champion, ability or companion is a data change.
// New *mechanics* need a new `kind` here plus one behaviour in packages/sim/src/abilities.ts.

export type AbilitySlot = "primary" | "secondary" | "mobility" | "q" | "e" | "companion" | "ultimate";

export const ABILITY_SLOTS: readonly AbilitySlot[] = ["primary", "secondary", "mobility", "q", "e", "companion", "ultimate"];

/**
 * Kit template every champion follows (keeps champions comparable and readable for opponents):
 * primary = spammable basic attack · secondary = heavier skill-shot on a cooldown · mobility = escape / gap closer
 * q = defence · e = strike or control · companion = summons the companion for one command · ultimate = costs full energy.
 */
export const SLOT_ROLES: Record<AbilitySlot, string> = {
  primary: "basic attack",
  secondary: "skill-shot",
  mobility: "mobility",
  q: "defence",
  e: "strike",
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
  /**
   * Pushes the target away. Hitting an obstacle or the arena wall on the way is a slam (see rules.slam);
   * sliding over a hole in the floor or out through a broken wall is a fall into the abyss.
   */
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
  /** Energy paid when the ability fires: the whole bar for an ultimate, a quarter for a companion command (which also has a cooldown). */
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
  /** It strikes the ground: damage to every floor tile inside the blast (a tile has arena.floor.hp). */
  floorDamage: number;
  /** Only tiles within this radius take the floor damage (default: the whole blast). */
  floorRadius?: number;
  /** While the marker is on the ground, enemies inside it are dragged toward its centre at this speed (m/s). */
  drag?: number;
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
  /** The landing strikes the ground: `floorDamage` goes to every floor tile inside it (a tile has arena.floor.hp). */
  landing: { radius: number; onHit: OnHit; floorDamage: number; cratePush?: number };
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

/** Raises a wall across the line of aim. It blocks both sides, can be broken and slammed into, and crumbles when its time is up. */
export interface WallAbility extends AbilityCommon {
  kind: "wall";
  maxRange: number;
  halfWidth: number;
  halfDepth: number;
  hp: number;
  /** Seconds the wall stands. */
  duration: number;
  /** One more than this many makes the caster's oldest wall crumble. */
  maxActive: number;
}

/**
 * A charge along the ground toward the aim point. The first enemy touched takes onHit and is carried in front of the
 * caster to the end of the charge and `carry.beyond` meters further: into an obstacle it is a slam, over a hole a fall.
 */
export interface DashAbility extends AbilityCommon {
  kind: "dash";
  /** The charge goes to the aim point: at least `minRange` (however close the cursor is), at most `maxRange`. */
  minRange: number;
  maxRange: number;
  /** Seconds the full distance takes. */
  duration: number;
  onHit: OnHit;
  carry: { beyond: number; slamStun?: number; slamDamage?: number };
  cratePush?: number;
}

/** Stands still and takes no damage and no crowd control for `duration`; then everything around is hit with onHit. */
export interface BraceAbility extends AbilityCommon {
  kind: "brace";
  duration: number;
  radius: number;
  onHit: OnHit;
  cratePush?: number;
}

/**
 * A shock along the ground in a straight line from the caster. It strikes the ground: every floor tile it crosses
 * takes `floorDamage`. One of the caster's own walls on the line bursts: everything within `shatter.radius` of it
 * takes `shatter.onHit` (knockback is away from the wall).
 */
export interface LineAbility extends AbilityCommon {
  kind: "line";
  range: number;
  halfWidth: number;
  onHit: OnHit;
  floorDamage: number;
  shatter?: { radius: number; onHit: OnHit };
  cratePush?: number;
}

/** A ring of walls around the aim point. Inside it, slam damage is multiplied (for everyone, the caster included). */
export interface RingAbility extends AbilityCommon {
  kind: "ring";
  maxRange: number;
  radius: number;
  /** Number of wall pieces the ring is made of. */
  segments: number;
  halfDepth: number;
  hp: number;
  duration: number;
  slamMultiplier: number;
}

/**
 * Picks up the movable object nearest the cursor (a crate), then throws it at the aim point with a second press.
 * Does not fire when there is nothing to pick up. A crate that is not thrown is put down after `holdTime`.
 */
export interface LiftAbility extends AbilityCommon {
  kind: "lift";
  /** How far from the caster an object can be. */
  range: number;
  /** How far from the cursor the object can be. */
  pickRadius: number;
  holdTime: number;
  /** Speed the object leaves at; what it does to who it hits is rules.obstacles.crateHit. */
  throwSpeed: number;
}

/** Trades places with the unit or movable object nearest the cursor. Does not fire without a target in sight. */
export interface SwapAbility extends AbilityCommon {
  kind: "swap";
  maxRange: number;
  pickRadius: number;
}

/**
 * Floats above the ground for `duration`: knockbacks and pulls do nothing, holes and crates are passed over.
 * Nothing can be cast meanwhile, and where it ends is where the champion comes down.
 */
export interface HoverAbility extends AbilityCommon {
  kind: "hover";
  duration: number;
  moveMultiplier: number;
}

/** Summons the champion's companion and sends it to the aim point. What it does there is in CompanionDef.command. */
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
  | WallAbility
  | DashAbility
  | BraceAbility
  | LineAbility
  | RingAbility
  | LiftAbility
  | SwapAbility
  | HoverAbility
  | CompanionCommandAbility;

export type AbilityKind = Ability["kind"];

/** How a companion fights while it is out, if it does. */
export type CompanionAttack =
  | { kind: "none" }
  | { kind: "ranged"; projectile: ProjectileSpec }
  /** Bites the target it is engaged with. It gives up further than `leash` from its owner. */
  | { kind: "melee"; interval: number; damage: number; leash: number };

/** A companion is not on the field until it is commanded: it appears beside its owner, does this, and leaves. */
export type CompanionCommand =
  /** Flies to the point and holds it for `duration`, shooting at enemies in range. */
  | { kind: "sentry"; maxRange: number; duration: number; interval: number; range: number }
  /** Sprints to the point; the first enemy champion touched takes onHit, then the companion fights for engageTime. */
  | { kind: "pounce"; maxRange: number; onHit: OnHit; engageTime: number; searchRange: number; searchEngageTime: number }
  /**
   * Rolls in a straight line toward the point (at least `minRange`), bouncing off obstacles and the arena wall up to `bounces` times
   * (each bounce adds `bounceExtra` meters to the roll). Enemies it runs into take onHit, knocked the way it rolls.
   * Where it stops it lies as cover for `coverTime`.
   */
  | { kind: "roll"; minRange: number; maxRange: number; bounces: number; bounceExtra: number; onHit: OnHit; coverTime: number }
  /**
   * Flies to the point and becomes a gravity well for `duration`: enemies within `radius` drift toward it at
   * `unitPull` m/s, crates are flung toward it at `cratePull` m/s (and hit enemies on the way, like any flying crate).
   */
  | { kind: "well"; maxRange: number; duration: number; radius: number; unitPull: number; cratePull: number };

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
  /** Where it appears relative to the owner when summoned: angle from the owner's facing, and distance. */
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
  /** Top speed in m/s. Playtested: about 6 feels right; 5.5 for the slowest champions, 6.5 for the fastest. The arena is 36 m across. */
  moveSpeed: number;
  /** Collision and hit radius in meters. */
  radius: number;
  /** Knockback distances are divided by this. 1 = normal, above 1 = heavy. Reference: light 0.9, heavy 1.2. */
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
  /** The champion's name: a proper noun, shown in the interface as it is (heroes are named in English and not translated). */
  name: string;
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
  /** Pillar. Blocks movement, projectiles and line of sight. Takes a lot of punishment, then breaks for the rest of the round. */
  | { kind: "stone"; x: number; z: number; radius: number; hp: number }
  /** Breakable wall (oriented box). Once broken it is gone for the round. rotDeg 0 = long side along x. */
  | { kind: "wood"; x: number; z: number; halfWidth: number; halfDepth: number; rotDeg: number; hp: number }
  /** Movable. Pushed by knockbacks, pulled by hooks; hurts enemies when it flies into them. Breaks for good when its health runs out. */
  | { kind: "crate"; x: number; z: number; radius: number; hp: number };

/**
 * The floor is a round slab in the middle with rings of tiles around it, out to the arena radius. Every tile has
 * health; a broken tile drops into the abyss under the arena, and whatever stands on a hole falls with it.
 * Only what strikes the ground hurts tiles (`floorDamage` on ground blasts and leap landings); attacks that travel
 * above the ground (projectiles, melee arcs, novas, channels) only hurt walls, pillars and the rim.
 */
export interface FloorConfig {
  /** Radius of the round slab in the middle (one tile). */
  centerRadius: number;
  /** Rings of tiles around it. Ring i (1 = innermost) has tilesPerRing × i tiles, so tiles keep about the same size. */
  rings: number;
  /** Must be even: the layout is then point-symmetric, like everything else in the arena. */
  tilesPerRing: number;
  hp: number;
  /** Seconds a broken tile hangs before it drops: the telegraph. It is still solid ground meanwhile. */
  crumbleTime: number;
}

/** The wall around the arena, cut into equal sections that break one by one. A gap is a way out: into the abyss. */
export interface RimConfig {
  segments: number;
  hp: number;
}

export interface ArenaConfig {
  radius: number;
  /** Distance kept between a unit's centre and the arena wall. */
  wallMargin: number;
  floor: FloorConfig;
  rim: RimConfig;
  /** Where each team stands at the start of a round (index = team). */
  spawns: readonly [Vec2Data, Vec2Data];
  /** Distance between team-mates at the spawn, side by side (2v2). */
  spawnSpread: number;
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
    /** When a new pair opens beyond this many, the oldest pair closes: the floor never fills up with cracks. */
    maxActivePairs: number;
    /** Seconds a closing rift takes to seal (harmless while it does). */
    closeTime: number;
    /** Also capped by the current zone radius, so late rifts are not longer than the play area. */
    length: { min: number; max: number };
    segments: number;
    /** Max heading change between segments. */
    jitterDeg: number;
    /** A rift starts between this fraction of the zone radius and the zone edge. */
    startRadiusMin: number;
    /** A rift heads toward the centre turned aside by this much, so it cuts across the arena beside the middle. */
    headingOffsetDeg: { min: number; max: number };
    /** No rift comes closer than this to the arena centre: the middle (and the orb) always stays safe ground. */
    centerClear: number;
    /** Minimum gap between a new rift and the ones already open. */
    minSeparation: number;
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
  /** `commandCost` is what a companion command costs: one part of the bar (max / commandCost parts are drawn on it). */
  energy: { max: number; commandCost: number; perDamage: number; perCompanionDamage: number; passivePerSecond: number };
  /**
   * Knockback into an obstacle or the arena wall. Abilities can add to stun and damage.
   * `structureDamage` is what the wall, pillar or rim section takes from the body thrown into it.
   */
  slam: { stun: number; damage: number; structureDamage: number; crateImpulse: number };
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
    /** Seconds a companion that was killed cannot be summoned. */
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
