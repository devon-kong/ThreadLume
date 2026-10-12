// Peek Native — B3 reading-anchor restore.
//
// When the reader is closed, Peek returns to X's own timeline and X remounts
// its virtual list, re-anchoring the scroll position (R4 measured the clicked
// post landing 151-153px off its pre-open viewport position — identical to
// bare X's own behavior). This module narrows that user-visible offset:
//
//   1. At open time (pre-commit Navigation event where available) record the
//      focal post's viewport-relative Y (identity + position).
//   2. On returning to a list, wait for the native timeline to remount the
//      focal post's cell AND for the scroll position to settle.
//   3. Apply AT MOST ONE instant scroll correction toward the recorded offset.
//
// Hard limits (task B3): never continuously force scroll, never race the
// virtualizer. Any user input (wheel, touch, scroll keys, pointer-down) during
// the short restore window cancels it; if the cell never reappears or the
// scroll never settles inside a bounded window, native behavior is kept as-is.

import { focalCellByStatusId } from "./focal-extractor.js";
import { recordAnchorRestore } from "./diagnostics.js";

export const RESTORE_WINDOW_MS = 2500; // bounded total wait after returning
export const RESTORE_POLL_MS = 150;
export const SETTLE_CHECKS = 2;        // consecutive polls with unchanged scrollY
export const ADJUST_THRESHOLD_PX = 40; // only correct a visible offset

let preOpen = null;   // { statusId, top } viewport Y of the focal cell at open
let active = false;
let timers = [];
let stopActivity = null;

export function preOpenAnchor() {
  return preOpen ? { ...preOpen } : null;
}

export const restoreActive = () => active;

// Pure helper: the scroll delta that restores the recorded viewport position,
// or null when the residual offset is inside the threshold (no adjustment).
export function computeAnchorAdjustment({ preTop, cellTop, threshold = ADJUST_THRESHOLD_PX }) {
  const delta = cellTop - preTop; // scrollBy(0, delta) puts the cell back
  return Math.abs(delta) > threshold ? delta : null;
}

// Test-hook DOM mirror: the offline/CDP harness cannot reach into this
// isolated world's JS, so the anchor state is mirrored onto <html> when armed
// (same pattern as the route-change timestamp). Never armed in production.
function mirrorAnchor() {
  try {
    if (!window.__PEEK_NATIVE_TEST__) return;
    document.documentElement.setAttribute("data-peek-anchor", JSON.stringify({
      preOpen: preOpen,
      active: active,
    }));
  } catch { /* mirror only */ }
}

// Called only on list → detail transitions (the route observer decides): with
// the Navigation API this runs pre-commit (the list DOM is still mounted —
// exact capture); the fallback runs it post-commit (best effort). A failed
// lookup keeps a capture for the SAME post (never overwrite the better
// pre-commit one with null), and forgets captures for other posts.
export function capturePreOpen(statusId) {
  if (!statusId) return null;
  cancelRestore("superseded-open");
  try {
    const cell = focalCellByStatusId(statusId);
    if (cell) {
      preOpen = { statusId, top: cell.getBoundingClientRect().top };
      mirrorAnchor();
      return preOpen;
    }
  } catch { /* best effort */ }
  if (preOpen?.statusId !== statusId) preOpen = null;
  mirrorAnchor();
  return preOpen;
}

export function forgetPreOpen() {
  preOpen = null;
}

function finish(reason) {
  active = false;
  if (stopActivity) { stopActivity(); stopActivity = null; }
  for (const t of timers) clearTimeout(t);
  timers = [];
  mirrorAnchor();
  return reason;
}

export function cancelRestore(reason = "cancelled") {
  if (active) finish(reason);
  return !active;
}

// Called by the route observer on a detail → list transition, with the id of
// the post that was just being read. Returns true when a restore was armed.
export function onReturnToList(fromStatusId) {
  if (active || !preOpen || preOpen.statusId !== fromStatusId) return false;
  active = true;
  mirrorAnchor();
  stopActivity = watchUserInput(() => finish("user-input"));
  const deadline = Date.now() + RESTORE_WINDOW_MS;
  let lastScrollY = null;
  let stable = 0;
  const step = () => {
    if (!active) return; // cancelled meanwhile
    if (Date.now() > deadline) { finish("window-expired"); return; }
    const cell = focalCellByStatusId(fromStatusId);
    if (!cell) { timers.push(setTimeout(step, RESTORE_POLL_MS)); return; }
    const y = window.scrollY;
    stable = y === lastScrollY ? stable + 1 : 0;
    lastScrollY = y;
    if (stable < SETTLE_CHECKS) { timers.push(setTimeout(step, RESTORE_POLL_MS)); return; }
    const top = cell.getBoundingClientRect().top;
    const delta = computeAnchorAdjustment({ preTop: preOpen.top, cellTop: top });
    recordAnchorRestore({
      statusId: fromStatusId, preTop: preOpen.top, cellTop: top,
      delta, applied: delta !== null
    });
    if (delta !== null) {
      try { window.scrollBy(0, delta); } catch { /* keep native behavior */ }
    }
    finish(delta === null ? "within-threshold" : "adjusted");
  };
  timers.push(setTimeout(step, RESTORE_POLL_MS));
  return true;
}

// One-shot user-input guard, armed only during the restore window.
function watchUserInput(onUserInput) {
  const opts = { capture: true, passive: true, once: false };
  const handler = () => { onUserInput(); };
  window.addEventListener("wheel", handler, opts);
  window.addEventListener("touchmove", handler, opts);
  window.addEventListener("keydown", handler, opts);
  window.addEventListener("pointerdown", handler, opts);
  return () => {
    window.removeEventListener("wheel", handler, opts);
    window.removeEventListener("touchmove", handler, opts);
    window.removeEventListener("keydown", handler, opts);
    window.removeEventListener("pointerdown", handler, opts);
  };
}
