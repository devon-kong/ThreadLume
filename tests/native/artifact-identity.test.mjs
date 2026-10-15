// L4-S1 tests — build-identity diagnostics for REAL-extension measurement.
//
// The perf harness runs in the page's MAIN world and can never read the
// extension's ISOLATED-world test hook (window.__peekNativeTest). Real builds
// are therefore identified through a non-sensitive build-identity marker the
// test build stamps into the shared DOM (<html data-peek-artifact>):
//   - exactly one object marker when a single Peek build runs,
//   - an array marker (conflict) when a second Peek build injects too,
//   - absent for "no extension" (native) sampling.
// These tests pin the prologue semantics AND the built artifacts' identity:
// the unified build (S3) always carries its marker (mode m2a) — the
// "pristine default carrier" rule retired together with the M1 carrier.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import {
  artifactPrologue, buildIdFor, parseArtifactAttr,
} from "../../scripts/artifact-prologue.mjs";
import { NATIVE_DIST, NATIVE_LAB_DIST } from "./native-env.mjs";
import { join } from "node:path";

const readLab = () => readFileSync(join(NATIVE_LAB_DIST, "content.js"), "utf8");
const readDefault = () => readFileSync(join(NATIVE_DIST, "content.js"), "utf8");

function stampDom() {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const el = dom.window.document.documentElement;
  const stamp = (text) => new Function("document", text)(dom.window.document);
  return { el, stamp };
}

test("P1: prologue writes a single-object marker (one Peek build on the page)", () => {
  const { el, stamp } = stampDom();
  stamp(artifactPrologue("m2a-202610141200-abcdef1234", "m2a"));
  const parsed = parseArtifactAttr(el.getAttribute("data-peek-artifact"));
  assert.equal(parsed.present, true);
  assert.equal(parsed.conflict, false);
  assert.equal(parsed.marks.length, 1);
  assert.equal(parsed.marks[0].mode, "m2a");
  assert.equal(parsed.marks[0].build, "m2a-202610141200-abcdef1234");
});

test("P2: a second Peek build appends to the marker — conflict, harness must refuse", () => {
  const { el, stamp } = stampDom();
  stamp(artifactPrologue("m2a-202610141200-abcdef1234", "m2a"));
  stamp(artifactPrologue("b1r-202610141201-1234567890", "b1r"));
  const parsed = parseArtifactAttr(el.getAttribute("data-peek-artifact"));
  assert.equal(parsed.present, true);
  assert.equal(parsed.conflict, true);
  assert.equal(parsed.marks.length, 2);
  assert.deepEqual(parsed.marks.map((m) => m.mode).sort(), ["b1r", "m2a"]);
});

test("P3: malformed marker reads as a conflict, never as a valid identity", () => {
  assert.equal(parseArtifactAttr("garbage{{{").conflict, true);
  assert.equal(parseArtifactAttr("null").conflict, true);
  assert.deepEqual(parseArtifactAttr(null), { present: false, marks: [], conflict: false });
});

test("P4: prologue is inert before <html> exists (document_start safety)", () => {
  const fn = new Function("document", artifactPrologue("m1r-x", "m1r"));
  assert.doesNotThrow(() => fn({ documentElement: null }));
  assert.doesNotThrow(() => fn({ documentElement: { getAttribute: () => { throw new Error("boom"); } } }));
});

test("P5: buildIdFor is unique per bundle bytes and stable per call site", () => {
  const a = buildIdFor("m2a", "bundle-bytes-v1");
  const b = buildIdFor("m2a", "bundle-bytes-v1");
  const c = buildIdFor("m2a", "bundle-bytes-v2");
  const d = buildIdFor("b1r", "bundle-bytes-v1");
  assert.equal(a, b, "same bytes → same id within the same minute");
  assert.notEqual(a, c, "different bytes → different id");
  assert.notEqual(a, d, "different mode → different id");
  assert.match(a, /^m2a-\d{12}-[0-9a-f]{10}$/);
});

test("P6: the built LAB artifact carries its identity marker (mode m2a)", () => {
  const src = readLab();
  assert.ok(src.includes("data-peek-artifact"), "lab content.js must stamp the marker");
  const match = src.match(/var mark = (\{[^}]+\});/);
  assert.ok(match, "marker payload literal present");
  const payload = JSON.parse(match[1]);
  assert.equal(payload.mode, "m2a");
  assert.match(payload.build, /^m2a-\d{12}-[0-9a-f]{10}$/);
});

test("P7: the unified DEFAULT build carries its identity marker (single-artifact rule)", () => {
  const src = readDefault();
  // S3 unification: there is no pristine carrier anymore. The one default
  // build is the measurement-recognizable build (former lab contract). Pinned
  // via BOTH historical path constants so reintroducing a second, unstamped
  // default artifact would fail here.
  assert.ok(src.includes("data-peek-artifact"), "default build must stamp the marker");
  const match = src.match(/var mark = (\{[^}]+\});/);
  assert.ok(match, "marker payload literal present");
  assert.equal(JSON.parse(match[1]).mode, "m2a");
});

test("P8: the diag define is always inlined, never left as a runtime identifier", () => {
  const src = readDefault();
  // esbuild inlines `__PEEK_DIAG_STAMPS__` (always "true" in the unified
  // build); what must never survive is the bare identifier (a runtime
  // ReferenceError risk).
  assert.ok(!/if\s*\(\s*__PEEK_DIAG_STAMPS__/.test(src), "define must be inlined, not left as an identifier");
});
