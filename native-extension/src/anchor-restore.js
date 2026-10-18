// Peek Native — B3 reading-anchor restore.
//
// When the reader is closed, Peek returns to X's own timeline and X remounts
// its virtual list, re-anchoring the scroll position (R4 measured the clicked
// post landing 151-153px off its pre-open viewport position — identical to
// bare X's own behavior). This module narrows that user-visible offset:
//
//   1. At open time (pre-commit click/navigate capture) record the focal
//      post's viewport-relative Y (identity + position + source).
//   2. On returning to a list, wait for the native timeline to remount the
//      focal post's cell AND for the scroll position to settle.
//   3. Apply AT MOST ONE instant scroll correction toward the recorded offset.
//
// M1-R A2 ownership rules (the list anchor is an owned resource):
//   - Only a capture taken while the LIST is the current view (the URL is not
//     a detail path) is a valid list anchor. A capture attempt made on a
//     detail page would read the detail page's own focal cell and overwrite
//     the true list origin with a meaningless position — refused outright.
//   - Only a NEW legal reading session (a fresh list-context capture) replaces
//     an existing anchor; detail→detail navigation keeps the original one.
//   - The anchor is CONSUMED when its restore session ends (adjusted, within
//     threshold, window expired, user input): a stale position must never
//     survive into a later, unrelated open. The one exception is a restore
//     cancelled because a new open superseded it — that open re-captures.
//
// Hard limits (task B3): never continuously force scroll, never race the
// virtualizer. Any user input (wheel, touch, scroll keys, pointer-down) during
// the short restore window cancels it; if the cell never reappears or the
// scroll never settles inside a bounded window, native behavior is kept as-is.

import { statusIdFromPath } from "./constants.js";
import { focalCellByStatusId } from "./focal-extractor.js";
import { recordAnchorRestore } from "./diagnostics.js";

export const RESTORE_WINDOW_MS = 2500; // bounded total wait after returning
export const RESTORE_POLL_MS = 150;
export const SETTLE_CHECKS = 2;        // consecutive polls with unchanged scrollY
export const ADJUST_THRESHOLD_PX = 40; // only correct a visible offset

let preOpen = null;   // { statusId, top, source } viewport Y of the focal cell at open
let active = false;
let timers = [];
let stopActivity = null;
let requestedReturn = null;

// Only an explicit Peek Back owns a correction in the native adapter. Ordinary
// X/browser navigation keeps native restoration. A request expires or is
// consumed by the very next route change, including a detail-to-detail back.
export function requestListReturnRestore(statusId) {
  requestedReturn = preOpen?.statusId === statusId
    ? { statusId, expires: Date.now() + RESTORE_WINDOW_MS } : null;
}

export function consumeListReturnRestore(fromStatusId) {
  const request = requestedReturn;
  requestedReturn = null;
  return !!request && request.statusId === fromStatusId && Date.now() <= request.expires;
}

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

// Called on possible list → detail transitions (the route observer decides).
// Ownership (A2): a capture is only recorded when the CURRENT view is still a
// list (no /status/ in the URL) — the pre-commit click/navigate captures
// qualify; a call that lands after the route committed to a detail page reads
// the detail page's own focal cell, so it is refused: the existing anchor is
// kept untouched (never overwritten), and no detail-position anchor is stored.
// A failed lookup keeps a capture for the SAME post (never overwrite the
// better pre-commit one with null), and forgets captures for other posts.
export function capturePreOpen(statusId, source = "route-check") {
  if (!statusId) return null;
  cancelRestore("superseded-open");
  if (statusIdFromPath()) return preOpen ? { ...preOpen } : null; // detail-context: refused
  try {
    const cell = focalCellByStatusId(statusId);
    if (cell) {
      preOpen = { statusId, top: cell.getBoundingClientRect().top, source };
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
  // Own the anchor for this restore session: a snapshot is immune to any
  // capture/forget that happens while the window is open.
  const anchor = { ...preOpen };
  active = true;
  mirrorAnchor();
  stopActivity = watchUserInput(() => endRestore("user-input", anchor));
  const deadline = Date.now() + RESTORE_WINDOW_MS;
  let lastScrollY = null;
  let stable = 0;
  const step = () => {
    if (!active) return; // cancelled meanwhile
    if (Date.now() > deadline) { endRestore("window-expired", anchor); return; }
    const cell = focalCellByStatusId(fromStatusId);
    if (!cell) { timers.push(setTimeout(step, RESTORE_POLL_MS)); return; }
    const y = window.scrollY;
    stable = y === lastScrollY ? stable + 1 : 0;
    lastScrollY = y;
    if (stable < SETTLE_CHECKS) { timers.push(setTimeout(step, RESTORE_POLL_MS)); return; }
    const top = cell.getBoundingClientRect().top;
    const delta = computeAnchorAdjustment({ preTop: anchor.top, cellTop: top });
    recordAnchorRestore({
      statusId: fromStatusId, preTop: anchor.top, cellTop: top,
      delta, applied: delta !== null
    });
    if (delta !== null) {
      try { window.scrollBy(0, delta); } catch { /* keep native behavior */ }
    }
    endRestore(delta === null ? "within-threshold" : "adjusted", anchor);
  };
  timers.push(setTimeout(step, RESTORE_POLL_MS));
  return true;
}

// Terminal restore states CONSUME the anchor (A2): a used, expired or
// user-overridden position must not leak into a later open as a stale target.
// Superseded/teardown cancels keep it — the superseding open re-captures.
function endRestore(reason, anchor) {
  finish(reason);
  if (preOpen && anchor && preOpen.statusId === anchor.statusId &&
      preOpen.top === anchor.top && preOpen.source === anchor.source) {
    preOpen = null;
  }
  mirrorAnchor();
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
