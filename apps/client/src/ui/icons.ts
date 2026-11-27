// Ability and champion icons as inline SVG path markup (24×24 and 48×48 viewBox). Keyed by the ids used in content.

export const ABILITY_ICONS: Record<string, string> = {
  bolt: '<path d="M4 20 15 9"/><path d="M10 5h9v9"/>',
  orb: '<circle cx="14" cy="10" r="6"/><path d="M4 20l5-5M3 15l3-2M9 21l2-3"/>',
  blink: '<path d="M5 6l6 6-6 6M13 6l6 6-6 6"/>',
  ring: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="3.5"/>',
  shield: '<path d="M12 3l7 3v6c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z"/>',
  meteor: '<circle cx="15" cy="15" r="5"/><path d="M3 3l8.5 8.5M8 3l6 6M3 8l6 6"/>',
  cleave: '<path d="M3 15c3-7 15-7 18 0"/><path d="M16 8.5l5 6.5-7 .5"/>',
  hook: '<path d="M3 21l9-9"/><path d="M12 12V7a4 4 0 1 1 8 0v2l-3-2"/>',
  leap: '<path d="M3 18c2-9 16-9 18 0"/><path d="M15 16l6 2 1-6"/><path d="M7 21h10"/>',
  bash: '<path d="M6 4h12v9c0 4-3 6-6 7-3-1-6-3-6-7z"/><path d="M12 8v6M9 11h6"/>',
  counter: '<circle cx="12" cy="12" r="9"/><path d="M8 8l8 8M16 8l-8 8"/>',
  whirl: '<path d="M12 12a2 2 0 1 1 2 2 4 4 0 1 1-4-6 6 6 0 1 1-6 6"/>',
  wisp: '<path d="M12 21c-4 0-6-3-6-6 0-4 4-5 4-10 3 2 4 4 4 7 1-1 2-2 2-4 2 2 2 4 2 7 0 3-2 6-6 6z"/><circle cx="12" cy="16" r="1.6"/>',
  paw: '<circle cx="6.5" cy="10" r="2"/><circle cx="10" cy="6" r="2"/><circle cx="14" cy="6" r="2"/><circle cx="17.5" cy="10" r="2"/><path d="M8 17c0-3 2-5 4-5s4 2 4 5-2 3-4 3-4 0-4-3z"/>',
};

export const CHAMPION_EMBLEMS: Record<string, string> = {
  ember:
    '<path d="M24 42c-8 0-13-5-13-12 0-8 7-11 8-19 4 3 6 7 6 11 2-2 3-5 3-8 5 4 9 9 9 16 0 7-5 12-13 12z"/><path d="M24 42c-3 0-5-2-5-5 0-4 4-5 5-9 2 2 5 5 5 9 0 3-2 5-5 5z"/>',
  fang: '<path d="M14 40 34 14"/><path d="M30 8c6 1 10 5 11 11l-7 2-6-6z"/><path d="M10 22c0-6 4-10 10-11v12c0 5-3 9-10 11z"/>',
};

export const KEY_LABELS: Record<string, string> = {
  primary: "ЛКМ",
  secondary: "ПКМ",
  mobility: "Space",
  q: "Q",
  e: "E",
  companion: "R",
  ultimate: "F",
};
