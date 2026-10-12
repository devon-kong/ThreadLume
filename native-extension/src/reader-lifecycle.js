// Peek Native — reader lifecycle (R4-verified semantics, engineered):
// generation-based cancellation, bounded build attempts, bounded recovery,
// navigation-first teardown, owned timers, idempotent mount, and the close
// decision that never gambles on unknown session history.
//
// Invariants enforced here:
//  - the left pane shows the post the URL points at, never a stale one;
//  - every async continuation re-verifies its generation and the route;
//  - teardown is synchronous and complete (pane, style, observers, timers);
//  - recovery never re-arms itself (a dead route goes fully dormant).

import {
  NS, PANE_ID, BUILD_POLL_MS, BUILD_MAX_ATTEMPTS,
  RECOVERY_MAX_ROUNDS, RECOVERY_DELAY_MS, RICH_SCAN_WINDOW_MS,
  HYDRATION_POLL_MS, HYDRATION_POLL_MAX, sleep, statusIdFromPath
} from "./constants.js";
import { safeBackTarget } from "./navigation-session.js";
import { extractFocal, extractFromArticle, focalCellByStatusId } from "./focal-extractor.js";
import { renderPane, updatePaneInPlace, setRichScanWindow, removePaneAndStyle } from "./reader-view.js";
import { watchTheme, unwatchTheme } from "./theme-adapter.js";
import { cancelRestore } from "./anchor-restore.js";
import { onAction, clearOwnedTimeouts } from "./native-interaction.js";
import * as diagnostics from "./diagnostics.js";

const BRAND_ICON_URL = () => {
  try { return globalThis.TuzaiBrandIconDataUrl || ""; } catch { return ""; }
};

const ACTION_NOTE = "左栏为 Peek 阅读副本（DOM 提取）；互动一律由你在右侧原生控件上亲自完成——上方按钮只负责定位并高亮对应原生控件，不会代替你点击，也不会构造任何账号写入。";

export const ACTION_NOTE_TEXT = ACTION_NOTE;

let gen = 0;          // generation: bumped on every build start and every teardown
let liveGen = 0;      // generation of the build loop currently awaiting the DOM (0 = none)
let recoveryArmed = false;
let recoveryLeft = 0;
let nextRecoveryAt = 0;

export const currentGen = () => gen;

// ---------- build (fast first paint → decoupled in-place upgrades) ----------

export async function buildReader() {
  const focalId = statusIdFromPath();
  if (!focalId) return;
  const myGen = ++gen;
  liveGen = myGen;
  const buildStartedAt = performance.now();
  try {
    let data = null;
    for (let attempt = 0; attempt < BUILD_MAX_ATTEMPTS && myGen === gen; attempt++) {
      if (statusIdFromPath() !== focalId) return; // route moved on — die now
      // Fast path: extract WITHOUT the show-more expansion so the first paint
      // carries the (accurate, collapsed) body X itself shows; the full text
      // upgrade follows decoupled below.
      data = await extractFocal(focalId, () => myGen === gen, { expand: false });
      if (data && data.statusId === focalId) break;
      data = null;
      await sleep(BUILD_POLL_MS);
    }
    if (myGen !== gen) return;             // superseded or torn down
    if (!data) {                            // same route, DOM never appeared
      armRecovery();
      return;
    }
    if (statusIdFromPath() !== focalId) return;     // re-verify before render
    if (document.getElementById(PANE_ID)) return;   // never double-mount
    renderPane(data, {
      brandIconUrl: BRAND_ICON_URL(),
      onAction,
      onClose: closeReader,
      actionNote: ACTION_NOTE
    });
    watchTheme();
    setRichScanWindow(RICH_SCAN_WINDOW_MS);
    recoveryArmed = false;
    recoveryLeft = 0;
    diagnostics.recordFirstPaint(performance.now(), performance.now() - buildStartedAt);
    // Decoupled upgrades. The first paint may come from the timeline's own
    // cell (instant, accurate for that render); two bounded, gen-guarded
    // refreshes then correct the pane in place — no remount, no flicker:
    //  (a) detail hydration: once the detail page's own focal cell replaces
    //      the timeline cell, refresh absolute time / exact counts / media;
    //  (b) show-more: expand once (like a reader) and swap in the full body.
    void hydrateFromDetail(focalId, myGen, data);
    if (data.showMorePending) void upgradeToFullText(focalId, myGen);
  } finally {
    if (liveGen === myGen) liveGen = 0; // a newer build owns the flag otherwise
  }
}

async function hydrateFromDetail(focalId, myGen, initialData) {
  for (let i = 0; i < HYDRATION_POLL_MAX && myGen === gen; i++) {
    await sleep(HYDRATION_POLL_MS);
    if (myGen !== gen || statusIdFromPath() !== focalId) return;
    const cell = focalCellByStatusId(focalId);
    if (cell && cell !== initialData.nativeCell && cell.isConnected) {
      const art = cell.querySelector("article[data-testid='tweet']") || cell.querySelector("article");
      if (art) {
        const fresh = extractFromArticle(art, focalId);
        const pane = document.getElementById(PANE_ID);
        if (pane && pane.dataset.statusId === focalId) {
          updatePaneInPlace(pane, fresh);
          diagnostics.recordHydrationRefresh(performance.now());
        }
      }
      return;
    }
  }
}

async function upgradeToFullText(focalId, myGen) {
  const full = await extractFocal(focalId, () => myGen === gen); // expands + guards gen/route
  if (!full || myGen !== gen || statusIdFromPath() !== focalId) return;
  const pane = document.getElementById(PANE_ID);
  if (pane && pane.dataset.statusId === focalId) {
    updatePaneInPlace(pane, full);
    // mark the body complete so a later hydration refresh carrying the
    // collapsed detail body cannot regress the pane (R4 review P2-1)
    const textEl = pane.querySelector(`.${NS}-text`);
    if (textEl) textEl.dataset.peekFullText = "1";
  }
}

// Bounded retry after a timed-out build, driven by the existing route tick.
// The budget is armed ONCE per route entry: recovery rounds that fail again
// do not re-arm it, so a dead route eventually goes fully dormant until the
// next navigation.
function armRecovery() {
  if (recoveryArmed) return;
  recoveryArmed = true;
  recoveryLeft = RECOVERY_MAX_ROUNDS;
  nextRecoveryAt = Date.now() + RECOVERY_DELAY_MS;
}

export function maybeRecover() {
  const id = statusIdFromPath();
  if (!id || liveGen || document.getElementById(PANE_ID)) return;
  if (recoveryLeft <= 0 || Date.now() < nextRecoveryAt) return;
  recoveryLeft--;
  buildReader();
}

export function resetRecovery() {
  recoveryArmed = false;
  recoveryLeft = 0;
  nextRecoveryAt = 0;
}

// ---------- close / teardown ----------

export function closeReader() {
  // Only follow the session history when the previous entry is known to be a
  // same-site X page; direct/external/refreshed entries are dismissed in place
  // instead of gambling on an unknown history target.
  if (window.__PEEK_NATIVE_TEST__) {
    try { document.documentElement.setAttribute("data-peek-close-decision", JSON.stringify(safeBackTarget())); } catch { /* probe only */ }
  }
  if (safeBackTarget().back) {
    history.back(); // previous entry is X's own view (list or previous post)
  } else {
    removeReader(); // dismiss the enhancement, stay on X
  }
}

export function removeReader() {
  ++gen;        // invalidate any in-flight build task immediately
  liveGen = 0;
  resetRecovery();
  cancelRestore("reader-removed");
  removePaneAndStyle();
  unwatchTheme();
  clearOwnedTimeouts();
}
