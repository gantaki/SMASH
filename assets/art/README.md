# Champion art

Champion portraits and ability icons, served at `/art/portraits/<championId>.webp` and `/art/abilities/<iconId>.webp`.
Ids are registered in `apps/client/src/ui/art.ts`; the menu and the HUD fall back to the line icons in `ui/icons.ts`
for anything not listed there.

| Kind | File | Format |
|---|---|---|
| Portrait | `portraits/<championId>.webp` | 1024×1536, transparent background, waist-up cutout cropped by the bottom edge only |
| Ability icon | `abilities/<iconId>.webp` | 192×192, opaque, shown at 52–58 px |

`<iconId>` is the ability's `icon` field in `packages/content`, so two abilities that share an icon id share the art.

**What a champion should look like** (palette per champion, hand-drawn style, proportions, non-human champions) is
decided in `docs/GAME_DESIGN.md` §3 "Character design guide". This file is only the recipe for producing it.

## Where it comes from

AI-generated with the **OpenAI Images** API (`gpt-image-2.6-sunburst`, quality `high`). They are placeholders of
usable quality until M3 brings final-style characters: replace any of them freely, but keep the set in one style.

One style is kept with reference images, not with prompt wording alone. Every image goes through `/v1/images/edits`
with references attached:

- a new **portrait** gets an existing portrait as the style guide;
- a new **icon** gets an existing icon as the style guide, plus its own champion's portrait when the icon shows that
  champion's gear (Fang's axe and shield).

A reference of another champion carries that champion's palette with it, so the prompt always states the new
champion's palette as strict and names what is forbidden ("no fire, no orange, no red").

## Prompts

Style line, used in every prompt:

> Hand-drawn character illustration for a fantasy gladiator-arena hero brawler: bold black ink outlines with lively,
> variable line weight, angular brush-pen strokes, cross-hatching and dry-brush ink in the shadows, flat saturated
> colour fills with hard-edged cel shading and very few soft gradients, slight paper grain, the visible energy of a
> hand-inked comic or concept-art drawing. Slightly exaggerated heroic proportions, crisp readable silhouette. No
> text, no letters, no signature, no logo, no frame, no border, no watermark.

**Portrait** = "The first reference is the style guide: match its hand-inked line work, hatching, flat cel colouring
and framing exactly", the style line, then:

1. "Character portrait, waist-up, three-quarter view turned slightly to the left, looking at the viewer", and who the
   character is (take the gear from the model in `apps/client/src/game/render/Units.ts`).
2. "Their personal palette, used for everything they wear: …" with the palette from the design guide, and the
   colours that must not appear.
3. "Transparent background, the character is a clean cutout with nothing behind it. The figure is cropped by the
   bottom edge of the image only: leave an empty transparent margin at the left, right and top edges."

**Icon** = "Use the first reference image only as a style guide … Do not include its character. Square ability icon,
hand-drawn: [the ink and cel-shading part of the style line]. One bold central motif filling about 70% of the frame,
instantly readable at 48 pixels, no small clutter. The background is opaque, flat and dark, fills the whole square
edge to edge, with only a simple hard-edged glow shape behind the motif.", then `Subject: <one motif and its
direction>` and the palette line:

- Ember: "crimson, ember orange and flame yellow with black ink, on a flat deep wine-maroon background. No blue, no
  steel, no gold metal."
- Fang: "cold bright steel, deep navy blue and polished gold with black ink, on a flat dark slate-navy background.
  Motion trails and impact flashes are pale steel-white with gold edges. No fire, no flames, no orange, no red."

## Post-processing

- Portraits: saved as WebP quality 90 with alpha, nothing else.
- Icons: downscaled 1024 → 192 px (Lanczos), WebP quality 88.
