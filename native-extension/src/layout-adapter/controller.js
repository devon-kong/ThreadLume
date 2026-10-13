// Peek M2-B1 — ISOLATED world controller for the experimental native layout
// adapter. Contract: docs/m2-b1/adapter-contract.md.
//
// Responsibilities: drive INSTALL/UNINSTALL per detail route, mount/remove the
// split layout CSS only while the MAIN-world adapter is ACTIVE, mirror the
// theme onto a few CSS variables, and fall back CLOSED — any failure leaves X's
// own single-column detail page untouched. It never silently re-enables the M1
// reading copy, never retries past its bounded budget, and never mutates
// body/html overflow (X's virtual scroll position must survive).
//
// The whole module is inert unless the build-time experimental flag
// __PEEK_LAYOUT_ADAPTER__ is true (default build: every entry point no-ops).

import {
  LAD_NS, LAD_FROM_ISOLATED, LAD_FROM_MAIN,
  LAD_INSTALL, LAD_UNINSTALL,
  LAD_ACTIVE, LAD_UNSUPPORTED, LAD_ERROR,
  LAD_INSTALL_ACK_MS, LAD_INSTALL_RETRY_MS, LAD_INSTALL_MAX_ATTEMPTS,
} from "./constants.js";
import { readTheme } from "../theme-adapter.js";

/* eslint-disable no-undef */ // __PEEK_LAYOUT_ADAPTER__ is an esbuild define
export const adapterEnabled = () => __PEEK_LAYOUT_ADAPTER__ === true;

const STYLE_ID = "peek-lad-style";
const HTML_ATTR = "data-peek-lad";
const STATE_ATTR = "data-peek-lad-state";
const FAILED_ATTR = "data-peek-lad-failed";

// Functional split layout (S3): native focal article pinned left with its own
// scroll, X's own conversation list on the right. Below 980px viewport width
// every rule deactivates and the page is X's native single column — the
// retention wrap alone is harmless there.
const LAYOUT_CSS = `
@media (min-width: 980px) {
  html[${HTML_ATTR}="on"] [data-testid="sidebarColumn"] { display: none !important; }
  /* X's banner element IS the left nav rail on current builds — hiding it is
     what keeps the fixed focal pane clean (z-order beats the pane otherwise) */
  html[${HTML_ATTR}="on"] header[role="banner"] { display: none !important; }
  html[${HTML_ATTR}="on"] [data-testid="primaryColumn"] { width: 100vw !important; max-width: 100vw !important; }
  html[${HTML_ATTR}="on"] [data-testid="cellInnerDiv"] { margin-left: 52vw !important; width: 48vw !important; }
  html[${HTML_ATTR}="on"] [data-testid="cellInnerDiv"]:has(article[data-peek-lad-focal]) { transform: none !important; }
  html[${HTML_ATTR}="on"] article[data-peek-lad-focal] {
    position: fixed !important;
    left: 0 !important;
    top: var(--peek-lad-top, 54px) !important;
    bottom: 0 !important;
    width: 52vw !important;
    box-sizing: border-box !important;
    overflow-y: auto !important;
    overscroll-behavior: contain !important;
    z-index: 59 !important;
    background: var(--peek-lad-bg, #ffffff) !important;
    border-right: 1px solid var(--peek-lad-border, #eff3f4) !important;
  }
}`;

let initialized = false;
let session = null; // { focusUrlId, phase, attempts, everActive, nonce, ackTimer, retryTimer, failReason }
let nonceSeq = 0;
let themeObserver = null;

// ---------- init / messaging ----------

export function initLayoutAdapter() {
  if (!adapterEnabled() || initialized) return;
  initialized = true;
  window.addEventListener("message", onWindowMessage);
  setStateAttr("idle");
}

const pageOrigin = () => {
  try { return window.location.origin; } catch { return ""; }
};

function sendToMain(payload) {
  try { window.postMessage({ ns: LAD_NS, from: LAD_FROM_ISOLATED, ...payload }, pageOrigin()); }
  catch { /* lost command → the ack timeout path handles it */ }
}

function onWindowMessage(event) {
  if (event.source !== window) return;
  if (event.origin !== pageOrigin()) return;
  const m = event.data;
  if (!m || typeof m !== "object" || m.ns !== LAD_NS || m.from !== LAD_FROM_MAIN) return;
  handleMainMessage(m);
}

// ---------- route-driven session lifecycle (driven via reader-lifecycle) ----------

export function onDetailRoute(focalId) {
  if (!adapterEnabled() || !focalId) return;
  if (session && session.focusUrlId === focalId &&
      (session.phase === "active" || session.phase === "installing")) {
    return; // idempotent re-entry (route ticks, re-observation)
  }
  teardownSession("superseded");
  session = {
    focusUrlId: focalId, phase: "installing", attempts: 0,
    everActive: false, nonce: null, ackTimer: 0, retryTimer: 0, failReason: null,
  };
  setStateAttr("installing");
  attemptInstall();
}

export function offRoute() {
  if (!adapterEnabled() || !session) return;
  teardownSession("route-left");
  setStateAttr("idle");
}

function attemptInstall() {
  const s = session;
  if (!s || s.phase !== "installing") return;
  s.attempts++;
  const nonce = ++nonceSeq;
  s.nonce = nonce;
  sendToMain({ type: LAD_INSTALL, focusUrlId: s.focusUrlId, nonce });
  clearTimeout(s.ackTimer);
  s.ackTimer = setTimeout(() => onAckTimeout(s, nonce), LAD_INSTALL_ACK_MS);
}

function onAckTimeout(s, nonce) {
  if (session !== s || s.nonce !== nonce || s.phase !== "installing") return;
  // The MAIN world script is absent or unresponsive (older Chrome without
  // manifest "world": "MAIN", injection lost). Retrying cannot help — the
  // experimental layout must fail closed to X's native single column.
  failSession(s, "main-unresponsive");
}

function handleMainMessage(m) {
  const s = session;
  if (!s || m.nonce !== s.nonce) return; // stale or foreign response
  if (m.type === LAD_ACTIVE) {
    if (s.phase !== "installing") {
      // late ACTIVE after this session already failed — MAIN may hold a wrap
      // with no controller behind it: order it released, stay dormant
      sendToMain({ type: LAD_UNINSTALL, nonce: ++nonceSeq, reason: "late-active-after-fail" });
      return;
    }
    clearTimeout(s.ackTimer);
    s.phase = "active";
    s.everActive = true;
    setStateAttr("active");
    mountLayout();
    return;
  }
  if (m.type === LAD_UNSUPPORTED) {
    if (s.phase !== "installing") return;
    clearTimeout(s.ackTimer);
    if (s.attempts < LAD_INSTALL_MAX_ATTEMPTS) {
      // page not ready yet (focal cell / virtualizer not rendered) — bounded retry
      clearTimeout(s.retryTimer);
      s.retryTimer = setTimeout(attemptInstall, LAD_INSTALL_RETRY_MS);
    } else {
      failSession(s, m.reason || "unsupported");
    }
    return;
  }
  if (m.type === LAD_ERROR) {
    // MAIN self-exited (shape drift, retention loss) — it already restored
    // the wrapped method; tear the layout down and go dormant
    if (session !== s) return;
    failSession(s, m.reason || "main-error");
    return;
  }
  // UNINSTALLED / STATE: acks only — teardown already ran locally
}

function failSession(s, reason) {
  if (session !== s) return;
  clearTimeout(s.ackTimer);
  clearTimeout(s.retryTimer);
  s.phase = "failed";
  s.failReason = reason;
  session = s; // keep the failed session: dormancy + diagnostics until the route changes
  removeLayout();
  setStateAttr("failed");
  try { document.documentElement.setAttribute(FAILED_ATTR, reason); } catch { /* probe only */ }
  // honest, explicit report — never fake a recovery (contract §6/§9)
  console.warn(`[Peek M2-B1] 布局适配不可用，已回退 X 原生单栏详情页（原因: ${reason}）。刷新页面可重置实验状态。`);
}

function teardownSession(reason) {
  const s = session;
  if (!s) return;
  session = null;
  clearTimeout(s.ackTimer);
  clearTimeout(s.retryTimer);
  removeLayout();
  // fire-and-forget: MAIN releases any wrap from every phase (installing
  // included — the wrap may have landed after our last status check)
  sendToMain({ type: LAD_UNINSTALL, nonce: ++nonceSeq, reason });
}

// ---------- layout mounting ----------

function mountLayout() {
  removeLayout();
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = LAYOUT_CSS;
  document.head.appendChild(style);
  document.documentElement.setAttribute(HTML_ATTR, "on");
  applyAdapterTheme();
  watchTheme();
}

function removeLayout() {
  document.getElementById(STYLE_ID)?.remove();
  document.documentElement.removeAttribute(HTML_ATTR);
  unwatchTheme();
}

function applyAdapterTheme() {
  const theme = readTheme();
  const root = document.documentElement;
  if (theme === "dark") {
    root.style.setProperty("--peek-lad-bg", "#000000");
    root.style.setProperty("--peek-lad-border", "#2f3336");
  } else {
    root.style.setProperty("--peek-lad-bg", "#ffffff");
    root.style.setProperty("--peek-lad-border", "#eff3f4");
  }
  // X's own banner height varies slightly by build; measure it, fall back to 54px
  let top = 54;
  try {
    const h = document.querySelector('header[role="banner"]')?.getBoundingClientRect().height;
    if (Number.isFinite(h) && h >= 40 && h <= 80) top = Math.round(h);
  } catch { /* keep the fallback */ }
  root.style.setProperty("--peek-lad-top", `${top}px`);
}

function watchTheme() {
  unwatchTheme();
  themeObserver = new MutationObserver(() => applyAdapterTheme());
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
  if (document.body) themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
}

function unwatchTheme() {
  themeObserver?.disconnect();
  themeObserver = null;
}

function setStateAttr(state) {
  try { document.documentElement.setAttribute(STATE_ATTR, state); } catch { /* probe only */ }
}

// ---------- diagnostics ----------

export function sessionSnapshot() {
  return session
    ? {
      focusUrlId: session.focusUrlId, phase: session.phase, attempts: session.attempts,
      everActive: session.everActive, failReason: session.failReason,
    }
    : null;
}
