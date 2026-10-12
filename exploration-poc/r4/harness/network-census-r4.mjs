// R4 network census — strict-judge-compatible evidence with click-aligned SPA
// windows. Fixes the R3-R attribution gap: the spa window now drains to QUIET
// right before a trusted click, so every recorded request is post-click and
// the strict G0-C judge can attribute extras without guessing.
//   native: no PoC. r1: mv3-poc registered isolated-world.
// Scenarios × 2 rounds, interleaved per round. Sanitized records only
// ({cat, op, method, rel}); no URLs, headers, bodies or credentials.
// Run: exploration-poc/r3/run.sh exploration-poc/r4/harness/network-census-r4.mjs
const ROOT = "__PEEK_REPO_ROOT__";
if (ROOT.startsWith("__")) throw new Error("run via exploration-poc/r3/run.sh");
const { readFileSync, mkdirSync, writeFileSync, unlinkSync } = await import("node:fs");
const { join } = await import("node:path");
const { recordsFromEvents } = await import(`${ROOT}/exploration-poc/r3/network-census.mjs`);

const OUT_DIR = join(ROOT, "exploration-poc", "r4", "evidence", "network");
mkdirSync(OUT_DIR, { recursive: true });

const SAMPLE = { id: "2109450990575611958", author: "gefei55", profile: "https://x.com/gefei55" };
const DETAIL_URL = `https://x.com/${SAMPLE.author}/status/${SAMPLE.id}`;
const ROUNDS = 2;
const SETTLE_MS = 7000;
const VIEWPORT = { width: 1440, height: 900 };
const FIND_MAX_STEPS = 40;

// close leftovers from earlier runs (page budget)
const PAGES_FILE = `${ROOT}/exploration-poc/r4/harness/.pages-net.json`;
let stale = [];
try { stale = JSON.parse(readFileSync(PAGES_FILE, "utf8")); } catch { /* first run */ }
for (const n of [...stale, "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10", "p11", "p12", "p13", "p14"]) {
  try { await task.page(n).close(); } catch { /* absent */ }
}

const pages = {};
const created = [];
for (const cond of ["native", "r1"]) {
  const p = await task.newPage();
  created.push(p.label);
  await p.cdp("Emulation.setDeviceMetricsOverride", { ...VIEWPORT, deviceScaleFactor: 1, mobile: false });
  await p.cdp("Network.enable");
  if (cond === "r1") {
    const css = readFileSync(`${ROOT}/exploration-poc/mv3-poc/content.css`, "utf8");
    const js = readFileSync(`${ROOT}/exploration-poc/mv3-poc/content.js`, "utf8");
    const boot = `(function(){window.__PEEK_POC_TEST__=true;})();\n` +
      `(function(){function inj(){if(document.querySelector("style[data-peek-poc-css]"))return;var s=document.createElement("style");s.setAttribute("data-peek-poc-css","1");s.textContent=${JSON.stringify(css)};(document.head||document.documentElement||document).appendChild(s);}if(document.head||document.documentElement){inj();}else{document.addEventListener("DOMContentLoaded",inj,{once:true});}})();\n` + js;
    await p.cdp("Page.addScriptToEvaluateOnNewDocument", { source: boot, worldName: "peek-poc-r4net", runImmediately: true });
  }
  pages[cond] = p;
}
writeFileSync(PAGES_FILE, JSON.stringify(created));
try {
  const paneBuilt = (p) => p.cdp("Runtime.evaluate", { expression: `Boolean(document.getElementById("peek-poc-pane"))`, returnByValue: true });

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
          const a = [...cell.querySelectorAll('a[href*="/status/' + id + '"]')].find(x => x.querySelector("time"));
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
      meta: {
        tool: "exploration-poc/r4/harness/network-census-r4.mjs (click-aligned spa windows)",
        recordedAt: new Date().toISOString(),
        session: "ego-browser logged-in shared session (task space 14)",
        sample: `x.com/${SAMPLE.author}/status/${SAMPLE.id} (public post)`,
        scenario, round, condition: cond,
        sanitized: "no URLs, no query strings, no headers, no bodies, no credentials; spa windows are post-click only (quiet drain before a trusted CDP click)",
        ...extraMeta,
      },
      summary: { apiTotal: graphqlTotal + restTotal, graphqlTotal, restTotal, categories, byOp },
      requests,
    }, null, 1));
    console.log(`${file}  api=${graphqlTotal + restTotal} (gql=${graphqlTotal} rest=${restTotal})`);
  }

  async function runScenario(cond, scenario, round) {
    const p = pages[cond];
    await p.cdp("Page.bringToFront");
    if (scenario === "first-nav") {
      await p.goto("about:blank");
      await p.goto(DETAIL_URL);
      await p.waitForTimeout(SETTLE_MS);
      const extra = cond === "r1" ? { paneBuilt: (await paneBuilt(p)).result.value } : {};
      await save(cond, scenario, round, recordsFromEvents(await p.events()), extra);
    } else if (scenario === "revisit") {
      await p.goto(DETAIL_URL);
      await p.waitForTimeout(SETTLE_MS);
      const extra = cond === "r1" ? { paneBuilt: (await paneBuilt(p)).result.value } : {};
      await save(cond, scenario, round, recordsFromEvents(await p.events()), extra);
    } else {
      // spa: profile → find (scroll may fetch) → quiet drain → trusted click
      // → every recorded request is genuinely post-click
      await p.goto(SAMPLE.profile);
      await p.waitForTimeout(SETTLE_MS);
      const coords = await findSampleCell(p);
      if (!coords) {
        await save(cond, scenario, round, [], { skipped: "sample cell not found on profile" });
        return;
      }
      await quietThenDrain(p);
      await clickCoords(p, coords);
      await p.waitForTimeout(SETTLE_MS);
      const extra = { clickedPath: `/status/${SAMPLE.id} (from profile, trusted click)` };
      if (cond === "r1") extra.paneBuilt = (await paneBuilt(p)).result.value;
      await save(cond, scenario, round, recordsFromEvents(await p.events()), extra);
    }
  }

  for (let round = 1; round <= ROUNDS; round++) {
    for (const scenario of ["first-nav", "revisit", "spa"]) {
      await runScenario("native", scenario, round);
      await runScenario("r1", scenario, round);
    }
  }
  console.log("r4 network census complete:", OUT_DIR);
} finally {
  for (const l of created) { try { await task.page(l).close(); } catch { /* gone */ } }
  try { unlinkSync(PAGES_FILE); } catch {}
}
