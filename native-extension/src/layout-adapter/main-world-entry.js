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

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.origin !== pageOrigin()) return;
    const m = event.data;
    if (!m || typeof m !== "object" || m.ns !== LAD_NS || m.from !== LAD_FROM_ISOLATED) return;
    switch (m.type) {
      case LAD_INSTALL:
        post(core.install({ focusUrlId: typeof m.focusUrlId === "string" ? m.focusUrlId : "" }), m.nonce);
        break;
      case LAD_UNINSTALL:
        post(core.uninstall({ reason: typeof m.reason === "string" ? m.reason : "requested" }), m.nonce);
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
    };
  }
})();
