# Champion art

Champion portraits and ability icons, served at `/art/portraits/<championId>.webp` and `/art/abilities/<iconId>.webp`.
Ids are registered in `apps/client/src/ui/art.ts`; the menu and the HUD fall back to the line icons in `ui/icons.ts`
for anything not listed there.

| Kind | File | Format |
|---|---|---|
| Portrait | `portraits/<championId>.webp` | 1024×1536, transparent background, waist-up cutout cropped by the bottom edge only |
| Select tile | `tiles/<championId>.webp` | 512×512, opaque, head-and-shoulders close-up on the palette's background |
| Ability icon | `abilities/<iconId>.webp` | 192×192, opaque, shown at 52–58 px |

`<iconId>` is the ability's `icon` field in `packages/content`, so two abilities that share an icon id share the art.

**What the art should look like** (line, palettes, proportions, portrait and icon rules) is decided in
`docs/ART_STYLE.md`. This file is only the recipe for producing it.

## Where it comes from

AI-generated with the **OpenAI Images** API (`gpt-image-2.6-sunburst`, quality `high`). They are placeholders of
usable quality until M3 brings final-style characters: replace any of them freely, but keep the set in one style.

One style is kept with reference images, not with prompt wording alone. Every image goes through `/v1/images/edits`
with references attached:

- a new **portrait** gets an existing portrait as the style guide;
- a **select tile** gets its own champion's portrait ("draw the same character again … as a close-up");
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

**Select tile** = "The reference image shows the character. Draw the same character again, in exactly the same
hand-inked style, same face, hair, headgear, outfit and colours, as a close-up for a character-select tile.", the
style line, then "Square close-up bust portrait: head and shoulders only, three-quarter view turned slightly to the
left, looking at the viewer. The face is large, about half the height of the image; the headgear may be cropped by
the top edge. No weapons or hands in frame. Background: opaque, flat <palette background>, with one big simple darker
angular shape behind the head."

**Icon** = "Use the reference image only as a guide to the drawing style … Do not include its subject, its glow
shapes or its background. Square ability icon, hand-drawn in ink, as simple and bold as an emblem or a sticker.",
then the rules as a list, word for word:

> - Exactly ONE object, centred and large, filling about 80% of the frame, with a solid, closed silhouette and a thick
>   black brush-pen outline of lively, uneven weight. The silhouette alone must tell what it is.
> - Inside the silhouette: three or four large flat colour shapes with hard-edged cel shading, one highlight, and a
>   few confident ink hatch strokes on the shadow side, so it reads as a hand-inked drawing and not as a vector logo.
>   No small details, no texture noise.
> - At most three colours plus black ink.
> - NOTHING around the object: no burst or starburst shape behind it, no glow, no halo, no speed lines, no sparks, no
>   particles, no dust, no debris, no extra arcs or swooshes unless the subject line asks for one.
> - Background: one single flat solid colour, completely plain and empty, edge to edge.

then `Subject: <one object, its direction, and "Nothing else.">` and the colour line:

- Ember: "Colours: ember orange, flame yellow and crimson, with black ink. Background: flat deep wine-maroon
  (#3a0d14)."
- Fang: "Colours: cold light steel, deep navy blue and gold, with black ink. Background: flat dark slate-navy
  (#141d33). No fire, no orange, no red."

A motion ability names its single trail in the subject and marks it "(asked for)": "ONE clean crescent swing arc
behind the blade (asked for)". Without that the model either drops the trail or adds three.

## Post-processing

- Portraits: saved as WebP quality 90 with alpha, nothing else.
- Select tiles: downscaled 1024 → 512 px (Lanczos), WebP quality 88.
- Icons: downscaled 1024 → 192 px (Lanczos), WebP quality 90.
