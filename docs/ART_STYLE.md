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

An icon is an **emblem of one object**, not a small illustration of the ability going off.

- **Exactly one object**, centred, about 80% of the frame, with a solid closed silhouette and a thick ink outline.
- **Three colours plus black ink at most**, all from the champion's palette.
- Inside the silhouette: three or four large flat shapes, one highlight, a few hatch strokes. No small details.
- **Nothing around the object.** No burst or starburst behind it, no glow, no halo, no speed lines, no sparks, no
  dust, no debris.
- **One trail is allowed when motion is the meaning** of the ability (a swing arc, a leap arc, a spin). One, and it
  is part of the silhouette.
- **Background: the palette's flat background colour, plain and empty.** The background is what tells two
  champions' kits apart at a glance.
- The seven icons of one kit share a palette, so they differ in **silhouette**: a dart, a ball, chevrons, a ring, a
  shield, a creature, a rock. Two icons of one kit never share an outline.
- An icon that shows the champion's gear shows the same gear as the portrait.
- Judge every icon at 52 px next to the rest of its kit, not at full size.

## 7. Checklist for a new champion

1. Palette chosen, checked against the table in §3, added to it.
2. Cutout portrait, then the select tile from it.
3. Seven icons on the palette's background; laid out in a row at 52 px, every silhouette is different.
4. Model colours in `Units.ts` and the signature `color` in content match the palette.
5. Files registered in `apps/client/src/ui/art.ts`; looked at in the menu and in the HUD.
