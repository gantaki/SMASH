# Sound effects

47 short one-shots, served at `/sfx/<id>.mp3`. Mix settings (volume, pitch variance, throttle) are in
`apps/client/src/audio/manifest.ts`; playback is `apps/client/src/audio/AudioEngine.ts`.

## Where they come from

AI-generated with the **ElevenLabs sound effects** API (`/v1/sound-generation`), one generation per id, prompted as
"punchy stylized fantasy arena-brawler SFX, dry, no reverb tail, no music, no voice". They are placeholders of
usable quality: replace any of them freely.

Post-processing (ffmpeg): leading/trailing silence trimmed at −42 dB, gain set so the mean level is about −17 dB
(peak capped at −1 dB), 3 ms fade-in and up to 50 ms fade-out, encoded mono 44.1 kHz MP3 at 96 kbps.

## Ids

| Group | Id | Intent |
|---|---|---|
| Ember | `fire_bolt` | small fire dart launch |
| | `fire_hit` | small fire impact |
| | `fire_charge` | rising charge-up (Fireball cast) |
| | `fireball` | big fireball launch |
| | `fire_explosion` | medium fiery explosion |
| | `blink` | teleport pop |
| | `aoe_mark` | ground marker appears |
| | `nova` | flame shockwave (Flame Shield) |
| | `meteor_fall` | descending whoosh |
| | `meteor_impact` | huge impact |
| | `ult_cast` | ultimate activation swell |
| Fang | `cleave` | axe swing |
| | `blade_hit` | blade hit |
| | `hook_windup` | chain wind-up |
| | `hook_throw` | harpoon thrown |
| | `hook_hit` | hook latches |
| | `leap` | jump takeoff |
| | `ground_slam` | landing slam |
| | `shield_bash` | shield bash |
| | `heavy_hit` | heavy blunt impact |
| | `counter_stance` | guard raised |
| | `counter_trigger` | parry and riposte |
| | `whirlwind` | spinning blades (about 2 s) |
| Companions | `wisp_shot` | spark shot |
| | `hound_bite` | bite |
| | `companion_command` | command whistle |
| | `companion_death` | companion dissipates |
| Combat | `hurt` | player takes a hit |
| | `death` | champion defeated |
| | `slam` | knocked into a wall |
| | `stun` | stunned |
| | `shield_block` | shield absorbs a hit |
| | `wood_hit` | wood wall hit |
| | `wood_break` | wood wall breaks |
| | `crate_bump` | crate slides and bumps |
| Arena | `orb_spawn` | orb appears |
| | `orb_break` | orb broken, reward |
| | `sudden_death` | sudden death starts |
| | `rift_open` | floor cracks open |
| | `rift_warn` | geyser pressure building |
| | `rift_erupt` | geyser erupts |
| Flow / UI | `countdown_tick` | countdown tick |
| | `round_start` | fight! |
| | `round_win` | round won |
| | `round_lose` | round lost |
| | `energy_full` | ultimate ready |
| | `ui_click` | UI click |

## Adding or replacing a sound

1. Drop `<id>.mp3` here (mono, short, no silence at the start: latency matters more than fidelity).
2. Add or adjust the entry in `apps/client/src/audio/manifest.ts`.
3. Reference the id from ability data (`sfx: { cast, fire, hit }` in `packages/content`) or from the client's event mapping.

## Attack time

A sound must be audible within a few milliseconds of its trigger, or the game feels laggy. Files are cut at their onset (first 4 ms window above ~18–40% of the peak) with a 3 ms fade-in; check a new file's attack before adding it. Wind-up cues (`windup_*`) are capped at ~0.3 s so they end when the wind-up does, and `cast_cancel` plays when a wind-up is aborted with C.
