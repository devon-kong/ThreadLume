// Peek Native — shared constants and tiny helpers.
// Formal engineering carrier of the R4-validated PoC v5 mechanisms (M1).
// Zero internal-API calls, zero page bridge, isolated world only.

export const NS = "peek-native";
export const PANE_ID = `${NS}-pane`;
export const STYLE_ID = `${NS}-style`;

export const ROUTE_POLL_ACTIVE_MS = 500;  // detail page open or pane mounted
export const ROUTE_POLL_IDLE_MS = 2000;   // plain X pages, enhancement dormant
export const BUILD_POLL_MS = 500;         // per DOM-wait attempt
export const BUILD_MAX_ATTEMPTS = 30;     // 15s budget per build round
export const RECOVERY_MAX_ROUNDS = 3;     // bounded retries after a failed build
export const RECOVERY_DELAY_MS = 3000;    // spacing between recovery rounds
export const RICH_SCAN_WINDOW_MS = 20_000; // bounded window for late media-hydration rescan
export const HYDRATION_POLL_MS = 250;     // detail-hydration upgrade interval
export const HYDRATION_POLL_MAX = 12;     // bounded detail-hydration attempts (3s)

export const ESCAPED = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function sameSiteX(url) {
  try {
    const h = new URL(url).hostname;
    return h === "x.com" || h.endsWith(".x.com") || h === "twitter.com" || h.endsWith(".twitter.com");
  } catch { return false; }
}

export const statusIdFromPath = () => (location.pathname.match(/\/status\/(\d+)/) || [])[1] || null;
export const isDetailPath = () => Boolean(statusIdFromPath());
