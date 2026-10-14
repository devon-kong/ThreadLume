// Peek Native — theme adaptation. X owns its theme; we only mirror the colors
// X currently paints with onto the reading pane's CSS custom properties.
//
// M2-B2-B: the reader skin paints the page canvas (html/body/primaryColumn)
// with an !important stylesheet rule, which OVERRIDES X's theme on the
// computed side. readTheme() must therefore read X's own theme signal first —
// X expresses the theme as an INLINE body background (measured on both themes:
// rgb(255,255,255) light / rgb(0,0,0) dark), so the inline value stays
// readable while the skin is mounted. Fallbacks keep the pre-skin semantics
// for every other caller (M1 pane, preview) and for builds without the skin.

import { NS, PANE_ID } from "./constants.js";

let themeObserver = null;

const parseRgb = (value) => {
  const m = String(value ?? "").match(/rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d+(?:\.\d+)?))?/);
  if (!m) return null;
  if (m[4] !== undefined && Number(m[4]) === 0) return null; // fully transparent tells nothing
  return [+m[1], +m[2], +m[3]];
};
const isDarkRgb = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) < 128;

export function readTheme() {
  // 1) X's own inline theme signal — survives the skin's !important canvas rule
  try {
    const rgb = parseRgb(document.body?.style?.backgroundColor);
    if (rgb) return isDarkRgb(rgb) ? "dark" : "light";
  } catch { /* no inline style support — fall through */ }
  // 2) X also sets the root color-scheme inline on its theme switch
  try {
    const scheme = document.documentElement?.style?.colorScheme;
    if (scheme === "dark") return "dark";
    if (scheme === "light") return "light";
  } catch { /* fall through */ }
  // 3) computed body background (the only signal before the skin exists)
  const bg = getComputedStyle(document.body).backgroundColor;
  const m = parseRgb(bg);
  if (m) return isDarkRgb(m) ? "dark" : "light";
  // 4) transparent body (X paints elsewhere): fall back to the root color-scheme
  if (getComputedStyle(document.documentElement).colorScheme === "light") return "light";
  return "dark";
}

export function applyTheme() {
  const pane = document.getElementById(PANE_ID);
  if (!pane) return;
  const theme = readTheme();
  const palette = theme === "dark"
    ? { bg: "#000000", fg: "#e7e9ea", dim: "#71767b", border: "#2f3336", hover: "#181818", accent: "#1d9bf0" }
    : { bg: "#ffffff", fg: "#0f1419", dim: "#536471", border: "#eff3f4", hover: "#f7f9f9", accent: "#1d9bf0" };
  for (const [k, v] of Object.entries(palette)) pane.style.setProperty(`--peek-${k}`, v);
}

export function watchTheme() {
  unwatchTheme();
  themeObserver = new MutationObserver(() => applyTheme());
  // X may switch themes via root or body class/style changes; watch both.
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
  if (document.body) themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
  applyTheme();
}

export function unwatchTheme() {
  themeObserver?.disconnect();
  themeObserver = null;
}

export const themeObserverActive = () => Boolean(themeObserver);
