// R3-R live network census payload (A2/A3) — run via:
//   PEEK_REPO_ROOT must be set (run.sh sets it):
//   exploration-poc/r3/run.sh exploration-poc/r3-r/harness/census-run.mjs
//
// Fair-comparison design (A3):
//  - ONE logged-in ego-browser session, TWO fresh pages: native (no PoC) and
//    r1 (PoC registered isolated-world). Conditions are interleaved per
//    scenario so both sides see the same session/cache evolution.
//  - Scenarios per round: first-nav (fresh document navigation to the sample
//    detail URL), revisit (same detail URL again — warm cache), spa (author
//    profile → click the sample's status link → same-document navigation).
//    NOTE: no cache is ever cleared; the about:blank hop is a fresh document,
//    NOT a cold cache (A3 explicitly warns against calling it one).
//  - Two rounds. Small n: no p95 is computed anywhere.
//  - Sanitization: per-request records keep only {cat, op, method, rel(ms)};
//    classify() parses the pathname and never persists URLs, query strings,
//    headers, or bodies. See ../network-recompute.mjs for the recomputation.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = "__PEEK_REPO_ROOT__"; // substituted by run.sh (ego env does not inherit shell vars)
if (ROOT.startsWith("__")) throw new Error("run this payload via exploration-poc/r3/run.sh");
const { recordsFromEvents, summarize, SAMPLE_URL, SAMPLE_AUTHOR_URL } =
  await import(`${ROOT}/exploration-poc/r3/network-census.mjs`);

const OUT_DIR = join(ROOT, "exploration-poc", "r3-r", "evidence", "network");
mkdirSync(OUT_DIR, { recursive: true });

const SAMPLE_ID = SAMPLE_URL.match(/\/status\/(\d+)/)[1];
const ROUNDS = 2;
const SETTLE_MS = 7000;

// `task` comes from the prelude (task space 14); this payload adds two fresh pages
const nativePage = await task.newPage();
const r1Page = await task.newPage();

// register the PoC (isolated world) on the r1 page only
{
  const readFile = (await import("node:fs/promises")).readFile;
  const css = await readFile(`${ROOT}/exploration-poc/mv3-poc/content.css`, "utf8");
  const js = await readFile(`${ROOT}/exploration-poc/mv3-poc/content.js`, "utf8");
  const cssJson = JSON.stringify(css);
  const bootstrap = `(function(){function inject(){if(document.querySelector("style[data-peek-poc-css]"))return;var s=document.createElement("style");s.setAttribute("data-peek-poc-css","1");s.textContent=${cssJson};(document.head||document.documentElement||document).appendChild(s);}if(document.head||document.documentElement){inject();}else{document.addEventListener("DOMContentLoaded",inject,{once:true});}})();\n`;
  await r1Page.cdp("Page.addScriptToEvaluateOnNewDocument", {
    source: bootstrap + js,
    worldName: "peek-poc-r3-r",
    runImmediately: true,
  });
}
for (const p of [nativePage, r1Page]) await p.cdp("Network.enable");

const paneBuilt = (page) =>
  page.evaluate(() => Boolean(document.getElementById("peek-poc-pane")));

// SPA scenario target: the first timeline timestamp link on the author profile.
// Both conditions run the same session minutes apart, so the profile timeline
// (and thus the clicked post) is expected to match; the clicked path is
// recorded in meta for transparency.
const clickFirstStatusLink = (page) =>
  page.evaluate(() => {
    const a = [...document.querySelectorAll('a[href*="/status/"]')]
      .find((el) => el.querySelector("time") && !el.closest('[data-testid="card.wrapper"]'));
    if (!a) return null;
    a.click();
    return new URL(a.href).pathname;
  });

async function save(condition, scenario, round, requests, extraMeta = {}) {
  const summary = summarize(requests);
  const file = join(OUT_DIR, `${condition}-${scenario}-r${round}.json`);
  const record = {
    meta: {
      tool: "exploration-poc/r3/network-census.mjs (R3-R fixed classifier)",
      recordedAt: new Date().toISOString(),
      session: "ego-browser logged-in shared session (task space 14)",
      sample: `x.com/gefei55/status/${SAMPLE_ID} (public post)`,
      scenario, round, condition,
      sanitized: "no URLs, no query strings, no headers, no bodies, no credentials",
      ...extraMeta,
    },
    summary: { apiTotal: summary.apiTotal, graphqlTotal: summary.graphqlTotal, restTotal: summary.restTotal, categories: summary.categories, byOp: summary.byOp },
    requests: summary.requests,
  };
  writeFileSync(file, JSON.stringify(record, null, 2));
  console.log(`${file}  api=${summary.apiTotal} (gql=${summary.graphqlTotal} rest=${summary.restTotal})${extraMeta.paneBuilt !== undefined ? ` pane=${extraMeta.paneBuilt}` : ""}${extraMeta.spaNavigated !== undefined ? ` spaNav=${extraMeta.spaNavigated}` : ""}`);
}

async function runScenario(page, condition, scenario, round) {
  if (scenario === "first-nav") {
    await page.goto("about:blank");
    await page.goto(SAMPLE_URL);
    await page.waitForTimeout(SETTLE_MS);
    const extra = condition === "r1" ? { paneBuilt: await paneBuilt(page) } : {};
    await save(condition, scenario, round, recordsFromEvents(await page.events()), extra);
  } else if (scenario === "revisit") {
    await page.goto(SAMPLE_URL);
    await page.waitForTimeout(SETTLE_MS);
    const extra = condition === "r1" ? { paneBuilt: await paneBuilt(page) } : {};
    await save(condition, scenario, round, recordsFromEvents(await page.events()), extra);
  } else {
    await page.goto(SAMPLE_AUTHOR_URL);
    await page.waitForTimeout(6000);
    await page.events(); // drain the profile-load window; the SPA window starts at the click
    const clickedPath = await clickFirstStatusLink(page);
    if (!clickedPath) {
      await save(condition, scenario, round, [], { skipped: "no status link found on profile timeline" });
      return;
    }
    await page.waitForTimeout(SETTLE_MS);
    const extra = { clickedPath, spaNavigated: (await page.url()).includes("/status/") };
    if (condition === "r1") extra.paneBuilt = await paneBuilt(page);
    await save(condition, scenario, round, recordsFromEvents(await page.events()), extra);
  }
}

for (let round = 1; round <= ROUNDS; round++) {
  for (const scenario of ["first-nav", "revisit", "spa"]) {
    await runScenario(nativePage, "native", scenario, round);
    await runScenario(r1Page, "r1", scenario, round);
  }
}

console.log("census complete:", OUT_DIR);
