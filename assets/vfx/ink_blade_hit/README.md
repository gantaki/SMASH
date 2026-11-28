# Ink Blade Hit

Hit effect for Grakk's Cleave. Authored in BoneGyre, exported as Spine 4.2.

| File | Notes |
|---|---|
| `ink_blade_hit.json` | Skeleton + animation `ink_blade_hit` (~1.13 s, event `hit` at 0.1 s) |
| `ink_blade_hit.skel` | Same data, binary |
| `ink_blade_hit.png` | Atlas page, 774×1598, straight (non-premultiplied) alpha |
| `ink_blade_hit.atlas` | **Reconstructed**, see below |

## About the atlas

The original `.atlas` was not exported with the PNG. `ink_blade_hit.atlas` was rebuilt from the PNG's alpha channel: all 32 regions match the attachment sizes in the JSON exactly and no opaque pixel falls outside them. The order of the 16 `HK_InkPuff_*` frames was inferred from the packer's sort order (height, width, name) and is consistent with a smooth loop.

Replace it with the real export from BoneGyre when possible.

## In game

- Plays at the hit point, 0.35 m in front of the target, 1.25 m high, camera-facing, mirrored to the strike direction.
- Scale: 175 Spine px = 1 m; ×1.3 for the empowered Cleave.
- Starts at t = 0.05 s so the slash shows on the first frame.
- Readability note: the dark ink puffs are small from the gameplay camera and get lost on dark targets.
