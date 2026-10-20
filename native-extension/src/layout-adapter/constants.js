// Peek M2-B1 — layout adapter shared constants (MAIN + ISOLATED worlds).
// Contract: docs/m2-b1/adapter-contract.md. Registered by the unified build
// (__PEEK_LAYOUT_ADAPTER__ define is always on).

// window.postMessage namespace. BOTH worlds see every message event on the
// shared window (including their own), so `from` disambiguates direction.
// The namespace + nonce correlate messages; they are NOT a security boundary —
// the boundary is event.source === window && event.origin === page origin,
// plus the fact that this adapter holds no credentials and performs no writes
// (a hostile page script can only re-arrange the page it already owns).
export const LAD_NS = "peek-lad";

export const LAD_FROM_ISOLATED = "isolated";
export const LAD_FROM_MAIN = "main";

// ISOLATED → MAIN commands
export const LAD_INSTALL = "INSTALL";
export const LAD_UNINSTALL = "UNINSTALL";
export const LAD_QUERY = "QUERY";
// Only the left native-view handoff uses this synchronous, document-targeted
// DOM transport. It carries JSON strings, never cross-world object references.
// Page scripts can forge it, just like postMessage: correlation is NOT auth.
export const LAD_NATIVE_RELEASE = "peek-lad-native-release";
export const LAD_NATIVE_RELEASED = "peek-lad-native-released";

export function readNativeReleaseDetail(detail, response = false) {
  if (typeof detail !== "string" || detail.length > 1024) return null;
  try {
    const m = JSON.parse(detail);
    const keys = response ? ["focusUrlId", "nonce", "gen", "pathname", "status"] : ["focusUrlId", "nonce", "gen", "pathname"];
    if (!m || Array.isArray(m) || Object.keys(m).length !== keys.length || !keys.every(k => Object.hasOwn(m, k))) return null;
    if (typeof m.focusUrlId !== "string" || !/^\d{1,32}$/.test(m.focusUrlId) ||
        !Number.isSafeInteger(m.nonce) || m.nonce <= 0 || !Number.isSafeInteger(m.gen) || m.gen <= 0 ||
        typeof m.pathname !== "string" || m.pathname.length > 512 || !m.pathname.startsWith("/") ||
        m.pathname.match(/\/status\/(\d+)(?:\/|$)/)?.[1] !== m.focusUrlId) return null;
    if (response && !["released", "refused", "error"].includes(m.status)) return null;
    return m;
  } catch { return null; }
}
// MAIN → ISOLATED request responses (always correlate to a request via nonce)
export const LAD_ACTIVE = "ACTIVE";
export const LAD_UNSUPPORTED = "UNSUPPORTED";
export const LAD_ERROR = "ERROR";
export const LAD_UNINSTALLED = "UNINSTALLED";
// MAIN → ISOLATED autonomous notifications (M2-B1-R P0-A): sent with NO request
// in flight. Correlated by { gen, focusUrlId, reqNonce } — never by nonce alone,
// because these fire outside any request/response exchange (health-check exits,
// route self-detection, internal re-installs). The nonce field is null on them.
export const LAD_HEALTH_ERROR = "HEALTH_ERROR";
export const LAD_HEALTH_UNINSTALLED = "HEALTH_UNINSTALLED";
export const LAD_HEALTH_ACTIVE = "HEALTH_ACTIVE";

// The one virtualizer method this adapter may wrap (contract §0).
export const LAD_KEY = "_getFinalRenderedItems";

// Focal-article DOM marker (contract §8): the MAIN adapter maintains it,
// because it is the side that re-binds when X rebuilds the focal cell.
export const LAD_MARK_ARTICLE = "data-peek-lad-focal";

export const LAD_HEALTH_INTERVAL_MS = 1500;
export const LAD_REINSTALL_BUDGET = 2;      // bounded instance-replacement re-install attempts
export const LAD_CELL_MISS_TICKS = 2;       // transient re-render tolerance before exit
// P1-B: same-cell article swap handling
export const LAD_ARTICLE_SETTLE_MS = 120;   // debounce for the cell mutation watcher
export const LAD_ARTICLE_GONE_MS = 3000;    // article absent longer than this → exit

// ISOLATED controller timings
export const LAD_INSTALL_ACK_MS = 1200;     // MAIN world absent/unresponsive → fail, no retry
// M2-B2-A: retries poll for the detail's focal cell, and the split CSS can
// only mount after it. A 250ms cadence left the unpinned detail visible for up
// to 250ms before the snap; 60ms bounds that takeover window to ~3 frames.
// The budget stays 3s (60ms × 50): the detail render itself takes ~1s.
export const LAD_INSTALL_RETRY_MS = 60;     // page not ready yet (UNSUPPORTED) → retry
export const LAD_INSTALL_MAX_ATTEMPTS = 50; // 3s budget per route entry, then dormant
