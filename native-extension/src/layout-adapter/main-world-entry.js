// Peek M2-B1 — MAIN world entry for the layout adapter.
//
// Injected as a dedicated MAIN-world content script ONLY in the experimental
// build (manifest gains the entry at build time; the default M1-R manifest
// never references this file). Responsibilities are deliberately thin:
//   - idempotent install guard (double injection cannot double-bind),
//   - origin/source/type-validated message dispatch to adapter-core,
//   - forwarding core transitions (health-check exits) to the ISOLATED world.
// No eval, no CSP bypass, no dynamic code. The MAIN world holds no credentials
// and the adapter performs no network calls (contract §1/§2).

import {
  LAD_NS, LAD_FROM_ISOLATED, LAD_FROM_MAIN,
  LAD_INSTALL, LAD_UNINSTALL, LAD_QUERY,
  LAD_NATIVE_RELEASE, LAD_NATIVE_RELEASED, readNativeReleaseDetail,
  LAD_ACTIVE, LAD_UNSUPPORTED, LAD_ERROR, LAD_UNINSTALLED,
} from "./constants.js";
import * as core from "./adapter-core.js";

(() => {
  if (window.__peekLayoutAdapterMainInstalled) return;
  window.__peekLayoutAdapterMainInstalled = true;

  const pageOrigin = () => {
    try { return window.location.origin; } catch { return ""; }
  };

  const post = (payload, nonce) => {
    try { window.postMessage({ ns: LAD_NS, from: LAD_FROM_MAIN, nonce, ...payload }, pageOrigin()); }
    catch { /* a lost report must never break the adapter */ }
  };

  // health-check exits and re-installs surface here
  core.setNotifier((msg) => post(msg, null));

  // A left exit must restore CSS + native ownership + its sole scroll in one
  // call stack. The fixed DOM operation does not expose core/DOM references or
  // add a generic dispatcher. Other lifecycle commands keep the async wire.
  let releasing = false;
  document.addEventListener(LAD_NATIVE_RELEASE, event => {
    if (event.target !== document) return;
    const m = readNativeReleaseDetail(event.detail);
    if (!m) return;
    let status = "refused";
    const s = core.query();
    if (!releasing && s.phase === "active" && s.gen === m.gen && s.focusUrlId === m.focusUrlId && location.pathname === m.pathname) {
      releasing = true;
      try {
        const result = core.uninstall({ reason: "native-view", focusUrlId: m.focusUrlId });
        status = result.type === LAD_UNINSTALLED && result.note !== "focus-mismatch-ignored" && result.note !== "not-active" ? "released" : "error";
      } catch { status = "error"; }
      finally { releasing = false; }
    }
    try { document.dispatchEvent(new window.CustomEvent(LAD_NATIVE_RELEASED, { detail: JSON.stringify({ ...m, status }) })); }
    catch { /* absent/broken receiver: fail closed, never post a fallback */ }
  });

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.origin !== pageOrigin()) return;
    const m = event.data;
    if (!m || typeof m !== "object" || m.ns !== LAD_NS || m.from !== LAD_FROM_ISOLATED) return;
    switch (m.type) {
      case LAD_INSTALL:
        // reqNonce records the correlation of the request that created this
        // installation session; autonomous HEALTH_* notifications carry it
        // back alongside the session generation (P0-A)
        post(core.install({
          focusUrlId: typeof m.focusUrlId === "string" ? m.focusUrlId : "",
          reqNonce: typeof m.nonce === "number" ? m.nonce : null,
        }), m.nonce);
        break;
      case LAD_UNINSTALL:
        // The single missing-sync-result cleanup is generation-scoped so its
        // async delivery cannot release a newer install on the same focus.
        if (Object.hasOwn(m, "gen") && (!Number.isSafeInteger(m.gen) || m.gen <= 0 || core.query().gen !== m.gen || core.query().focusUrlId !== m.focusUrlId)) {
          post({ type: LAD_UNINSTALLED, note: "generation-mismatch-ignored", restored: false }, m.nonce);
          break;
        }
        // focusUrlId scopes the release to the session it names — a stale
        // release can never tear down a newer session's wrap (P0-A)
        post(core.uninstall({
          reason: typeof m.reason === "string" ? m.reason : "requested",
          focusUrlId: typeof m.focusUrlId === "string" ? m.focusUrlId : undefined,
        }), m.nonce);
        break;
      case LAD_QUERY:
        post({ type: "STATE", state: core.query() }, m.nonce);
        break;
      default:
        break; // unknown types are ignored, never replayed
    }
  });

  // offline/CDP harness hook (never armed in production) — the same pattern as
  // the M1 content script's __peekNativeTest
  if (window.__PEEK_NATIVE_TEST__) {
    window.__peekLayoutAdapterTest = {
      install: core.install,
      uninstall: core.uninstall,
      query: core.query,
      healthTick: core.healthTick,
      verifyArticleBinding: core.verifyArticleBinding, // P1-B direct drive
    };
  }
})();
