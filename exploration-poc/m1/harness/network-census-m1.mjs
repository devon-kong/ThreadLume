// M1-D network census — strict-judge-compatible click-aligned evidence.
// Same method as R4 (spa windows drain to QUIET before the trusted click;
// first-nav = cold goto of the detail URL; revisit = same URL again on the
// same page). Conditions: native = bare X; r1 = the M1 Native build (isolated
// world inject, L3 equivalent). Sanitized records only ({cat, op, method, rel}).
// Evidence: exploration-poc/m1/evidence/network/{native|r1}-{scenario}-r{round}.json
// Judge: exploration-poc/r3-r/network-recompute.mjs (unchanged).
const ROOT = "/Users/devon/claude/peek-main";
const { readFileSync, mkdirSync, writeFileSync } = await import("node:fs");
const { join } = await import("node:path");
const { recordsFromEvents } = await import(`${ROOT}/exploration-poc/r3/network-census.mjs`);

const OUT_DIR = join(ROOT, "exploration-poc", "m1", "evidence", "network");
mkdirSync(OUT_DIR, { recursive: true });

const SAMPLE = { id: "2109450990575611958", author: "gefei55", profile: "https://x.com/gefei55" };
const DETAIL_URL = `https://x.com/${SAMPLE.author}/status/${SAMPLE.id}`;
const ROUNDS = 4;
const SETTLE_MS = 7000;
const VIEWPORT = { width: 1440, height: 900 };
const FIND_MAX_STEPS = 40;

const task = await taskSpace(16);
const pages = {};
for (const cond of ["native", "r1"]) {
  const p = await task.newPage();
  await p.cdp("Emulation.setDeviceMetricsOverride", { ...VIEWPORT, deviceScaleFactor: 1, mobile: false });
  await p.cdp("Network.enable");
  if (cond === "r1") {
    const H = await import(`${ROOT}/exploration-poc/m1/harness/m1-harness.mjs`);
    await H.registerNative(p);
  }
  pages[cond] = p;
}

async function quietThenDrain(p) {
  for (let i = 0; i < 6; i++) {
    const evts = await p.events();
    if (!evts.some((e) => e.method === "Network.requestWillBeSent")) return;
    await p.waitForTimeout(1200);
  }
  await p.events();
}

async function findSampleCell(p) {
  for (let step = 0; step < FIND_MAX_STEPS; step++) {
    const tgt = await p.cdp("Runtime.evaluate", { expression: `(() => {
      const id = ${JSON.stringify(SAMPLE.id)};
      for (const cell of document.querySelectorAll('[data-testid="cellInnerDiv"]')) {
        const a = [...cell.querySelectorAll('a[href*="/status/' + id + '"]')].find(x => x.querySelector("time") && !x.closest('div[role="link"]'));
        if (!a) continue;
        const r = a.getBoundingClientRect();
        if (r.y < 80 || r.y > innerHeight - 80) break;
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + Math.min(r.height, 300) / 2) };
      }
      return null;
    })()`, returnByValue: true });
    if (tgt.result.value) return tgt.result.value;
    await p.cdp("Runtime.evaluate", { expression: `scrollBy(0, 400)` });
    await p.waitForTimeout(650);
  }
  return null;
}

async function clickCoords(p, { x, y }) {
  await p.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await p.cdp("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await p.cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

async function save(cond, scenario, round, requests, extraMeta = {}) {
  const byOp = {};
  const categories = {};
  let graphqlTotal = 0, restTotal = 0;
  for (const r of requests) {
    const key = `${r.cat}:${r.op}`;
    byOp[key] = (byOp[key] || 0) + 1;
    categories[r.cat] = (categories[r.cat] || 0) + 1;
    if (r.cat === "graphql") graphqlTotal++;
    if (r.cat === "rest") restTotal++;
  }
  const file = join(OUT_DIR, `${cond}-${scenario}-r${round}.json`);
  writeFileSync(file, JSON.stringify({
    meta: { cond, scenario, round, sample: SAMPLE.id, ...extraMeta },
    summary: { total: requests.length, graphqlTotal, restTotal, categories, byOp },
    requests,
  }, null, 1));
  console.log(`saved ${cond}-${scenario}-r${round}: total=${requests.length} graphql=${graphqlTotal} rest=${restTotal}`);
}

// ---------- scenario runs ----------
for (let round = 1; round <= ROUNDS; round++) {
  // first-nav: cold navigation to the detail URL on each page
  for (const cond of ["native", "r1"]) {
    const p = pages[cond];
    await p.cdp("Page.bringToFront");
    await p.goto("about:blank");
    await p.waitForTimeout(1200);
    await p.events();
    await p.goto(DETAIL_URL);
    await p.waitForTimeout(SETTLE_MS + 6000);
    const evts = await p.events();
    const recs = recordsFromEvents(evts);
    await save(cond, "first-nav", round, recs, { paneBuilt: cond === "r1" ? Boolean((await p.cdp("Runtime.evaluate", { expression: `Boolean(document.getElementById("peek-native-pane"))`, returnByValue: true })).result.value) : undefined });
  }
  // revisit: goto the same URL again on the now-warm page
  for (const cond of ["native", "r1"]) {
    const p = pages[cond];
    await p.cdp("Page.bringToFront");
    await p.events();
    await p.goto(DETAIL_URL);
    await p.waitForTimeout(SETTLE_MS + 6000);
    const evts = await p.events();
    const recs = recordsFromEvents(evts);
    await save(cond, "revisit", round, recs);
  }
  // spa: profile → quiet → trusted click → post-click traffic only
  for (const cond of ["native", "r1"]) {
    const p = pages[cond];
    await p.cdp("Page.bringToFront");
    await p.goto(SAMPLE.profile);
    await p.waitForTimeout(SETTLE_MS);
    const coords = await findSampleCell(p);
    if (!coords) {
      await p.events();
      console.log(`SKIP ${cond} spa r${round}: cell not found`);
      await save(cond, "spa", round, [], { skipped: "cell not found" });
      continue;
    }
    await quietThenDrain(p);
    await clickCoords(p, coords);
    await p.waitForTimeout(SETTLE_MS + 6000);
    const evts = await p.events();
    const recs = recordsFromEvents(evts);
    await save(cond, "spa", round, recs);
  }
}
console.log("DONE census");
