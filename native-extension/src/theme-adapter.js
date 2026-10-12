// Peek Native — theme adaptation. X owns its theme; we only mirror the colors
// X currently paints with onto the reading pane's CSS custom properties.

import { NS, PANE_ID } from "./constants.js";

let themeObserver = null;

export function readTheme() {
  const bg = getComputedStyle(document.body).backgroundColor;
  const m = bg.match(/(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/);
  if (m) {
    const [r, g, b] = [+m[1], +m[2], +m[3]];
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) < 128 ? "dark" : "light";
  }
  // transparent body (X paints elsewhere): fall back to the root color-scheme
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
