// Peek M2-B1(-R) — ISOLATED world controller for the experimental native layout
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
//
// M2-B1-R changes:
//   P0-A  message contract split. Request responses (ACTIVE/UNSUPPORTED/
//         ERROR/UNINSTALLED/STATE) correlate via the request nonce as before.
//         Autonomous notifications (HEALTH_ERROR/HEALTH_UNINSTALLED/
//         HEALTH_ACTIVE) are a separate family: they fire with NO request in
//         flight and are validated against the session triple { gen,
//         focusUrlId } plus the phase — a stale or foreign notification can
//         never flip this controller's state, and an old session's event can
//         never disturb a newer session. On HEALTH_ERROR (MAIN self-exited)
//         the split CSS is removed in the same tick the message arrives.
//         Correlation is NOT treated as authentication: same-origin page
//         scripts can observe or fake these messages (they only ever shape the
//         page they already own). Two hardening measures beyond matching:
//         ACTIVE is honored only if the focal article marker is actually
//         present in the DOM, and UNINSTALL commands carry the focus they
//         name so a stale release cannot clobber a newer session's wrap.
//   P1-C  the theme observer can no longer feed itself: own writes are
//         suppressed for the delivery turn that echoes them, identical values
//         are never re-written, and cleanup restores the exact pre-adapter
//         inline variable values and priorities (not just the <style> tag).

import {
  LAD_NS, LAD_FROM_ISOLATED, LAD_FROM_MAIN,
  LAD_INSTALL, LAD_UNINSTALL,
  LAD_ACTIVE, LAD_UNSUPPORTED, LAD_ERROR, LAD_UNINSTALLED,
  LAD_HEALTH_ERROR, LAD_HEALTH_UNINSTALLED, LAD_HEALTH_ACTIVE,
  LAD_MARK_ARTICLE,
  LAD_INSTALL_ACK_MS, LAD_INSTALL_RETRY_MS, LAD_INSTALL_MAX_ATTEMPTS,
} from "./constants.js";
import { readTheme } from "../theme-adapter.js";
import { focalCellByStatusId } from "../focal-extractor.js";

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
// { focusUrlId, phase, attempts, everActive, nonce, gen, ackTimer, retryTimer, failReason }
let session = null;
let nonceSeq = 0;
let themeObserver = null;
// P1-C theme bookkeeping
const THEME_VARS = ["--peek-lad-bg", "--peek-lad-border", "--peek-lad-top"];
let savedInlineVars = null;   // Map var → { value, priority } captured pre-adapter
let themeSelfWrite = false;   // our own write is being echoed back to the observer
export const themeStats = { callbacks: 0, writes: 0, skippedWrites: 0, selfEchoDrops: 0 };

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
    everActive: false, nonce: null, gen: null, ackTimer: 0, retryTimer: 0, failReason: null,
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

// ---------- message dispatch (P0-A) ----------

const RESPONSE_TYPES = new Set([LAD_ACTIVE, LAD_UNSUPPORTED, LAD_ERROR, LAD_UNINSTALLED]);
const AUTONOMOUS_TYPES = new Set([LAD_HEALTH_ERROR, LAD_HEALTH_UNINSTALLED, LAD_HEALTH_ACTIVE]);

function handleMainMessage(m) {
  if (AUTONOMOUS_TYPES.has(m.type)) { handleAutonomous(m); return; }
  if (!RESPONSE_TYPES.has(m.type)) return; // unknown types are ignored, never replayed
  handleResponse(m);
}

function handleResponse(m) {
  const s = session;
  if (!s || m.nonce !== s.nonce) return; // stale or foreign response
  if (m.type === LAD_ACTIVE) {
    if (s.phase !== "installing") {
      // late ACTIVE after this session already failed — MAIN may hold a wrap
      // with no controller behind it: order it released, stay dormant
      sendToMain({ type: LAD_UNINSTALL, nonce: ++nonceSeq, reason: "late-active-after-fail", focusUrlId: s.focusUrlId });
      return;
    }
    clearTimeout(s.ackTimer);
    s.gen = typeof m.gen === "number" ? m.gen : null;
    // P0-A integrity: MAIN marks the focal article BEFORE answering ACTIVE.
    // Trust the state change only if the marker is really there, in the cell
    // the focus resolves to — otherwise mounting the split CSS would shift
    // every cell right with nothing pinned (and a same-origin spoof would
    // produce exactly that). Correlation is bookkeeping, not authentication.
    if (!focalMarkerVerified(s.focusUrlId)) {
      sendToMain({ type: LAD_UNINSTALL, nonce: ++nonceSeq, reason: "active-without-focal-marker", focusUrlId: s.focusUrlId });
      failSession(s, "active-without-focal-marker");
      return;
    }
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
    // a request-level failure (e.g. residue-locked refusal, uninstall-failed
    // during internal reinstall) — tear the layout down, go dormant
    if (session !== s) return;
    failSession(s, m.reason || "main-error");
    return;
  }
  // UNINSTALLED / STATE: acks only — teardown already ran locally
}

function handleAutonomous(m) {
  const s = session;
  // Session correlation (P0-A): the notification must name the session this
  // controller currently holds — same focus identity and same install
  // generation. Anything else is cross-talk from an older page state.
  // Correlation is bookkeeping, not authentication (same-origin scripts can
  // fake any message; the harm is bounded to the page they already own).
  const ours = s && m.focusUrlId === s.focusUrlId &&
    typeof m.gen === "number" && m.gen === s.gen;
  // Gen continuation: an internal re-install is the SAME installation session
  // continuing on a new virtualizer instance. MAIN reports it as
  // HEALTH_ACTIVE carrying a newer generation — accept it while we are active
  // for the same focus and adopt the new gen, so the continued session's later
  // notifications (HEALTH_ERROR included) are never orphaned. Belt and braces
  // for the gen-continuity invariant on the MAIN side.
  const continuation = !ours && s && s.phase === "active" && s.everActive &&
    m.type === LAD_HEALTH_ACTIVE && m.focusUrlId === s.focusUrlId &&
    typeof m.gen === "number" && m.gen > s.gen;
  if (continuation) { s.gen = m.gen; }
  if (!ours && !continuation) {
    // A wrap whose session we no longer hold must be released — but never by
    // clobbering a live ACTIVE session (its own health tick owns it). The
    // UNINSTALL names its focus so MAIN can refuse a mismatched release; the
    // focus must be a real string (a spoofed notification without one must
    // not turn into an unqualified release command).
    if ((!s || s.phase !== "active") && typeof m.focusUrlId === "string" && m.focusUrlId) {
      sendToMain({ type: LAD_UNINSTALL, nonce: ++nonceSeq, reason: "stale-health-event", focusUrlId: m.focusUrlId });
    }
    return;
  }
  switch (m.type) {
    case LAD_HEALTH_ERROR:
      // MAIN self-exited (shape drift, retention loss, restore failure): it
      // already restored the wrapped method — remove the split CSS in the
      // same tick and go dormant. This is the fix for the P0: this message
      // must never be dropped for nonce mismatch.
      if (s.phase === "active") failSession(s, m.reason || "main-health-error");
      else if (s.phase === "installing") failSession(s, m.reason || "main-health-error");
      // phase failed/dormant: teardown already ran; the event is a confirmation
      break;
    case LAD_HEALTH_UNINSTALLED:
      // clean self-detected route exit on the MAIN side — no failure, just
      // release the layout and wait for the controller's own route events
      if (s.phase === "active" || s.phase === "installing") dormantSession(s, m.reason || "main-self-uninstalled");
      break;
    case LAD_HEALTH_ACTIVE:
      // internal re-install succeeded (instance replaced underneath us):
      // bookkeeping already matches; keep the session alive as-is
      if (s.phase === "active") setStateAttr("active");
      break;
    default:
      break;
  }
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

function dormantSession(s, reason) {
  // a clean MAIN-side exit (route self-detection) — same cleanup, no failure
  if (session !== s) return;
  clearTimeout(s.ackTimer);
  clearTimeout(s.retryTimer);
  s.phase = "dormant";
  session = s;
  removeLayout();
  setStateAttr("idle");
}

function teardownSession(reason) {
  const s = session;
  if (!s) return;
  session = null;
  clearTimeout(s.ackTimer);
  clearTimeout(s.retryTimer);
  removeLayout();
  // fire-and-forget: MAIN releases any wrap from every phase (installing
  // included — the wrap may have landed after our last status check). The
  // command names its focus so a stale release can never clobber a newer
  // session's wrap (P0-A).
  sendToMain({ type: LAD_UNINSTALL, nonce: ++nonceSeq, reason, focusUrlId: s.focusUrlId });
}

function focalMarkerVerified(focusUrlId) {
  try {
    const cell = focalCellByStatusId(focusUrlId);
    return Boolean(cell?.isConnected && cell.querySelector(`article[${LAD_MARK_ARTICLE}]`));
  } catch { return false; }
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
  restoreInlineVars();
}

// ---------- P1-C: theme mirroring without feedback loops ----------

function captureInlineVars() {
  if (savedInlineVars) return;
  savedInlineVars = new Map();
  const root = document.documentElement;
  for (const name of THEME_VARS) {
    try {
      savedInlineVars.set(name, {
        value: root.style.getPropertyValue(name),
        priority: root.style.getPropertyPriority(name),
      });
    } catch { savedInlineVars.set(name, { value: "", priority: "" }); }
  }
}

function restoreInlineVars() {
  if (!savedInlineVars) return;
  const root = document.documentElement;
  for (const [name, saved] of savedInlineVars) {
    try {
      if (saved.value) root.style.setProperty(name, saved.value, saved.priority);
      else root.style.removeProperty(name);
    } catch { /* styleless document — nothing to restore */ }
  }
  savedInlineVars = null;
}

function writeRootVar(root, name, value) {
  try {
    if (root.style.getPropertyValue(name) === value) {
      themeStats.skippedWrites++; // identical value: no DOM write, no echo, no loop
      return;
    }
    themeSelfWrite = true; // the observer will see exactly this echo and drop it
    themeStats.writes++;
    root.style.setProperty(name, value);
  } catch { /* no inline style support — CSS fallbacks cover the pane */ }
}

function applyAdapterTheme() {
  const theme = readTheme();
  const root = document.documentElement;
  captureInlineVars(); // first write captures the pre-adapter state (values + priorities)
  if (theme === "dark") {
    writeRootVar(root, "--peek-lad-bg", "#000000");
    writeRootVar(root, "--peek-lad-border", "#2f3336");
  } else {
    writeRootVar(root, "--peek-lad-bg", "#ffffff");
    writeRootVar(root, "--peek-lad-border", "#eff3f4");
  }
  // X's own banner height varies slightly by build; measure it, fall back to 54px
  let top = 54;
  try {
    const h = document.querySelector('header[role="banner"]')?.getBoundingClientRect().height;
    if (Number.isFinite(h) && h >= 40 && h <= 80) top = Math.round(h);
  } catch { /* keep the fallback */ }
  writeRootVar(root, "--peek-lad-top", `${top}px`);
}

function watchTheme() {
  unwatchTheme();
  themeObserver = new MutationObserver(() => {
    themeStats.callbacks++;
    // P1-C: our own writes are dropped — they changed nothing X cares about,
    // and re-applying them is the seed of the setProperty → mutation →
    // setProperty loop. The value-diff guard alone already terminates any
    // chain; the flag removes even the single redundant pass.
    if (themeSelfWrite) { themeSelfWrite = false; themeStats.selfEchoDrops++; return; }
    applyAdapterTheme();
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
  if (document.body) themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
}

function unwatchTheme() {
  themeObserver?.disconnect();
  themeObserver = null;
  themeSelfWrite = false;
}

function setStateAttr(state) {
  try { document.documentElement.setAttribute(STATE_ATTR, state); } catch { /* probe only */ }
}

// ---------- diagnostics ----------

// P1-C observability for the offline harness: loop-freedom is proven by
// counting observer callbacks against actual style writes (tests read this
// through the built artifact's test hook).
export function themeDiagnostics() {
  return {
    ...themeStats,
    watching: Boolean(themeObserver),
    inlineVars: (() => {
      try {
        const root = document.documentElement;
        return Object.fromEntries(THEME_VARS.map((n) => [n, root.style.getPropertyValue(n)]));
      } catch { return {}; }
    })(),
  };
}

export function sessionSnapshot() {
  return session
    ? {
      focusUrlId: session.focusUrlId, phase: session.phase, attempts: session.attempts,
      everActive: session.everActive, gen: session.gen, failReason: session.failReason,
    }
    : null;
}
