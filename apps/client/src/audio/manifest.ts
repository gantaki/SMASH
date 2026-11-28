// Sound manifest: id → file and mix settings. Ids are referenced from ability data (`sfx`) and from the event mapper.
// Files live in assets/sfx/ and are served at /sfx/<id>.mp3 (Vite publicDir = repo-level assets/).

export interface SoundDef {
  file: string;
  volume: number;
  /** random playback-rate spread, e.g. 0.08 = ±8% */
  variance?: number;
  /** minimum ms between two plays of this id */
  throttleMs?: number;
}

const s = (id: string, volume: number, variance?: number, throttleMs?: number): SoundDef => ({
  file: `/sfx/${id}.mp3`,
  volume,
  ...(variance !== undefined ? { variance } : {}),
  ...(throttleMs !== undefined ? { throttleMs } : {}),
});

export const SOUNDS: Record<string, SoundDef> = {
  // Wind-ups: quiet cues that start on the key press, so an attack is never silent until it lands.
  windup_fire: s("windup_fire", 0.3, 0.08),
  windup_swing: s("windup_swing", 0.32, 0.08),
  windup_bash: s("windup_bash", 0.4, 0.05),
  cast_cancel: s("cast_cancel", 0.45, 0.05),
  // Ember
  fire_bolt: s("fire_bolt", 0.4, 0.08, 50),
  fire_hit: s("fire_hit", 0.45, 0.1, 50),
  fire_charge: s("fire_charge", 0.55, 0.04),
  fireball: s("fireball", 0.7, 0.04),
  fire_explosion: s("fire_explosion", 0.8, 0.06, 60),
  blink: s("blink", 0.7, 0.04),
  aoe_mark: s("aoe_mark", 0.55, 0.04),
  nova: s("nova", 0.8, 0.04),
  meteor_fall: s("meteor_fall", 0.85),
  meteor_impact: s("meteor_impact", 1),
  ult_cast: s("ult_cast", 0.9),
  // Fang
  cleave: s("cleave", 0.4, 0.08, 60),
  blade_hit: s("blade_hit", 0.45, 0.1, 50),
  hook_windup: s("hook_windup", 0.5, 0.04),
  hook_throw: s("hook_throw", 0.65, 0.04),
  hook_hit: s("hook_hit", 0.75, 0.04),
  leap: s("leap", 0.6, 0.04),
  ground_slam: s("ground_slam", 0.85, 0.04),
  shield_bash: s("shield_bash", 0.75, 0.04),
  heavy_hit: s("heavy_hit", 0.7, 0.06, 60),
  counter_stance: s("counter_stance", 0.7),
  counter_trigger: s("counter_trigger", 0.9),
  whirlwind: s("whirlwind", 0.8),
  // Companions
  wisp_shot: s("wisp_shot", 0.3, 0.1, 80),
  hound_bite: s("hound_bite", 0.45, 0.08, 80),
  companion_command: s("companion_command", 0.5, 0.04),
  companion_death: s("companion_death", 0.65),
  // Combat / system
  hurt: s("hurt", 0.4, 0.1, 70),
  death: s("death", 1),
  slam: s("slam", 0.85, 0.05),
  stun: s("stun", 0.55, 0.05, 120),
  shield_block: s("shield_block", 0.55, 0.08, 60),
  wood_hit: s("wood_hit", 0.45, 0.1, 60),
  wood_break: s("wood_break", 0.8, 0.05),
  crate_bump: s("crate_bump", 0.45, 0.1, 120),
  // The arena coming apart
  stone_hit: s("stone_hit", 0.45, 0.1, 60),
  stone_break: s("stone_break", 0.85, 0.05, 80),
  floor_crack: s("floor_crack", 0.55, 0.08, 120),
  floor_crumble: s("floor_crumble", 0.7, 0.05, 150),
  floor_collapse: s("floor_collapse", 0.85, 0.06, 120),
  abyss_fall: s("abyss_fall", 0.8, 0.04),
  orb_spawn: s("orb_spawn", 0.7),
  orb_break: s("orb_break", 0.85),
  countdown_tick: s("countdown_tick", 0.6),
  round_start: s("round_start", 0.85),
  round_win: s("round_win", 0.9),
  round_lose: s("round_lose", 0.9),
  sudden_death: s("sudden_death", 1),
  rift_open: s("rift_open", 0.8, 0.06, 100),
  rift_warn: s("rift_warn", 0.5, 0.06, 150),
  rift_erupt: s("rift_erupt", 0.8, 0.06, 100),
  energy_full: s("energy_full", 0.7),
  ui_click: s("ui_click", 0.5, 0.04, 30),
};

export const SOUND_IDS: readonly string[] = Object.keys(SOUNDS);
