// Peek Native — route observation (R4 G0-B: event-driven, poll as safety net).
//
// Event sources cover real SPA navigation instantly:
//  - Navigation API "navigate": instant for every same-document navigation
//    (pushState included — no popstate fires for those), any initiating world,
//    keyboard included. Also feeds the close-decision trail with exact types
//    and captures the reading anchor pre-commit (B3).
//  - (fallback only) capture-phase click cascade: X navigations originate from
//    a link click; re-check immediately and on a short bounded cascade in case
//    the router defers pushState to a later task.
//  - (fallback only) <title> mutation observer: X rewrites the title per
//    route; covers keyboard navigation that no click saw.
//  - popstate: browser back/forward (traverse) — also marks the trail.
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
import { capturePreOpen, onReturnToList } from "./anchor-restore.js";
import { applyTheme } from "./theme-adapter.js";
import { syncRichNote, paneMounted, mountedPane } from "./reader-view.js";
import * as diagnostics from "./diagnostics.js";

let activeStatusId = null;
let routeTimer = 0;
let lastRouteChangeAt = -1; // perf probe: performance.now() of the latest detected route change
let titleObserver = null;
let clickCascadeTimers = [];

export const getActiveStatusId = () => activeStatusId;
export const setInitialStatusId = (id) => { if (activeStatusId === null) activeStatusId = id; };
export const lastRouteChangeObservedAt = () => lastRouteChangeAt;

function onPossibleRouteChange(viaTraverse) {
  if (viaTraverse) markPendingTraverse();
  queueMicrotask(checkRoute);
}

export function checkRoute() {
  if (!NAV_API) {
    syncTrailFromLocation(consumePendingTraverse());
  }
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
      // entering a detail: remember where the post sat in the list (B3). Only
      // list → detail transitions capture; with the Navigation API the
      // pre-commit capture already ran and this re-runs harmlessly (same DOM);
      // detail → detail keeps the original list anchor untouched.
      if (!previous) capturePreOpen(id);
      removeReader(); // also invalidates any in-flight build for the old post
      buildReader();
    } else {
      removeReader();
      if (previous) onReturnToList(previous);
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
  try {
    const a = event.target?.closest?.("a[href]");
    if (a) {
      const href = a.getAttribute("href") || "";
      if (href.startsWith("/")) {
        const id = (href.match(/\/status\/(\d+)/) || [])[1] || null;
        // only list → detail opens capture; detail → detail keeps the anchor
        if (id && !statusIdFromPath()) capturePreOpen(id);
      }
    }
  } catch { /* anchor capture is best-effort */ }
  armClickCascade();
}

export function startRouteObservation() {
  window.addEventListener("popstate", () => onPossibleRouteChange(true));
  window.addEventListener("hashchange", () => onPossibleRouteChange(false));
  document.addEventListener("click", onCaptureClick, true);
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
            if (destId) capturePreOpen(destId);
          }
        } catch { /* anchor capture is best-effort */ }
        onPossibleRouteChange(event.navigationType === "traverse");
      });
    } catch { /* poll + popstate + click cascade remain */ }
  } else {
    watchTitle();
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
  titleObserver = new MutationObserver(() => onPossibleRouteChange(false));
  const bind = () => {
    const t = document.querySelector("head > title");
    if (t) { titleObserver.disconnect(); titleObserver.observe(t, { childList: true, characterData: true, subtree: true }); }
  };
  bind();
  // X can replace the title element wholesale; keep the observer bound to it
  titleObserver.observe(document.head, { childList: true });
}

export function stopRouteObservation() {
  // tests/teardown helper: halts the safety-net poll; event listeners live on
  // window for the document lifetime by design (content script semantics).
  clearTimeout(routeTimer);
}
