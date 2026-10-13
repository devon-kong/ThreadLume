// Peek Native — M2-A comments-first positioning (design option C, hybrid).
//
// Problem measured on live X (M2-A B0/B1): with the reader open, the native
// focal cell duplicates what the left pane already carries, and its height
// pushes the replies far below the fold — a plain text post leaves only ~21%
// of the viewport for comments, photo posts ~0%.
//
// Design options evaluated (docs/m2-a):
//   A  CSS-compact the native focal cell  — REJECTED on evidence: clamping the
//      article bought only +4% comment visibility (the cell's composer and
//      action bar still occupy the fold); meaningful gains require clamping
//      the whole cell, which makes native controls nominally present but
//      inoperable — an explicit constraint violation. Also needs fragile
//      high-specificity overrides on X internals.
//   B  comments-first for every post     — works, but hides a playing video,
//      poll or article at open, which the left pane cannot carry.
//   C  hybrid (CHOSEN): comments-first ONLY for posts whose native focal cell
//      duplicates the left pane (text / photos / quote), native focal stays in
//      view for rich posts (video / poll / card / article) that need their
//      native carrier for function.
//
// Mechanism (option B's, gated): after the pane mounts, wait bounded for the
// first reply cell, then apply AT MOST ONE window scroll that brings the
// replies to the top of the right column. The native focal cell is never
// moved, hidden, or mutated — it stays in the DOM with full React state; one
// scroll-up (or any 定位 button) returns to it. Any user input during the
// short arming window cancels the scroll: the user who starts scrolling
// before the replies render owns the viewport.

import { statusIdFromPath } from "./constants.js";
import { focalCellByStatusId } from "./focal-extractor.js";
import * as diagnostics from "./diagnostics.js";

export const CF_POLL_MS = 200;          // bounded wait for the first reply cell
export const CF_WAIT_MAX_MS = 3000;
export const CF_MAX_FOCAL_SHARE = 0.6;  // only bother when the focal is tall...
export const CF_MIN_REPLY_SHARE = 0.5;  // ...and replies get under half the viewport
export const CF_HEADER_PX = 53;         // X's sticky in-column title bar
export const CF_SCROLL_GUARD_PX = 40;   // skip if the user already scrolled

let timers = [];
let stopInput = null;
let armed = null; // { statusId, rich, genAlive }

export const commentsFirstArmed = () => Boolean(armed);

function clearTimers() {
  for (const t of timers) clearTimeout(t);
  timers = [];
}

export function cancelCommentsFirst(reason = "cancelled") {
  const was = Boolean(armed);
  armed = null;
  clearTimers();
  if (stopInput) { stopInput(); stopInput = null; }
  return was;
}

function userScrolled() {
  return window.scrollY > CF_SCROLL_GUARD_PX;
}

// rich: the extraction-time rich flags of the focal post ({video, poll, card, article}).
// genAlive: liveness probe from the reader lifecycle (generation + route check).
export function armCommentsFirst(statusId, rich, genAlive) {
  cancelCommentsFirst("re-arm");
  if (!statusId || !genAlive) return false;
  // Option C gate: only posts the left pane fully duplicates go comments-first.
  if (rich?.video || rich?.poll || rich?.card || rich?.article) {
    diagnostics.recordCommentsFirst({ statusId, applied: false, why: "rich-native-kept" });
    return false;
  }
  armed = { statusId, rich, genAlive };
  stopInput = watchUserInput(() => {
    diagnostics.recordCommentsFirst({ statusId, applied: false, why: "user-input" });
    cancelCommentsFirst("user-input");
  });
  const deadline = Date.now() + CF_WAIT_MAX_MS;
  const step = () => {
    if (!armed) return;
    if (!armed.genAlive() || statusIdFromPath() !== armed.statusId) {
      cancelCommentsFirst("route-moved");
      return;
    }
    if (Date.now() > deadline) {
      diagnostics.recordCommentsFirst({ statusId: armed.statusId, applied: false, why: "no-reply-in-window" });
      cancelCommentsFirst("window-expired");
      return;
    }
    if (userScrolled()) {
      diagnostics.recordCommentsFirst({ statusId: armed.statusId, applied: false, why: "user-scrolled" });
      cancelCommentsFirst("user-scrolled");
      return;
    }
    const focal = focalCellByStatusId(armed.statusId);
    if (!focal) { timers.push(setTimeout(step, CF_POLL_MS)); return; }
    const reply = nextCellAfter(focal);
    if (!reply) { timers.push(setTimeout(step, CF_POLL_MS)); return; }
    const vh = window.innerHeight || 0;
    const focalH = focal.getBoundingClientRect().height;
    const replyTop = reply.getBoundingClientRect().top;
    const replyShare = vh ? (vh - Math.max(replyTop, 0)) / vh : 1;
    if (!vh || focalH < vh * CF_MAX_FOCAL_SHARE || replyShare >= CF_MIN_REPLY_SHARE) {
      // duplication is minor (short focal) or replies already own the screen —
      // keep native layout
      diagnostics.recordCommentsFirst({ statusId: armed.statusId, applied: false, why: "focal-small" });
      cancelCommentsFirst("focal-small");
      return;
    }
    const target = Math.max(0, Math.round(replyTop - CF_HEADER_PX + window.scrollY));
    try { window.scrollTo(0, target); } catch { /* keep native behavior */ }
    diagnostics.recordCommentsFirst({ statusId: armed.statusId, applied: true, target, focalH, vh });
    cancelCommentsFirst("applied");
  };
  timers.push(setTimeout(step, CF_POLL_MS));
  return true;
}

function nextCellAfter(focal) {
  const cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
  const idx = [...cells].indexOf(focal);
  return idx >= 0 ? cells[idx + 1] || null : null;
}

// One-shot user-input guard over the arming window (same semantics as the
// anchor restore: wheel / keys / pointer / touch all mean the user moved first).
function watchUserInput(onUserInput) {
  const opts = { capture: true, passive: true };
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
