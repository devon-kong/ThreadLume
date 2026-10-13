// Peek Native — minimal in-memory diagnostics (route timing, build timing,
// anchor-restore outcome). Local only: never persisted, never sent anywhere,
// exposed through the offline/live test hook for verification runs.

const state = {
  routeChanges: [],       // performance.now() of each OBSERVED route change (bounded)
  lastRouteChangeAt: -1,  // -1 = none observed yet
  firstPaintAt: null,     // pane mounted (fast first paint)
  buildMs: null,          // route observed → pane mounted for the current read
  hydrationRefreshAt: null,
  anchor: null,           // last anchor-restore record (B3)
  commentsFirst: null     // last comments-first record (M2-A)
};

export function recordRouteChange(at) {
  state.lastRouteChangeAt = at;
  state.routeChanges.push(at);
  if (state.routeChanges.length > 64) state.routeChanges.shift();
  state.firstPaintAt = null;
  state.buildMs = null;
  state.hydrationRefreshAt = null;
  state.commentsFirst = null;
}

export function recordFirstPaint(at, buildMs) {
  state.firstPaintAt = at;
  state.buildMs = buildMs;
}

export function recordHydrationRefresh(at) {
  state.hydrationRefreshAt = at;
}

export function recordAnchorRestore(record) {
  state.anchor = record;
}

export function recordCommentsFirst(record) {
  state.commentsFirst = record;
}

export const lastRouteChangeAt = () => state.lastRouteChangeAt;
export const firstPaintAt = () => state.firstPaintAt;
export const buildMs = () => state.buildMs;
export const hydrationRefreshAt = () => state.hydrationRefreshAt;
export const anchorRecord = () => state.anchor;
export const routeChangeCount = () => state.routeChanges.length;

export function snapshot() {
  return {
    routeChanges: [...state.routeChanges],
    lastRouteChangeAt: state.lastRouteChangeAt,
    firstPaintAt: state.firstPaintAt,
    buildMs: state.buildMs,
    hydrationRefreshAt: state.hydrationRefreshAt,
    anchor: state.anchor ? { ...state.anchor } : null,
    commentsFirst: state.commentsFirst ? { ...state.commentsFirst } : null
  };
}
