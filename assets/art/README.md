# Champion art

Champion portraits and ability icons, served at `/art/portraits/<championId>.webp` and `/art/abilities/<iconId>.webp`.
Ids are registered in `apps/client/src/ui/art.ts`; the menu and the HUD fall back to the line icons in `ui/icons.ts`
for anything not listed there.

| Kind | File | Format |
|---|---|---|
| Portrait | `portraits/<championId>.webp` | 1024×1536, transparent background, waist-up cutout cropped by the bottom edge only |
| Select tile | `tiles/<championId>.webp` | 512×512, opaque, head-and-shoulders close-up on the palette's background |
| Ability icon | `abilities/<iconId>.webp` | 192×192, opaque, shown at 52–72 px |
| Interface icon | `ui/<name>.webp` | 160×160, transparent, trimmed to the object (the three `mode-*` icons of the play bar) |

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
  champion's gear (Grakk's axe and shield).

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
   character is: a written design of the character (age, build, face and expression, each piece of what they wear and
   carry), with "an original champion with the bold, instantly readable archetype design of a MOBA or arena-brawler
   hero". The design comes first and the placeholder model in `apps/client/src/game/render/Units.ts` is made to match
   it, not the other way round (`docs/ART_STYLE.md` §4). Add "Do not copy its character, outfit or colours" about the
   style reference.
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

- Pyra: "Colours: ember orange, flame yellow and crimson, with black ink. Background: flat deep wine-maroon
  (#3a0d14)."
- Grakk: "Colours: cold light steel, deep navy blue and gold, with black ink. Background: flat dark slate-navy
  (#141d33). No fire, no orange, no red."
- Cairn: "Colours: moss green, weathered sandstone grey-beige and bronze, with black ink. Background: flat dark moss
  green (#16241a). No fire, no orange, no red, no blue, no purple, no gold-yellow."
- Lune: "Colours: lilac, moon-white and silver, with black ink. Background: flat dark indigo (#1a1730). No fire, no
  orange, no red, no gold, no yellow, no green, no brown."

A motion ability names its single trail in the subject and marks it "(asked for)": "ONE clean crescent swing arc
behind the blade (asked for)". Without that the model either drops the trail or adds three.

**Companion icon** (R) replaces the icon rules with: "Square icon of a hero's COMPANION creature … It is a character
portrait, livelier and more colourful than a normal ability icon. The creature's head and shoulders, centred, filling
about 85% of the frame, looking at the viewer, full of character, with a thick black ink outline. Full colour: four
or five saturated colours plus black ink and one highlight. Background: one flat, BRIGHT, saturated colour filling
the whole square: <colour>. Plain, nothing else in it." Pyra: bright violet-purple. Grakk: bright gold-yellow.
Cairn: bright spring green. Lune: bright periwinkle blue.

**Ultimate icon** (X): "Square icon of a hero's ULTIMATE ability … It must look much heavier, brighter and more
powerful than a normal ability icon. One big object, centred, filling about 85% of the frame, with a solid closed
silhouette and an extra-thick black ink outline. Full, rich colour: four or five saturated colours plus black ink and
a white-hot highlight. Background: BRIGHT and saturated, filling the whole square: a bold hand-inked sunburst of wide
alternating rays behind the object, in <colours>. The background is clearly lighter than the object's outline, never
dark. No small clutter … The sunburst rays are the only thing besides the object." Pyra: hot yellow and bright
orange rays. Grakk: bright gold and pale yellow rays. Cairn: bright lime green and pale yellow-green rays. Lune: bright
lilac and pale silver-white rays.

**Interface icon**: the plain icon rules with "Three or four flat colours plus black ink" and, instead of the
background line, "Transparent background: the object is a clean cutout with nothing behind it and an empty margin on
all four sides."

## Post-processing

- Portraits: alpha below 16/255 set to zero (the model leaves a faint haze around a cutout), saved as WebP quality 90 with alpha. No drop shadow is added in the client either: a soft dark halo around an inked cutout reads as a bad key.
- Select tiles: downscaled 1024 → 512 px (Lanczos), WebP quality 88.
- Icons: downscaled 1024 → 192 px (Lanczos), WebP quality 90.
- Interface icons: alpha cleaned as for portraits, cropped to the object, padded to a square, 160 px.
