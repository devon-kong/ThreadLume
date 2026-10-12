// Peek Native — navigation session: the real session-history bookkeeping that
// powers the close decision (R4 G0-A). The reader may only call history.back()
// when the previous entry is KNOWN to be a same-site X page; direct entries,
// refreshes and off-site predecessors dismiss the enhancement in place instead.
//
// Primary source is the Navigation API entries() (cross-origin entries arrive
// URL-redacted by the browser itself, making the same-site check exact);
// fallback is an in-document trail of observed navigations — back from an
// entry this document visited always stays in this document, while the
// document's initial entry has an unknown (possibly off-site) predecessor.

import { sameSiteX } from "./constants.js";

// Trail semantics: [href] in visit order. Index 0 means "no safe back target"
// unless the Navigation API contradicts it with real session entries.
let navTrail = [];
let navTrailIdx = -1;
let pendingTraverse = false; // set by popstate before the observers run

// Initialize at install time — before any route observer or poll runs (the
// first route check can be seconds away, and the URL may have changed by then).
export function initNavigationSession() {
  try {
    navTrail = [location.href];
    navTrailIdx = 0;
  } catch { /* exotic location — syncTrailFromLocation re-baselines lazily */ }
}

export const NAV_API = (() => {
  try {
    if (window.__peekNoNavApi) return false; // offline/live test hook: force the fallback path
    return typeof window.navigation?.addEventListener === "function";
  } catch { return false; }
})();

export function recordNav(type, destUrl) {
  if (!destUrl || navTrail[navTrailIdx] === destUrl) return;
  if (type === "replace") {
    if (navTrailIdx >= 0) navTrail[navTrailIdx] = destUrl;
    else { navTrail = [destUrl]; navTrailIdx = 0; }
  } else if (type === "traverse") {
    const at = navTrail.lastIndexOf(destUrl);
    if (at >= 0) navTrailIdx = at;
    else { navTrail = navTrail.slice(0, navTrailIdx + 1); navTrail.push(destUrl); navTrailIdx = navTrail.length - 1; }
  } else if (type === "reload") {
    // same entry: index unchanged
  } else if (type === "push" || type === "auto_toplevel") {
    navTrail = navTrail.slice(0, navTrailIdx + 1);
    navTrail.push(destUrl);
    navTrailIdx = navTrail.length - 1;
  }
}

// Fallback bookkeeping: deduce push/traverse from the (already-committed) URL
// when Navigation events are unavailable. Popstate implies traverse; a URL
// change observed without popstate implies push (X pushes statuses).
export function syncTrailFromLocation(viaTraverse) {
  const href = location.href;
  if (navTrail.length === 0) { navTrail = [href]; navTrailIdx = 0; return; }
  if (navTrail[navTrailIdx] === href) return;
  if (viaTraverse) {
    const at = navTrail.lastIndexOf(href);
    if (at >= 0) { navTrailIdx = at; return; }
  }
  navTrail = navTrail.slice(0, navTrailIdx + 1);
  navTrail.push(href);
  navTrailIdx = navTrail.length - 1;
}

// The close decision: may history.back() land on a same-site X page?
export function safeBackTarget() {
  try {
    const nav = NAV_API ? window.navigation : null;
    if (nav && typeof nav.entries === "function" && nav.currentEntry) {
      const idx = nav.currentEntry.index;
      if (!(idx > 0)) return { back: false, why: "navapi-initial-entry" };
      const prev = nav.entries()[idx - 1];
      if (prev?.url && sameSiteX(prev.url)) return { back: true, why: "navapi-same-site-entry" };
      return { back: false, why: "navapi-previous-entry-not-x" };
    }
  } catch { /* entries() unavailable in this world — use the trail */ }
  if (navTrailIdx > 0) return { back: true, why: "trail-visited-entry" };
  return { back: false, why: navTrail.length === 0 ? "trail-empty" : "trail-initial-entry" };
}

export function navTrailState() {
  return { trail: [...navTrail], idx: navTrailIdx };
}

export function markPendingTraverse() {
  pendingTraverse = true;
}

export function consumePendingTraverse() {
  const v = pendingTraverse;
  pendingTraverse = false;
  return v;
}
