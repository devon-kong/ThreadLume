// L4-S1 — real-browser build-identity verification for the currently loaded
// artifact. Run with globalThis.__EXPECT__ = "m2a" | "b1r" | "m1r" | "native".
//
// Verifies, against the LIVE extension in the real browser (not the offline
// harness):
//   V1  the shared-DOM marker exists, is a single object, and its mode equals
//       the expected mode (native: marker must be ABSENT);
//   V2  the marker survives a page refresh;
//   V3  the marker survives an extension reload + page refresh (the runbook
//       reloads via chrome://extensions between V2 and V3 when RELOAD=1);
//   V4  the harness semantics REFUSE a wrong-mode round (arm the monitor with
//       a different expected mode → artifactOk false, sample would be skipped);
//   V5  only ONE Peek implementation runs (single-object marker, and the page
//       shows exactly one set of peek artifacts);
//   V6  manifest cross-check input: the chrome://extensions display name is
//       captured by the runbook separately (the page cannot read it); this
//       script records the marker's build id so the runbook can join them.
//
// Results append to identity-results.json in this directory.
const EXPECT = typeof __EXPECT__ !== "undefined" ? __EXPECT__
  : (typeof process !== "undefined" && process.env?.EXPECT) || "UNSET";
const DO_RELOAD = typeof __RELOAD__ !== "undefined" && __RELOAD__ === "1";
if (!["native", "m1r", "b1r", "m2a"].includes(EXPECT)) throw new Error("bad EXPECT");
const task = await taskSpace("peek l4 identity " + EXPECT);
const page = task.page("p1");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const readMarker = () => page.evaluate(`(() => {
  const raw = document.documentElement.getAttribute("data-peek-artifact");
  const attrs = [...document.documentElement.attributes].filter(a => a.name.startsWith("data-peek")).map(a => a.name);
  const overlays = document.querySelectorAll("#peek-lad-preview, #peek-native-pane, article[data-peek-lad-focal]").length;
  let parsed = null, conflict = false;
  if (raw) { try { parsed = JSON.parse(raw); } catch { parsed = null; conflict = true; } if (Array.isArray(parsed)) conflict = true; }
  return { raw, parsed, conflict, attrs, overlays, mode: parsed && !Array.isArray(parsed) ? parsed.mode : null, build: parsed && !Array.isArray(parsed) ? parsed.build : null };
})()`);

// V4 harness semantics (same function as the perf monitor's artifactOk)
const harnessVerdict = (expect) => page.evaluate(`(() => {
  const raw = document.documentElement.getAttribute("data-peek-artifact");
  const info = (() => {
    if (!raw) return { present: false, mode: null, conflict: false };
    let p; try { p = JSON.parse(raw); } catch { return { present: true, mode: null, conflict: true }; }
    if (Array.isArray(p)) return { present: true, mode: null, conflict: true };
    return { present: true, mode: p.mode || null, conflict: false };
  })();
  const ok = ${JSON.stringify(expect)} === "native"
    ? !info.present && !info.conflict
    : info.present && !info.conflict && info.mode === ${JSON.stringify(expect)};
  return { info, ok, expect: ${JSON.stringify(expect)} };
})()`);

const out = { expect: EXPECT, reloaded: DO_RELOAD, checks: {}, env: await page.evaluate(() => ({ url: location.href, chrome: navigator.userAgent })) };

// ---- navigate to a detail page through a real click where possible; a plain
// ---- goto is enough for identity (the marker is written at injection time).
await page.goto("https://x.com/home");
await page.waitForTimeout(4000);
const v1 = await readMarker();
out.checks.v1_marker = {
  pass: EXPECT === "native" ? !v1.raw : Boolean(v1.raw && !v1.conflict && v1.mode === EXPECT),
  marker: v1,
};

// V4 wrong-mode refusal: arm the harness semantics with a mismatched mode
out.checks.v4_wrongModeRefused = { pass: !(await harnessVerdict(EXPECT === "m2a" ? "b1r" : "m2a")).ok };

// V2 refresh persistence
await page.reload();
await page.waitForTimeout(4000);
const v2 = await readMarker();
out.checks.v2_afterRefresh = {
  pass: EXPECT === "native" ? !v2.raw : Boolean(v2.raw && !v2.conflict && v2.mode === EXPECT),
  marker: v2,
};

// V3 extension reload + refresh (RELOAD=1: the runbook pressed the chrome://extensions
// Reload button between V2 and V3; here we only verify the fresh injection)
if (DO_RELOAD) {
  await page.reload();
  await page.waitForTimeout(4000);
}
const v3 = await readMarker();
out.checks.v3_afterExtensionReload = {
  pass: EXPECT === "native" ? !v3.raw : Boolean(v3.raw && !v3.conflict && v3.mode === EXPECT),
  marker: v3,
  reloadPressedBefore: DO_RELOAD,
};

// V5 single implementation: no conflict + at most one peek root in the DOM
out.checks.v5_singleImplementation = {
  pass: !v3.conflict && v3.overlays <= 1,
  overlays: v3.overlays,
};

out.checks.buildId = v3.build ?? null;

import { writeFileSync } from "node:fs";
const path = "/Users/devon/claude/peek-main/docs/m2-b2-a-l4/evidence/identity-results.json";
let log = {};
try { log = JSON.parse(await import("node:fs").then((m) => m.readFileSync(path, "utf8"))); } catch { log = { runs: [] }; }
log.runs.push(out);
writeFileSync(path, JSON.stringify(log, null, 1));
const allPass = Object.values(out.checks).every((c) => {
  if (!c || typeof c !== "object") return true; // buildId and other scalars are not gates
  return c.pass !== false;
});
console.log(JSON.stringify({ expect: EXPECT, allPass, checks: Object.fromEntries(Object.entries(out.checks).map(([k, v]) => [k, v && typeof v === "object" ? v.pass : v])) }));
