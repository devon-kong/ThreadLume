// L4-S2A test — the harness clock must run AHEAD of the extension's own
// capture handler, or t1a silently hides every millisecond the extension
// spends extracting and mounting (the exact bug this round fixes).
//
// Reproduction: an extension-like capture listener on `document` performs a
// deliberate 50 ms synchronous stall, then mounts the preview overlay. A
// monitor that registers its own click listener LATER on the SAME node
// (document, capture) fires only AFTER the stall — its t0 is late and the
// stall vanishes from the measurement. Registering the monitor's click
// listener on `window` (capture) — a strictly earlier node in the propagation
// path, whatever the registration order — puts t0 before the extension's
// document-capture work, and the stall shows up in full.
//
// This pins the ordering the real perf harness relies on (window-capture t0)
// and the offline-delay validation required by the L4 plan (S2-A).
import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const STALL_MS = 50;

function setup() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://x.com/home" });
  const { window } = dom;
  const doc = window.document;
  const state = { stallMs: STALL_MS, mountedAt: null, captureAt: null };

  // extension-like document-capture click handler (registered FIRST, like the
  // content script, which is present before any harness instrumentation):
  // stall synchronously, then mount the preview overlay.
  doc.addEventListener("click", () => {
    state.captureAt = performance.now();
    const until = performance.now() + state.stallMs;
    while (performance.now() < until) { /* controlled stall */ }
    const overlay = doc.createElement("div");
    overlay.id = "peek-lad-preview";
    overlay.dataset.statusId = "123";
    overlay.textContent = "preview body content";
    doc.body.appendChild(overlay);
    state.mountedAt = performance.now();
  }, { capture: true });

  const click = () => {
    doc.body.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  };
  return { window, doc, state, click };
}

// The measurement shape the harness uses: capture t0 in the monitor's click
// listener, then poll for a valid preview. The point under test is t0, not
// the sampler.
async function measure(setupResult, monitorTarget) {
  const { doc, window, state, click } = setupResult;
  let t0 = null;
  let t1a = null;
  const onMonitorClick = () => {
    if (t0 !== null) return;
    t0 = performance.now();
    const poll = () => {
      const el = doc.getElementById("peek-lad-preview");
      if (el && el.dataset.statusId === "123" && el.textContent.trim().length > 8) {
        t1a = performance.now() - t0;
        return;
      }
      setImmediate(poll);
    };
    setImmediate(poll);
  };
  const target = monitorTarget === "window" ? window : doc;
  target.addEventListener("click", onMonitorClick, { capture: true });
  click();
  for (let i = 0; i < 200 && t1a === null; i++) await new Promise((r) => setTimeout(r, 5));
  return { t0, t1a, captureAt: state.captureAt, mountedAt: state.mountedAt };
}

test("C1: a document-capture monitor registered after the extension handler hides the stall", async () => {
  const r = await measure(setup(), "document");
  assert.ok(r.t1a !== null, "preview detected");
  // the monitor's t0 is recorded after the 50 ms stall → the measured preview
  // latency no longer contains it (this is the bug, asserted as reproduced)
  assert.ok(r.t1a < STALL_MS, `measured ${r.t1a?.toFixed(1)}ms must be < ${STALL_MS}ms (bug reproduced)`);
});

test("C2: a window-capture monitor records t0 before the extension's document handler", async () => {
  const r = await measure(setup(), "window");
  assert.ok(r.t1a !== null, "preview detected");
  assert.ok(r.t1a >= STALL_MS - 2, `measured ${r.t1a?.toFixed(1)}ms must include the ${STALL_MS}ms stall`);
  // ordering proof: t0 (window capture) precedes the extension's own capture
  // stamp (document capture) — the harness clock is strictly earlier
  assert.ok(r.t0 <= r.captureAt + 1, "window-capture t0 must not lag the extension handler start");
});

test("C3: the stall lands between the extension capture stamp and the mount stamp", async () => {
  const r = await measure(setup(), "window");
  assert.ok(r.mountedAt - r.captureAt >= STALL_MS - 2,
    `extraction window ${(r.mountedAt - r.captureAt).toFixed(1)}ms must contain the ${STALL_MS}ms stall`);
});
