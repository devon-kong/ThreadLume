// Peek Native — route observation (R4 G0-B: event-driven, poll as safety net).
//
// M1-R A1 boundary fix: in a real Chromium extension the isolated world CAN
// register a Navigation API "navigate" listener, but Chromium never DELIVERS
// the events to it (observed live, M1-B3 — the listener registers, the event
// never fires). "Registrable" therefore must not be treated as "reachable",
// and the title watcher — previously a NAV_API-absent fallback only — runs in
// EVERY configuration as a co-primary signal:
//
//  - Navigation API "navigate" (when this world does receive it, e.g. a future
//    Chromium): instant for every same-document navigation, any initiating
//    world, keyboard included. Also feeds the close-decision trail with exact
//    types and captures the reading anchor pre-commit (B3).
//  - <title> mutation: X rewrites the title per route change, including
//    keyboard/programmatic navigation that no click saw. The watcher re-binds
//    itself when X replaces the <title> element wholesale and arms the same
//    short bounded cascade the click path uses.
//  - (co-signal) capture-phase click cascade: X navigations originate from a
//    link click; re-check immediately and on a short bounded cascade in case
//    the router defers pushState to a later task.
//  - popstate / hashchange: browser back/forward (traverse) — also marks the
//    trail.
//  - bounded poll: the honest last resort for paths that touch neither the
//    title nor a click nor popstate (see ROUTE_POLL_IDLE_MS).
//
// The capture-phase click listener only OBSERVES clicks; it never
// preventDefault and never intercepts navigation (X's router stays authoritative).

import {
  NS, ROUTE_POLL_ACTIVE_MS, ROUTE_POLL_IDLE_MS, statusIdFromPath, isDetailPath
} from "./constants.js";
import {
  NAV_API, recordNav, syncTrailFromLocation,
  markPendingTraverse, consumePendingTraverse
} from "./navigation-session.js";
import { buildReader, removeReader, maybeRecover } from "./reader-lifecycle.js";
// M2-B1: in the experimental build the user browses natively (no reader close
// path), so X's own scroll restoration owns list returns — our correction
// would fight it. Anchor captures stay (inert bookkeeping); restores are gated.
import { adapterEnabled } from "./layout-adapter/controller.js";
import { capturePreOpen, onReturnToList, preOpenAnchor } from "./anchor-restore.js";
// M2-B2-A instant reading preview (lab build only; inert without the adapter)
import { captureClickForPreview, previewOnRouteChange } from "./preview-layer.js";
import { applyTheme } from "./theme-adapter.js";
import { syncRichNote, paneMounted, mountedPane } from "./reader-view.js";
import * as diagnostics from "./diagnostics.js";

let activeStatusId = null;
let routeTimer = 0;
let lastRouteChangeAt = -1; // perf probe: performance.now() of the latest detected route change
let titleObserver = null;
let titleElement = null;
let clickCascadeTimers = [];

export const getActiveStatusId = () => activeStatusId;
export const setInitialStatusId = (id) => { if (activeStatusId === null) activeStatusId = id; };
export const lastRouteChangeObservedAt = () => lastRouteChangeAt;

function onPossibleRouteChange(viaTraverse) {
  if (viaTraverse) markPendingTraverse();
  queueMicrotask(checkRoute);
}

export function checkRoute() {
  // Trail bookkeeping runs in EVERY configuration: with navigate events
  // delivered it is a no-op dedup against recordNav's trail top; without them
  // (observed Chromium isolated-world behavior) it is the only thing keeping
  // the close-decision trail alive. Popstate marks the traverse flag first.
  syncTrailFromLocation(consumePendingTraverse());
  const id = statusIdFromPath();
  if (id !== activeStatusId) {
    lastRouteChangeAt = performance.now(); // when the route change was OBSERVED
    diagnostics.recordRouteChange(lastRouteChangeAt);
    // the offline/CDP harness cannot reach into this isolated world's JS, but
    // the DOM is shared — mirror the probe timestamp onto <html> when armed
    if (window.__PEEK_NATIVE_TEST__) {
      try { document.documentElement.setAttribute(`data-${NS}-route-change-at`, String(lastRouteChangeAt)); } catch { /* probe only */ }
    }
    const previous = activeStatusId;
    activeStatusId = id;
    if (id) {
      previewOnRouteChange(id); // preview confirms its navigation → NATIVE_WAITING
      // entering a detail: cancel any restore still pending from the previous
      // session and re-run the capture as belt-and-braces. capturePreOpen
      // refuses detail-context captures (A2 ownership), so on the committed
      // detail URL this no longer records a position — the pre-commit click /
      // navigate captures own that; the call stays so a route entry always
      // cancels a superseded restore even when no click was seen (keyboard).
      capturePreOpen(id, "route-check");
      removeReader(); // also invalidates any in-flight build for the old post
      buildReader();
    } else {
      previewOnRouteChange(null); // left the detail a waiting preview pointed at
      removeReader();
      if (previous && !adapterEnabled()) onReturnToList(previous);
    }
  } else if (id) {
    const pane = mountedPane();
    if (pane) {
      if (pane.dataset.statusId !== id) {
        // stale pane (should not happen — every mount re-verifies the URL —
        // but the invariant "left pane shows the URL's post" is enforced here)
        removeReader();
        buildReader();
      } else {
        // Bounded maintenance while reading: keep the theme in sync with any
        // theme-change mutation the observers might miss, and surface a
        // rich-media note if the video player/poll/card hydrated after the
        // pane was built (extraction runs once; hydration can land later).
        applyTheme();
        syncRichNote(id);
      }
    } else {
      maybeRecover();
    }
  }
}

function routeTick() {
  try {
    checkRoute();
  } catch {
    // the route watch must survive unexpected DOM shapes; next tick retries
  }
  scheduleRouteTick();
}

function scheduleRouteTick() {
  routeTimer = setTimeout(routeTick, isDetailPath() || paneMounted() ? ROUTE_POLL_ACTIVE_MS : ROUTE_POLL_IDLE_MS);
}

// Capture-phase click handling, registered in EVERY configuration:
//  1. B3 pre-commit anchor capture — a click on a status link is the last
//     moment the source list DOM is guaranteed mounted. This must NOT depend
//     on the Navigation API: observed live (M1) that Chromium does NOT deliver
//     "navigate" events to the isolated world (the listener registers, the
//     event never fires), so the navigate handler below cannot be the capture
//     path in a real extension. The document capture listener runs before
//     X's router reacts (React attaches at the root container, deeper than
//     document capture).
//  2. Route-check cascade — an immediate + bounded re-check safety net that
//     covers router-deferred pushState in every configuration.
function onCaptureClick(event) {
  // Test-build probe (esbuild define; compiled out of non-diag builds): the
  // handler-entry timestamp on the shared <html>, so the harness can verify
  // its own window-capture t0 preceded the extension's document-capture work.
  // Timestamps only — never page content, never credentials.
  /* eslint-disable no-undef */
  if (__PEEK_DIAG_STAMPS__) {
    try { document.documentElement.setAttribute("data-peek-capture-at", String(performance.now())); } catch { /* probe only */ }
  }
  /* eslint-enable no-undef */
  try {
    const a = event.target?.closest?.("a[href]");
    if (a) {
      const href = a.getAttribute("href") || "";
      if (href.startsWith("/")) {
        const id = (href.match(/\/status\/(\d+)/) || [])[1] || null;
        // only list → detail opens capture; detail → detail keeps the anchor
        if (id && !statusIdFromPath()) capturePreOpen(id, "click-precommit");
      }
    }
  } catch { /* anchor capture is best-effort */ }
  // M2-B2-A: synchronous preview extraction from the clicked cell — runs in
  // the capture phase, before X's own handler can commit the navigation and
  // unmount the timeline (the race that made M1-R's fast path a 25% lottery).
  // Lab build only; the preview never preventDefaults or intercepts.
  if (adapterEnabled()) {
    try { captureClickForPreview(event); } catch { /* preview is best-effort */ }
  }
  armClickCascade();
}

export function startRouteObservation() {
  window.addEventListener("popstate", () => onPossibleRouteChange(true));
  window.addEventListener("hashchange", () => onPossibleRouteChange(false));
  document.addEventListener("click", onCaptureClick, true);
  // The title watcher is a co-primary signal in EVERY configuration (A1): a
  // real isolated world may never receive navigate events, so keyboard and
  // programmatic SPA navigation must not depend on them.
  watchTitle();
  if (NAV_API) {
    try {
      window.navigation.addEventListener("navigate", (event) => {
        recordNav(event.navigationType, event.destination?.url);
        // B3 belt-and-braces: if this world DOES receive navigate events
        // (future Chromium), capture pre-commit here as well; the click
        // capture already stored the same position and this re-captures the
        // identical DOM state.
        try {
          if (event.destination?.url && event.navigationType === "push" && !statusIdFromPath()) {
            const destPath = new URL(event.destination.url).pathname;
            const destId = (destPath.match(/\/status\/(\d+)/) || [])[1] || null;
            if (destId) capturePreOpen(destId, "navigate-precommit");
          }
        } catch { /* anchor capture is best-effort */ }
        onPossibleRouteChange(event.navigationType === "traverse");
      });
    } catch { /* title watcher + poll + popstate + click cascade remain */ }
  }
  scheduleRouteTick();
}

function armClickCascade() {
  for (const h of clickCascadeTimers) clearTimeout(h);
  clickCascadeTimers = [0, 60, 150, 350].map((ms) =>
    setTimeout(() => { try { checkRoute(); } catch { /* next cascade step retries */ } }, ms));
}

function watchTitle() {
  if (titleObserver) return;
  titleObserver = new MutationObserver(() => {
    // X can replace the title element wholesale; every root/level childList
    // change re-arms the roots and re-binds the watcher to the CURRENT title
    // element before the route check, so a replaced element never leaves us
    // blind (A1).
    observeTitleRoot();
    bindTitleElement();
    onPossibleRouteChange(false);
    // same bounded cascade as the click path: covers a router that touches
    // the title a beat before committing pushState (or vice versa)
    armClickCascade();
  });
  observeTitleRoot();
  bindTitleElement();
}

// Two observation roots, one observer (A1 robustness):
//  - documentElement: catches <head> CREATION — scripts injected at
//    document_start (the offline/CDP harness, future early-run
//    configurations) run before the parser creates head; body subtree
//    changes never bubble to documentElement, so steady-state cost is nil.
//  - head: catches the title element being REPLACED inside head (a head-
//    internal mutation does not bubble to documentElement).
let observedRoots = [];
function observeTitleRoot() {
  // prune replaced heads so the observer never accumulates detached nodes
  observedRoots = observedRoots.filter((root) => {
    if (root.isConnected) return true;
    try { titleObserver.unobserve(root); } catch { /* already gone */ }
    return false;
  });
  for (const root of [document.documentElement, document.head]) {
    if (root && !observedRoots.includes(root)) {
      try { titleObserver.observe(root, { childList: true }); observedRoots.push(root); }
      catch { /* detached — the next mutation retries */ }
    }
  }
}

function bindTitleElement() {
  // No <title> yet (exotic/early document): the root childList observations
  // re-run this when head changes, so the watcher self-heals.
  const t = document.querySelector("head > title");
  if (t && t !== titleElement) {
    titleElement = t;
    try { titleObserver.observe(t, { childList: true, characterData: true, subtree: true }); }
    catch { /* detached title — the next root mutation rebinds */ }
  }
}

export function stopRouteObservation() {
  // tests/teardown helper: halts the safety-net poll; event listeners live on
  // window for the document lifetime by design (content script semantics).
  clearTimeout(routeTimer);
}
