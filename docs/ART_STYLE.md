# Art Style Guide

The approved look for champions, portraits and ability icons. What a champion *is* (kit, slot roles, stats) is in
[`GAME_DESIGN.md`](GAME_DESIGN.md) §3; how the files are produced is in [`assets/art/README.md`](../assets/art/README.md).

## 1. Principles

1. **Hand-drawn, inked.** Everything looks drawn with a brush pen and coloured flat: not painted, not rendered, not vector.
2. **One palette per champion.** A champion's colours belong to that champion alone, everywhere they appear.
3. **Silhouette first.** A portrait is recognised by its outline; an icon is recognised by its outline at 52 px.
4. **Heroic exaggeration.** Nobody is drawn with realistic proportions.
5. **Less.** When in doubt, remove an element. Noise is the usual failure, emptiness almost never is.

## 2. Line and colour

| | Do | Don't |
|---|---|---|
| Line | Bold black ink outline with a lively, uneven weight; angular brush-pen strokes | Thin uniform outlines; no outline; clean vector curves |
| Shading | Hard-edged cel shading in flat shapes; hatching and dry-brush ink on the shadow side | Soft airbrush gradients, painterly blending, 3D-render lighting |
| Colour | Saturated flat fills from the champion's palette; one highlight colour | Rainbow accents; colours borrowed from another champion |
| Surface | A little paper grain | Photo textures, glossy plastic, glow bloom |

## 3. Palettes

A palette is **two or three colours plus one metal**, and a dark flat **icon background**. The champion's clothes and
gear, the 3D model, the ability icons, the select tile and the signature `color` in content (telegraphs, VFX, UI
accents) all come from it.

| Champion | Colours | Metal | Icon and tile background | Signature `color` |
|---|---|---|---|---|
| Ember | crimson, ember orange, flame yellow; violet lining | dark copper | deep wine-maroon `#3a0d14` | `#ff7a2b` |
| Fang | cold steel, deep navy blue | polished gold | dark slate-navy `#141d33` | `#ffc93c` |

Rules for a new palette:

- No two champions share a dominant hue, a metal or an icon background. If the new palette sits next to an existing
  one on the colour wheel, pick another.
- Reserved, not available as a champion's glow colour: ally cyan `#39d0ff`, enemy red `#ff4d3d`.
- The palette is decided before any art is made and is written into the table above.

## 4. Characters

- **Anyone can be a champion**: humans, beasts, constructs, spirits. A non-human champion exaggerates whatever makes
  it that creature.
- **Proportions are pushed.** Women are drawn as glamorous heroines: adult, with a pronounced feminine figure and a
  deep neckline. Men get the same treatment in their own key: broad, heavy, scarred.
- **Expression carries the character**: a smirk, a grin, a glare. No neutral faces.
- The gear in the art is the gear of the 3D model (`apps/client/src/game/render/Units.ts`), in the palette's colours.

## 5. Portraits

Two per champion, the same character in the same outfit:

| | Cutout (`portraits/`) | Select tile (`tiles/`) |
|---|---|---|
| Used | Main menu, beside the champion's name | Champion picker |
| Framing | Waist-up, three-quarter view turned slightly left, looking at the viewer; weapon and hands in frame | Head and shoulders, same angle; the face is about half the height; headgear may be cropped by the top edge; no weapons or hands |
| Background | Transparent; cropped by the bottom edge only, empty margin on the other three | The palette's flat background colour with one big darker angular shape behind the head |
| Size | 1024×1536 | 512×512 |

## 6. Ability icons

An icon is an **emblem of one object**, not a small illustration of the ability going off. There are three tiers, and
the tier must be readable before the picture is.

| Tier | Slots | Background | Colour | Shape in the UI |
|---|---|---|---|---|
| **Plain** | LMB, RMB, Space, Q, E | The palette's dark flat background, empty | Three colours plus ink | Square |
| **Companion** | R | One flat **bright** colour, empty (Ember: violet; Fang: gold-yellow) | Full colour, four or five | **Round** |
| **Ultimate** | X | **Bright sunburst** of wide inked rays in the palette's hot colours | Full colour plus a white-hot highlight | **Bigger square in a gold frame** |

Rules for every tier:

- **Exactly one object**, centred, about 80% of the frame (85% for the two heavy tiers), with a solid closed
  silhouette and a thick ink outline.
- Inside the silhouette: three or four large flat shapes, one highlight, a few hatch strokes. No small details.
- **Nothing around the object.** No glow, no halo, no speed lines, no sparks, no dust, no debris. The ultimate's
  sunburst is its background, not an effect, and it is the only one.
- **One trail is allowed when motion is the meaning** of the ability (a swing arc, a leap arc, a spin). One, and it
  is part of the silhouette.
- The **companion** icon is a portrait: the creature's head and shoulders, looking at the viewer, with an expression.
- The **ultimate** must be the loudest thing in the row. If it does not win a squint test against the other six,
  redraw it.
- The five plain icons of one kit share a palette and a background, so they differ in **silhouette**: a dart, a ball,
  chevrons, a ring, a shield. Two icons of one kit never share an outline.
- An icon that shows the champion's gear shows the same gear as the portrait.
- Judge every icon at 52 px next to the rest of its kit, not at full size.

## 7. Interface

Controls are drawn the same way as the art: flat, outlined, a little heavy.

- **Outline**: a solid ink border (`--outline`, 2.5 px) on every button, tile and plate.
- **Depth is an offset, not a blur**: a solid ink shadow straight below the element (3–7 px). No soft drop shadows,
  no glow, no glass blur. A pressed button moves down into its shadow; a selected one rises out of it.
- **Fill**: flat. The main button has one hard-edged highlight band across its upper half; nothing has a gradient.
- **Colours**: dark umber plate (`--plate`) for idle controls, bone (`--ink`) for the selected mode, gold for a
  selected option, fire orange for the one main action on a screen. Champion colours appear only on things that
  belong to a champion (their tile ring, their kit).
- **Icons** on controls are drawn emblems on a transparent background, one object each, following §6 (plain tier).
  An idle control shows its icon desaturated; hover and selection bring the colour back.
- **Motion**: nothing cuts. A champion swap moves the old portrait out before the new one comes in and cross-fades the arena (never through black);
  durations stay under half a second, and `prefers-reduced-motion` turns them off.

## 8. Checklist for a new champion

1. Palette chosen, checked against the table in §3, added to it.
2. Cutout portrait, then the select tile from it.
3. Seven icons: five plain ones on the palette's background, the companion's portrait, the ultimate on its sunburst. Laid out in a row at 52 px, every silhouette is different and the ultimate is the loudest.
4. Model colours in `Units.ts` and the signature `color` in content match the palette.
5. Files registered in `apps/client/src/ui/art.ts`; looked at in the menu and in the HUD.
