// Peek M2-B1 — layout adapter shared constants (MAIN + ISOLATED worlds).
// Contract: docs/m2-b1/adapter-contract.md. Experimental build only
// (__PEEK_LAYOUT_ADAPTER__ define); the default M1-R build never registers it.

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
// MAIN → ISOLATED results
export const LAD_ACTIVE = "ACTIVE";
export const LAD_UNSUPPORTED = "UNSUPPORTED";
export const LAD_ERROR = "ERROR";
export const LAD_UNINSTALLED = "UNINSTALLED";

// The one virtualizer method this adapter may wrap (contract §0).
export const LAD_KEY = "_getFinalRenderedItems";

// Focal-article DOM marker (contract §8): the MAIN adapter maintains it,
// because it is the side that re-binds when X rebuilds the focal cell.
export const LAD_MARK_ARTICLE = "data-peek-lad-focal";

export const LAD_HEALTH_INTERVAL_MS = 1500;
export const LAD_REINSTALL_BUDGET = 2;      // bounded instance-replacement re-install attempts
export const LAD_CELL_MISS_TICKS = 2;       // transient re-render tolerance before exit

// ISOLATED controller timings
export const LAD_INSTALL_ACK_MS = 1200;     // MAIN world absent/unresponsive → fail, no retry
export const LAD_INSTALL_RETRY_MS = 250;    // page not ready yet (UNSUPPORTED) → retry
export const LAD_INSTALL_MAX_ATTEMPTS = 12; // 3s budget per route entry, then dormant
