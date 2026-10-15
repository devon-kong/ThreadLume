// Shared artifact-identity prologue for Peek Native measurement builds (L4).
//
// The real extension runs in an ISOLATED world: page-side measurement code
// (page.evaluate in the MAIN world) can never read window.__peekNativeTest,
// so the perf harness would misidentify a correctly-loaded real extension.
// Test builds therefore stamp a NON-SENSITIVE, read-only build-identity
// marker into the shared DOM (<html data-peek-artifact="…">): a build id and
// a mode label, written when the content script evaluates.
//   - No credentials, tokens, or page content — only this build's identity.
//   - A SECOND Peek build injecting into the same document appends to the
//     value (array form): the harness reads a conflict and refuses to sample,
//     so two implementations can never be measured as one.
//   - The marker is diagnostic bookkeeping, never an authentication token:
//     a page script can trivially rewrite it, so nothing security-relevant
//     may ever gate on it.
// Only the unified product build carries the prologue (it replaced the lab
// build in the S3 unification and is always a recognizable measurement
// target); the build script prepends it before any bundle code runs.
import { createHash } from "node:crypto";

// Build id: mode tag + build timestamp + content hash of the exact bundle
// being stamped, so two builds of the same source still get distinct ids.
export function buildIdFor(mode, bundledContentJs) {
  const hash = createHash("sha256").update(bundledContentJs).digest("hex").slice(0, 10);
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12); // YYYYMMDDHHMM
  return `${mode}-${stamp}-${hash}`;
}

// The exact prologue text prepended to content.js, kept as one string so the
// build script emits it byte-identically for the same { buildId, mode }.
export function artifactPrologue(buildId, mode) {
  const payload = JSON.stringify({ build: buildId, mode });
  return `// Peek artifact diagnostics (test builds only): non-sensitive build identity
// stamped into the shared DOM for the measurement harness (ISOLATED-world JS
// is unreadable from the page). Bookkeeping only — never an auth token.
(function () {
  try {
    var el = document.documentElement;
    if (!el) return;
    var mark = ${payload};
    var prev = el.getAttribute("data-peek-artifact");
    if (!prev) { el.setAttribute("data-peek-artifact", JSON.stringify(mark)); return; }
    var list = null;
    try { list = JSON.parse(prev); } catch (e) { list = null; }
    if (!Array.isArray(list)) list = [list];
    list.push(mark);
    el.setAttribute("data-peek-artifact", JSON.stringify(list));
  } catch (e) { /* diagnostics must never break the page */ }
})();
`;
}

// Reader-side parse of the marker (mirrored minimally inside the perf
// harness's in-page monitor; this is the reference implementation tests use).
export function parseArtifactAttr(raw) {
  if (raw == null) return { present: false, marks: [], conflict: false };
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { present: true, marks: [], conflict: true, malformed: true }; }
  if (Array.isArray(parsed)) {
    return { present: true, marks: parsed.filter((m) => m && typeof m === "object"), conflict: true };
  }
  if (!parsed || typeof parsed !== "object") return { present: true, marks: [], conflict: true, malformed: true };
  return { present: true, marks: [parsed], conflict: false };
}
