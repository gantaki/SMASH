# Painted art

Champion portraits and ability icons, served at `/art/portraits/<championId>.webp` and `/art/abilities/<iconId>.webp`.
Ids are registered in `apps/client/src/ui/art.ts`; the menu and the HUD fall back to the line icons in `ui/icons.ts`
for anything not listed there.

| Kind | File | Format |
|---|---|---|
| Portrait | `portraits/<championId>.webp` | 1024×1536, transparent background, waist-up cutout cropped by the bottom edge |
| Ability icon | `abilities/<iconId>.webp` | 192×192, opaque, shown at 52–58 px |

`<iconId>` is the ability's `icon` field in `packages/content`, so two abilities that share an icon id share the art.

## Where it comes from

AI-generated with the **OpenAI Images** API (`gpt-image-2.6-sunburst`, quality `high`). They are placeholders of
usable quality until M3 brings final-style characters: replace any of them freely, but keep the set in one style.

Keeping one style is done with reference images, not with prompt wording alone:

1. The first portrait (`ember`) was generated from text (`/v1/images/generations`, `background: transparent`).
2. Every other image goes through `/v1/images/edits` with references attached: a new portrait gets an existing
   portrait; a new icon gets an existing icon as the style guide, plus its champion's portrait when the icon shows
   that champion's gear (Fang's axe and shield).

## Prompts

Shared style line:

> Stylized hand-painted game art for a fantasy gladiator-arena hero brawler: bold chunky shapes, confident painterly
> brush strokes with visible facets, slightly exaggerated heroic proportions, crisp readable silhouette, strong warm
> rim light, deep umber shadows. No text, no letters, no logo, no frame, no border, no watermark.

Portrait: the style line, then "Character portrait, waist-up, three-quarter view turned slightly to the left, looking
at the viewer", the character's look (take it from the model in `apps/client/src/game/render/Units.ts`), then
"Transparent background, the character is a clean cutout with nothing behind it; the figure is cropped by the bottom
edge of the image." With a reference, start with "Use the reference image only as a style guide … Paint a different
character in that same style."

Icon: "Use the reference image only as a style guide … Do not include the reference's subject. Square ability icon …
One bold central motif filling about 70% of the frame, instantly readable at 48 pixels, no small clutter. Background:
opaque, very dark umber with a soft radial glow behind the motif …", then `Subject: <one motif, with its direction>`
and a colour scheme line per champion (Ember: ember orange, flame yellow, deep red; Fang: bright steel, pale
white-gold light, dark red, explicitly "not fire").

What to watch for: seven icons of one champion share a palette, so they must differ in **silhouette** (diagonal dart,
round swirl, chevrons, flat ring, shield, creature, vertical rock). Judge a new icon at 52 px next to the others, not
at full size.

## Post-processing

- Portraits: alpha faded over the last 96 px on the right and 28 px on the left so a figure cropped by the image edge
  does not end in a straight line; saved as WebP quality 88 with alpha.
- Icons: downscaled 1024 → 192 px (Lanczos), WebP quality 86.
