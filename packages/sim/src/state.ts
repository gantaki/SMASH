// Match state: plain serializable data (no classes, functions or object references between entities).
// Entities refer to each other by id, so the whole state can be cloned for rollback (M2) or sent as a snapshot.

import {
  ABILITY_SLOTS,
  arena,
  defaultTuning,
  getChampion,
  rules,
  training,
  type AbilitySlot,
  type BotDifficulty,
  type CompanionInteraction,
  type OnHit,
  type ProjectileVisual,
  type Tuning,
} from "@smash/content";
import type { Vec2 } from "./math.ts";

export type Phase = "countdown" | "fight" | "roundEnd" | "matchEnd";
export type MatchMode = "duel" | "training";
export type Controller = "human" | "bot" | "dummy";
export type Team = 0 | 1;

export interface PlayerSetup {
  champion: string;
  controller: Controller;
  difficulty?: BotDifficulty;
}

export interface MatchConfig {
  seed: number;
  mode: MatchMode;
  /** Index = team. */
  players: readonly [PlayerSetup, PlayerSetup];
  tuning?: Partial<Tuning>;
}

/** One tick of input for a human-controlled champion. Bots produce the same structure. */
export interface PlayerInput {
  /** Desired direction, length 0..1. */
  move: Vec2;
  /** Ground point under the cursor. */
  aim: Vec2;
  /** Slots pressed this tick (key-down edges). */
  press: readonly AbilitySlot[];
  /** Basic attack button held: repeats the attack. */
  holdPrimary: boolean;
  /** Cancel key pressed this tick: aborts the current wind-up or channel. */
  cancel: boolean;
}

export const emptyInput = (): PlayerInput => ({ move: { x: 0, z: 0 }, aim: { x: 0, z: 0 }, press: [], holdPrimary: false, cancel: false });

/** Knockback or pull in progress. */
export interface Forced {
  vx: number;
  vz: number;
  time: number;
  kind: "knock" | "pull";
  /** Champion credited if the knockback ends in a slam, or -1. */
  source: number;
  slamStun: number;
  slamDamage: number;
}

interface UnitBase {
  id: number;
  team: Team;
  x: number;
  z: number;
  /** Measured velocity over the last tick (includes forced movement). */
  vx: number;
  vz: number;
  /** Facing angle in radians: 0 = +z, PI/2 = +x. */
  face: number;
  hp: number;
  maxHp: number;
  radius: number;
  dead: boolean;
  stun: number;
  /** Seconds of slow left, its strength, and (for a fading snare) its full length: strength scales with slow / slowTotal. */
  slow: number;
  slowAmount: number;
  slowTotal: number;
  slowFading: boolean;
  root: number;
  forced: Forced | null;
}

export interface CastState {
  slot: AbilitySlot;
  /** Seconds left. */
  time: number;
  total: number;
}

export interface ChampionUnit extends UnitBase {
  kind: "champion";
  champion: string;
  controller: Controller;
  /** Id of this champion's companion unit, or -1. */
  companion: number;
  energy: number;
  cooldowns: Record<AbilitySlot, number>;
  /** Latest input. */
  move: Vec2;
  aim: Vec2;
  /** Movement velocity (what acceleration works on); excludes forced movement. */
  mvx: number;
  mvz: number;
  buffer: { slot: AbilitySlot; time: number } | null;
  cast: CastState | null;
  /** Seconds before another ability can start. */
  recovery: number;
  /** Seconds before the champion can cancel a wind-up again. */
  cancelLock: number;
  channel: { slot: AbilitySlot; time: number; tick: number } | null;
  leap: { slot: AbilitySlot; x0: number; z0: number; x1: number; z1: number; t: number; duration: number } | null;
  burn: number;
  burnDps: number;
  burnTick: number;
  burnSource: number;
  shield: number;
  shieldTime: number;
  counter: number;
  counterSlot: AbilitySlot | null;
  empowered: number;
  zoneTick: number;
  riftTick: number;
  /** Round time of the last damage taken (training dummy regeneration). */
  lastHurtAt: number;
  /** Seconds since death (training respawn, death animation). */
  deadTime: number;
}

export type CompanionMode = "follow" | "go" | "sentry" | "engage";

export interface CompanionUnit extends UnitBase {
  kind: "companion";
  def: string;
  owner: number;
  respawn: number;
  mode: CompanionMode;
  modeTime: number;
  tx: number;
  tz: number;
  attackTimer: number;
  /** Unit id of the engage target, or -1. */
  target: number;
  slideTime: number;
  slideDir: number;
  riftTick: number;
}

export type Unit = ChampionUnit | CompanionUnit;

export interface Projectile {
  id: number;
  /** Unit that fired it (champion or companion). */
  owner: number;
  /** Champion credited with damage and energy. */
  credit: number;
  team: Team;
  x: number;
  z: number;
  vx: number;
  vz: number;
  speed: number;
  range: number;
  dist: number;
  age: number;
  radius: number;
  onHit: OnHit;
  visual: ProjectileVisual;
  cratePush: number;
  hook: boolean;
  throughCompanion: CompanionInteraction | null;
  abilityId: string | null;
}

export interface GroundEffect {
  id: number;
  owner: number;
  team: Team;
  x: number;
  z: number;
  radius: number;
  delay: number;
  t: number;
  onHit: OnHit;
  cratePush: number;
  falling: boolean;
  abilityId: string;
}

export interface Obstacle {
  id: number;
  kind: "stone" | "wood" | "crate";
  shape: "circle" | "box";
  x: number;
  z: number;
  radius: number;
  halfWidth: number;
  halfDepth: number;
  /** Radians. */
  rot: number;
  alive: boolean;
  hp: number;
  maxHp: number;
  respawn: number;
  homeX: number;
  homeZ: number;
  vx: number;
  vz: number;
  /** Champion that set the crate in motion (-1 = nobody) and its team. */
  pusher: number;
  pusherTeam: Team | -1;
  spin: number;
}

export interface Orb {
  alive: boolean;
  x: number;
  z: number;
  radius: number;
  hp: number;
  maxHp: number;
  nextAt: number;
  lastHitter: number;
}

export type RiftPhase = "dormant" | "warn" | "erupt" | "closing";

export interface Rift {
  id: number;
  /** Both rifts of a mirrored pair share this number. */
  pair: number;
  /** Marked to seal: it finishes its current eruption, then closes instead of going dormant. */
  closing: boolean;
  /** Polyline of the crack. */
  points: Vec2[];
  phase: RiftPhase;
  /** Seconds left in the phase, and the phase's full length (for telegraph progress). */
  time: number;
  total: number;
  age: number;
}

export interface BotState {
  think: number;
  strafe: 1 | -1;
  strafeTime: number;
  dodgeX: number;
  dodgeZ: number;
  dodgeTime: number;
  aimError: number;
  /** Projectile ids already evaluated for dodging. */
  seen: number[];
  castSeen: boolean;
}

export interface MatchState {
  config: MatchConfig;
  tuning: Tuning;
  tick: number;
  phase: Phase;
  /** Seconds left in countdown / roundEnd. */
  phaseTime: number;
  lastCount: number;
  round: number;
  score: [number, number];
  /** Seconds of fighting in this round. */
  roundTime: number;
  winner: Team | -1;
  units: Unit[];
  projectiles: Projectile[];
  grounds: GroundEffect[];
  obstacles: Obstacle[];
  orb: Orb;
  suddenDeath: { active: boolean; startedAt: number; zoneRadius: number; pairsSpawned: number; nextRiftAt: number };
  rifts: Rift[];
  bots: [BotState, BotState];
  training: { dummyMoves: boolean; dummyDir: 1 | -1; dummyTime: number };
  nextId: number;
  rng: number;
}

const DEG = Math.PI / 180;

export const newBotState = (): BotState => ({
  think: 0,
  strafe: 1,
  strafeTime: 1,
  dodgeX: 0,
  dodgeZ: 0,
  dodgeTime: 0,
  aimError: 0,
  seen: [],
  castSeen: false,
});

const zeroCooldowns = (): Record<AbilitySlot, number> =>
  Object.fromEntries(ABILITY_SLOTS.map((s) => [s, 0])) as Record<AbilitySlot, number>;

/** Where a companion idles: beside and slightly behind its owner. */
export function followPoint(owner: ChampionUnit): Vec2 {
  const def = getChampion(owner.champion).companion;
  const a = owner.face + (def ? def.follow.angleDeg * DEG : 0);
  const d = def ? def.follow.distance : 0;
  return { x: owner.x + Math.sin(a) * d, z: owner.z + Math.cos(a) * d };
}

export function resetChampion(u: ChampionUnit, x: number, z: number, face: number): void {
  const stats = getChampion(u.champion).stats;
  Object.assign(u, {
    x,
    z,
    vx: 0,
    vz: 0,
    mvx: 0,
    mvz: 0,
    face,
    hp: stats.hp,
    maxHp: stats.hp,
    radius: stats.radius,
    dead: false,
    stun: 0,
    slow: 0,
    slowAmount: 0,
    slowTotal: 0,
    slowFading: false,
    root: 0,
    forced: null,
    energy: 0,
    cooldowns: zeroCooldowns(),
    move: { x: 0, z: 0 },
    aim: { x: x + Math.sin(face), z: z + Math.cos(face) },
    buffer: null,
    cast: null,
    recovery: 0,
    cancelLock: 0,
    channel: null,
    leap: null,
    burn: 0,
    burnDps: 0,
    burnTick: 0,
    burnSource: -1,
    shield: 0,
    shieldTime: 0,
    counter: 0,
    counterSlot: null,
    empowered: 0,
    zoneTick: 0,
    riftTick: 0,
    lastHurtAt: -1e9,
    deadTime: 0,
  } satisfies Partial<ChampionUnit>);
}

export function resetCompanion(c: CompanionUnit, owner: ChampionUnit): void {
  const def = getChampion(owner.champion).companion!;
  const p = followPoint(owner);
  Object.assign(c, {
    x: p.x,
    z: p.z,
    vx: 0,
    vz: 0,
    face: owner.face,
    hp: def.hp,
    maxHp: def.hp,
    radius: def.radius,
    dead: false,
    stun: 0,
    slow: 0,
    slowAmount: 0,
    slowTotal: 0,
    slowFading: false,
    root: 0,
    forced: null,
    respawn: 0,
    mode: "follow",
    modeTime: 0,
    tx: p.x,
    tz: p.z,
    attackTimer: 0,
    target: -1,
    slideTime: 0,
    slideDir: 1,
    riftTick: 0,
  } satisfies Partial<CompanionUnit>);
}

function buildObstacles(nextId: () => number): Obstacle[] {
  return arena.obstacles.map((o) => {
    const base: Obstacle = {
      id: nextId(),
      kind: o.kind,
      shape: o.kind === "wood" ? "box" : "circle",
      x: o.x,
      z: o.z,
      radius: 0,
      halfWidth: 0,
      halfDepth: 0,
      rot: 0,
      alive: true,
      hp: 0,
      maxHp: 0,
      respawn: 0,
      homeX: o.x,
      homeZ: o.z,
      vx: 0,
      vz: 0,
      pusher: -1,
      pusherTeam: -1,
      spin: 0,
    };
    if (o.kind === "wood") {
      base.halfWidth = o.halfWidth;
      base.halfDepth = o.halfDepth;
      base.rot = o.rotDeg * DEG;
      base.hp = base.maxHp = o.hp;
      base.radius = Math.hypot(o.halfWidth, o.halfDepth);
    } else {
      base.radius = o.radius;
    }
    return base;
  });
}

export function createMatch(config: MatchConfig): MatchState {
  let id = 0;
  const nextId = () => ++id;
  const units: Unit[] = [];
  const champs: ChampionUnit[] = [];
  for (const team of [0, 1] as const) {
    const setup = config.players[team];
    getChampion(setup.champion); // throws on an unknown id
    const u = { id: nextId(), kind: "champion", team, champion: setup.champion, controller: setup.controller, companion: -1 } as ChampionUnit;
    resetChampion(u, 0, 0, 0);
    champs.push(u);
    units.push(u);
  }
  for (const owner of champs) {
    const def = getChampion(owner.champion).companion;
    if (!def) continue;
    const c = { id: nextId(), kind: "companion", team: owner.team, def: def.id, owner: owner.id } as CompanionUnit;
    resetCompanion(c, owner);
    owner.companion = c.id;
    units.push(c);
  }
  const obstacles = buildObstacles(nextId);
  const state: MatchState = {
    config,
    tuning: { ...defaultTuning, ...config.tuning },
    tick: 0,
    phase: "countdown",
    phaseTime: 0,
    lastCount: 0,
    round: 1,
    score: [0, 0],
    roundTime: 0,
    winner: -1,
    units,
    projectiles: [],
    grounds: [],
    obstacles,
    orb: { alive: false, x: 0, z: 0, radius: arena.orb.radius, hp: 0, maxHp: arena.orb.hp, nextAt: arena.orb.spawnAt, lastHitter: -1 },
    suddenDeath: { active: false, startedAt: 0, zoneRadius: arena.radius, pairsSpawned: 0, nextRiftAt: 0 },
    rifts: [],
    bots: [newBotState(), newBotState()],
    training: { dummyMoves: false, dummyDir: 1, dummyTime: training.dummy.strafeInterval },
    nextId: id + 1,
    rng: config.seed >>> 0,
  };
  startRound(state);
  return state;
}

/** Resets everything that does not carry over between rounds. */
export function startRound(state: MatchState): void {
  const isTraining = state.config.mode === "training";
  state.projectiles = [];
  state.grounds = [];
  state.rifts = [];
  for (const u of state.units) {
    if (u.kind !== "champion") continue;
    const spawn = isTraining && u.controller === "dummy" ? training.dummy.spawn : arena.spawns[u.team];
    // Team 0 spawns at +z and looks toward -z.
    resetChampion(u, spawn.x, spawn.z, u.team === 0 ? Math.PI : 0);
  }
  for (const u of state.units) {
    if (u.kind !== "companion") continue;
    const owner = state.units.find((o) => o.id === u.owner) as ChampionUnit;
    resetCompanion(u, owner);
  }
  for (const o of state.obstacles) {
    o.alive = true;
    o.hp = o.maxHp;
    o.respawn = 0;
    o.x = o.homeX;
    o.z = o.homeZ;
    o.vx = o.vz = 0;
    o.pusher = -1;
    o.pusherTeam = -1;
    o.spin = (o.homeX * 7 + o.homeZ * 3) % (Math.PI * 2);
  }
  state.orb.alive = false;
  state.orb.hp = 0;
  state.orb.nextAt = arena.orb.spawnAt;
  state.orb.lastHitter = -1;
  state.suddenDeath = { active: false, startedAt: 0, zoneRadius: arena.radius, pairsSpawned: 0, nextRiftAt: 0 };
  state.bots = [newBotState(), newBotState()];
  state.roundTime = 0;
  state.lastCount = 0;
  if (isTraining) {
    state.phase = "fight";
    state.phaseTime = 0;
  } else {
    state.phase = "countdown";
    state.phaseTime = rules.countdown;
  }
}

// ---------- lookups ----------

export const unitById = (state: MatchState, id: number): Unit | undefined => state.units.find((u) => u.id === id);

export const championById = (state: MatchState, id: number): ChampionUnit | undefined => {
  const u = unitById(state, id);
  return u && u.kind === "champion" ? u : undefined;
};

export const champions = (state: MatchState): ChampionUnit[] => state.units.filter((u): u is ChampionUnit => u.kind === "champion");

export const championOfTeam = (state: MatchState, team: Team): ChampionUnit =>
  state.units.find((u): u is ChampionUnit => u.kind === "champion" && u.team === team)!;

export const companionOf = (state: MatchState, owner: ChampionUnit): CompanionUnit | undefined => {
  const u = owner.companion >= 0 ? unitById(state, owner.companion) : undefined;
  return u && u.kind === "companion" ? u : undefined;
};

/** Living enemy champions and companions of `team`. */
export const enemiesOf = (state: MatchState, team: Team): Unit[] => state.units.filter((u) => u.team !== team && !u.dead);

/** The champion that gets credit for what a unit does (a companion's owner, or the champion itself). */
export const creditOf = (state: MatchState, u: Unit | undefined): ChampionUnit | undefined =>
  !u ? undefined : u.kind === "champion" ? u : championById(state, u.owner);
