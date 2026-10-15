// Peek Native — isolated-world content script for x.com / twitter.com.
//
// Product contract highlights (unchanged from R4):
//  - zero internal-API calls: no fetch/XHR use, no GraphQL, no webpack probing,
//    no credential capture, no hidden data reading, no synthetic account writes;
//  - X's own detail page IS the reader's right column — Peek adds a left
//    reading pane extracted from the DOM X itself renders;
//  - the close decision consults real session history and never jumps off-site;
//  - Esc closes like the ✕ button, except while typing or inside X's own modals.
//
// M1 engineering notes: logic lives in src/*.js modules (route observation,
// navigation session, extraction, view, lifecycle, interaction, anchor
// restore, theme, diagnostics). This entry wires them and owns the install
// guard. All module top-level code is state-only; the guard below runs before
// any listener is registered, so a double injection cannot double-bind.

import { NS, PANE_ID, statusIdFromPath, isDetailPath } from "./constants.js";
import { initNavigationSession } from "./navigation-session.js";
import { startRouteObservation, checkRoute, setInitialStatusId } from "./route-observer.js";
import {
  buildReader, removeReader, closeReader, currentGen
} from "./reader-lifecycle.js";
import {
  parseCount, fallbackText, countOf, photoUrlsIn, findQuoteNode,
  extractArticle, extractFromArticle, extractFocal, focalCellByStatusId
} from "./focal-extractor.js";
import { updatePaneInPlace, syncRichNote } from "./reader-view.js";
import { readTheme } from "./theme-adapter.js";
import { onAction } from "./native-interaction.js";
import {
  capturePreOpen, onReturnToList, cancelRestore, preOpenAnchor,
  computeAnchorAdjustment, restoreActive
} from "./anchor-restore.js";
import * as diagnostics from "./diagnostics.js";
import {
  safeBackTarget, navTrailState, NAV_API, syncTrailFromLocation, recordNav
} from "./navigation-session.js";
// Native layout adapter (MAIN-world controller side; the adapter define is
// always on in the unified build)
import {
  adapterEnabled, initLayoutAdapter, sessionSnapshot, onDetailRoute, offRoute,
  themeDiagnostics
} from "./layout-adapter/controller.js";
// M2-B2-A instant reading preview (unified build always wires it)
import {
  previewSnapshot, clearPreview, captureClickForPreview,
  previewOnRouteChange, previewAdapterHandoff, previewAdapterStopped
} from "./preview-layer.js";

(() => {
  if (window.__peekNativeInstalled) return; // extension-reload idempotency
  window.__peekNativeInstalled = true;

  initNavigationSession();
  startRouteObservation();
  initLayoutAdapter(); // registers the MAIN-world message bridge

  if (isDetailPath()) {
    setInitialStatusId(statusIdFromPath());
    buildReader();
  }

  // Esc closes the reader like the ✕ button. Guarded: when the user is typing
  // in the native composer or any editable target, Esc belongs to X.
  // CAPTURE phase: X's own global shortcut manager handles/stops Escape on the
  // page — a bubble-phase listener never sees those events. Capture on window
  // runs before page handlers can swallow the key.
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !document.getElementById(PANE_ID)) return;
    // an X-owned modal (photo lightbox, sheet dialog, native menus) has first
    // claim on Escape — closing the reader under it would also steal the key
    if (document.querySelector('[data-testid="lightbox"], [data-testid="sheetDialog"], [data-testid="HoverCard"], [role="dialog"][aria-modal="true"]')) return;
    const t = event.target;
    if (t && (t.isContentEditable || t.closest?.('[data-testid^="tweetTextarea"], [contenteditable="true"]'))) return;
    // we own this Escape: stop it so X's own shortcut manager cannot ALSO
    // navigate back (a real extension's capture listener preempts page
    // handlers — without this, one Esc would traverse two history entries)
    event.preventDefault();
    event.stopImmediatePropagation();
    closeReader();
  }, true);

  // test hook: lets the verification harness unit-test the real helpers through
  // CDP or the offline jsdom harness; never armed in production
  if (window.__PEEK_NATIVE_TEST__) {
    window.__peekNativeTest = {
      parseCount, readTheme, statusIdFromPath, fallbackText,
      countOf, photoUrlsIn, findQuoteNode, extractArticle, extractFromArticle,
      extractFocal, checkRoute, buildReader, removeReader, closeReader,
      syncRichNote, updatePaneInPlace, onAction, focalCellByStatusId,
      currentGen,
      // close/navigation observability (read-only)
      safeBackTarget, navTrailState, navApi: () => NAV_API, syncTrailFromLocation, recordNav,
      // B3 anchor restore
      capturePreOpen, onReturnToList, cancelRestore, preOpenAnchor,
      computeAnchorAdjustment, restoreActive,
      // diagnostics
      diag: diagnostics.snapshot,
      lastRouteChangeAt: () => diagnostics.lastRouteChangeAt(),
      // M2-B1 lab hook: drive/inspect the layout adapter session directly
      layoutAdapter: {
        enabled: adapterEnabled,
        onDetailRoute, offRoute, sessionSnapshot,
        init: initLayoutAdapter,
        themeDiagnostics // P1-C loop-freedom observability
      },
      // M2-B2-A preview hook: state machine observability + forced transitions
      preview: {
        snapshot: previewSnapshot,
        clear: () => clearPreview("test-clear"),
        captureClick: captureClickForPreview,
        onRouteChange: previewOnRouteChange,
        handoff: previewAdapterHandoff,
        stopped: previewAdapterStopped
      }
    };
  }
})();
