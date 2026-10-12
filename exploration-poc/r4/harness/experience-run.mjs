// R4 G3 experience harness — scripted reading-flow equivalence sequences for
// A (original Peek) and B (R1 PoC) with DOM probes and screenshots at the
// moments a user would perceive (open, first content, close, post-close).
// No writes; scrolling/reading only.
// Run: exploration-poc/r3/run.sh exploration-poc/r4/harness/experience-run.mjs
const ROOT = "__PEEK_REPO_ROOT__";
if (ROOT.startsWith("__")) throw new Error("run via exploration-poc/r3/run.sh");
const { readFileSync, mkdirSync, writeFileSync, unlinkSync } = await import("node:fs");
const { join } = await import("node:path");

const OUT = join(ROOT, "exploration-poc", "r4", "evidence", "experience");
mkdirSync(OUT, { recursive: true });

// E3 uses one author's recent posts as A→B→C (deterministic from the profile).
const PROFILE = "https://x.com/gefei55";
const VIEWPORT = { width: 1440, height: 900 };

const PAGES_FILE = `${ROOT}/exploration-poc/r4/harness/.pages-exp.json`;
let stale = [];
try { stale = JSON.parse(readFileSync(PAGES_FILE, "utf8")); } catch { /* first run */ }
for (const n of [...stale, "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10", "p11", "p12", "p13", "p14"]) {
  try { await task.page(n).close(); } catch { /* absent */ }
}

const pages = {};
const created = [];
for (const cond of ["orig", "r1"]) {
  const p = await task.newPage();
  created.push(p.label);
  await p.cdp("Emulation.setDeviceMetricsOverride", { ...VIEWPORT, deviceScaleFactor: 1, mobile: false });
  await p.cdp("Network.enable");
  if (cond === "orig") {
    const bridge = readFileSync(`${ROOT}/dist-extension/page-bridge.js`, "utf8");
    await p.cdp("Page.addScriptToEvaluateOnNewDocument", { source: bridge, runImmediately: true });
    const css = readFileSync(`${ROOT}/dist-extension/content.css`, "utf8");
    const cssBoot = `(function(){function inj(){if(document.querySelector("style[data-tuzai-css]"))return;var s=document.createElement("style");s.setAttribute("data-tuzai-css","1");s.textContent=${JSON.stringify(css)};(document.head||document.documentElement||document).appendChild(s);}if(document.head||document.documentElement){inj();}else{document.addEventListener("DOMContentLoaded",inj,{once:true});}})();\n`;
    let iso = cssBoot;
    for (const f of ["vendor/phosphor/icons.js", "vendor/brand/icon.js", "vendor/hls/hls.min.js", "core.js", "content.js"]) {
      iso += (readFileSync(`${ROOT}/dist-extension/${f}`, "utf8")) + "\n;\n";
    }
    await p.cdp("Page.addScriptToEvaluateOnNewDocument", { source: iso, worldName: "peek-r4-orig", runImmediately: true });
  } else {
    const css = readFileSync(`${ROOT}/exploration-poc/mv3-poc/content.css`, "utf8");
    const js = readFileSync(`${ROOT}/exploration-poc/mv3-poc/content.js`, "utf8");
    const boot = `(function(){function inj(){if(document.querySelector("style[data-peek-poc-css]"))return;var s=document.createElement("style");s.setAttribute("data-peek-poc-css","1");s.textContent=${JSON.stringify(css)};(document.head||document.documentElement||document).appendChild(s);}if(document.head||document.documentElement){inj();}else{document.addEventListener("DOMContentLoaded",inj,{once:true});}})();\n` + js;
    await p.cdp("Page.addScriptToEvaluateOnNewDocument", { source: boot, worldName: "peek-poc-r4exp", runImmediately: true });
  }
  pages[cond] = p;
}
writeFileSync(PAGES_FILE, JSON.stringify(created));

const evalMain = (p, expression, opts = {}) => p.cdp("Runtime.evaluate", { expression, returnByValue: true, ...opts });

async function shot(p, name) {
  const r = await p.cdp("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.data, "base64"));
}

async function pressEsc(p) {
  await p.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await p.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
}

// generic DOM probe of the reading state
const PROBE = `(() => {
  const root = document.getElementById('tuzai-x-popover-root');
  const pane = document.getElementById('peek-poc-pane');
  const cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
  const focalArt = document.querySelector('[data-testid="primaryColumn"] article[data-testid="tweet"]');
  return {
    path: location.pathname,
    historyLen: history.length,
    overlayOpen: Boolean(root),
    paneOpen: Boolean(pane),
    paneStatusId: pane?.dataset.statusId || null,
    paneTextHead: pane ? (pane.querySelector('.peek-poc-text')?.innerText || '').slice(0, 40) : null,
    overlayHead: root ? (root.innerText || '').slice(0, 60).replace(/\\n/g, '|') : null,
    cellCount: cells.length,
    focalText: (focalArt?.querySelector('[data-testid="tweetText"]')?.innerText || '').slice(0, 40),
    scrollY: Math.round(scrollY),
  };
})()`;
const probe = (p) => evalMain(p, PROBE).then((r) => r.result.value);

async function waitFor(pred, p, timeoutMs = 12000, pollMs = 150) {
  const t0 = Date.now();
  for (;;) {
    const v = await pred(p);
    if (v) return true;
    if (Date.now() - t0 > timeoutMs) return false;
    await p.waitForTimeout(pollMs);
  }
}

async function findCell(p, statusId) {
  for (let step = 0; step < 40; step++) {
    const tgt = await evalMain(p, `(() => {
      const id = ${JSON.stringify(statusId)};
      for (const cell of document.querySelectorAll('[data-testid="cellInnerDiv"]')) {
        const a = [...cell.querySelectorAll('a[href*="/status/' + id + '"]')].find(x => x.querySelector("time"));
        if (!a) continue;
        const r = a.getBoundingClientRect();
        if (r.y < 80 || r.y > innerHeight - 80) break;
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + Math.min(r.height, 300) / 2) };
      }
      return null;
    })()`);
    if (tgt.result.value) return tgt.result.value;
    await evalMain(p, `scrollBy(0, 400)`);
    await p.waitForTimeout(650);
  }
  return null;
}

async function trustClick(p, { x, y }) {
  await p.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await p.cdp("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await p.cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

// surface-ready predicate per condition (orig: overlay text non-loading;
// r1: pane built for the URL's post)
const ready = (cond) => async (p) => (await probe(p))[cond === "orig" ? "overlayOpen" : "paneOpen"];
const readyWithContent = (cond) => async (p) => {
  const v = await probe(p);
  if (cond === "orig") return v.overlayOpen && v.overlayHead && !v.overlayHead.includes("正在加载");
  return v.paneOpen && v.paneStatusId === (v.path.match(/status\/(\d+)/) || [])[1];
};

const log = [];
const record = (scenario, cond, step, data) => {
  log.push({ scenario, cond, step, ...data });
  console.log(`${scenario}/${cond}/${step}: ${JSON.stringify(data)}`);
};

async function runScenario(cond, scenario, fn) {
  try {
    await fn(pages[cond], (step, data) => record(scenario, cond, step, data));
  } catch (e) {
    record(scenario, cond, "ERROR", { message: e.message });
  }
}

// ---------- E3: consecutive A→B→C from one profile, close level by level ----------
async function e3(p, rec) {
  await p.cdp("Page.bringToFront");
  await p.goto(PROFILE);
  await p.waitForTimeout(7000);
  // collect the first three distinct status ids on the profile
  const ids = [];
  for (let step = 0; step < 30 && ids.length < 3; step++) {
    const found = await evalMain(p, `(() => {
      const out = [];
      for (const cell of document.querySelectorAll('[data-testid="cellInnerDiv"]')) {
        const a = [...cell.querySelectorAll('a[href*="/status/"]')].find(x => x.querySelector("time"));
        if (!a) continue;
        const id = (a.getAttribute("href").match(/status\\/(\\d+)/) || [])[1];
        if (id) out.push(id);
      }
      return [...new Set(out)].slice(0, 3);
    })()`);
    for (const id of found.result.value || []) if (!ids.includes(id)) ids.push(id);
    if (ids.length < 3) { await evalMain(p, `scrollBy(0, 500)`); await p.waitForTimeout(700); }
  }
  rec("ids", { ids });
  if (ids.length < 3) { rec("skip", { reason: "not enough posts" }); return; }

  // A
  const tA = await findCell(p, ids[0]);
  if (!tA) { rec("skip", { reason: "A not found" }); return; }
  await trustClick(p, tA);
  await waitFor(readyWithContent(cond === "orig" ? "orig" : "r1"), p);
  rec("open-A", await probe(p));
  await shot(p, `e3-${cond}-A`);
  // B (click another post visible on the detail page? — detail pages of A may
  // not show B; instead go BACK to the profile then open B — this models the
  // common "read, close, read next" loop)
  await pressEsc(p);
  await p.waitForTimeout(2500);
  rec("back-from-A", await probe(p));
  const tB = await findCell(p, ids[1]);
  if (!tB) { rec("skip", { reason: "B not found" }); return; }
  await trustClick(p, tB);
  await waitFor(readyWithContent(cond === "orig" ? "orig" : "r1"), p);
  rec("open-B", await probe(p));
  await pressEsc(p);
  await p.waitForTimeout(2500);
  rec("back-from-B", await probe(p));
  const tC = await findCell(p, ids[2]);
  if (!tC) { rec("skip", { reason: "C not found" }); return; }
  await trustClick(p, tC);
  await waitFor(readyWithContent(cond === "orig" ? "orig" : "r1"), p);
  rec("open-C", await probe(p));
  await pressEsc(p);
  await p.waitForTimeout(2500);
  rec("back-from-C", await probe(p));
}

// ---------- E4: quote card → quoted post → back ----------
async function e4(p, rec) {
  await p.cdp("Page.bringToFront");
  // a post with a quote card: search for one on the profile timeline (rare) —
  // use the R3 quote sample if present on gefei55's profile; otherwise skip
  await p.goto(PROFILE);
  await p.waitForTimeout(7000);
  const quoteId = await evalMain(p, `(() => {
    for (const cell of document.querySelectorAll('[data-testid="cellInnerDiv"]')) {
      const a = [...cell.querySelectorAll('a[href*="/status/"]')].find(x => x.querySelector("time"));
      if (!a) continue;
      if (cell.querySelector('div[role="link"] [data-testid="tweetText"]')) {
        return (a.getAttribute("href").match(/status\\/(\\d+)/) || [])[1];
      }
    }
    return null;
  })()`);
  rec("quote-source", { quoteId: quoteId.result.value });
  if (!quoteId.result.value) return;
  const t = await findCell(p, quoteId.result.value);
  if (!t) { rec("skip", { reason: "quote source not found" }); return; }
  await trustClick(p, t);
  await waitFor(readyWithContent(cond === "orig" ? "orig" : "r1"), p);
  rec("open-quote-source", await probe(p));
  // click the quote card (capture-phase: orig intercepts, r1 lets X navigate)
  const scopeSel = cond === "orig" ? "'#tuzai-x-popover-root'" : "'[data-testid=\"primaryColumn\"]'";
  const q = await evalMain(p, `(() => {
    const art = document.querySelector(${scopeSel});
    const card = [...(art || document).querySelectorAll('div[role="link"]')].find(n => n.querySelector('[data-testid="tweetText"]'));
    if (!card) return null;
    const r = card.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + Math.min(r.height, 300) / 2) };
  })()`);
  if (!q.result.value) { rec("skip", { reason: "no quote card in surface" }); return; }
  await trustClick(p, q.result.value);
  await p.waitForTimeout(3500);
  rec("quote-opened", await probe(p));
  await shot(p, `e4-${cond}-quoted`);
  await pressEsc(p);
  await p.waitForTimeout(2500);
  rec("quote-back", await probe(p));
}

// ---------- E5: nested sub-reply → back ----------
async function e5(p, rec) {
  await p.cdp("Page.bringToFront");
  const p1 = await evalMain(p, PROBE);
  // open the high-reply sample then click the first "查看回复"/nested reply link
  await p.goto("https://x.com/XiaoJi0403/status/2109146979972403349");
  await p.waitForTimeout(7000);
  await waitFor(readyWithContent(cond === "orig" ? "orig" : "r1"), p);
  rec("open-highreply", await probe(p));
  // find a sub-reply indicator (orig: nested reply card click; r1/native: click a reply cell's timestamp)
  const t = await evalMain(p, `(() => {
    const scope = ${cond === "orig" ? "document.getElementById('tuzai-x-popover-root')" : "document.querySelector('[data-testid=\"primaryColumn\"]')"};
    if (!scope) return null;
    const cells = [...scope.querySelectorAll('[data-testid="cellInnerDiv"]')].slice(1);
    for (const c of cells) {
      const a = [...c.querySelectorAll('a[href*="/status/"]')].find(x => x.querySelector("time"));
      if (!a) continue;
      const r = a.getBoundingClientRect();
      if (r.y < 80 || r.y > innerHeight - 80) continue;
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + 20) };
    }
    return null;
  })()`);
  if (!t.result.value) { rec("skip", { reason: "no clickable reply in view" }); return; }
  await trustClick(p, t.result.value);
  await p.waitForTimeout(4000);
  rec("reply-opened", await probe(p));
  await shot(p, `e5-${cond}-reply`);
  await pressEsc(p);
  await p.waitForTimeout(2500);
  rec("reply-back", await probe(p));
}

// ---------- E9: 5 open/close cycles, stability + residue probes ----------
async function e9(p, rec) {
  await p.cdp("Page.bringToFront");
  await p.goto(PROFILE);
  await p.waitForTimeout(7000);
  const ids = [];
  for (let step = 0; step < 20 && ids.length < 2; step++) {
    const found = await evalMain(p, `(() => [...new Set([...document.querySelectorAll('[data-testid="cellInnerDiv"]')].map(c => {
      const a = [...c.querySelectorAll('a[href*="/status/"]')].find(x => x.querySelector("time"));
      return a ? (a.getAttribute("href").match(/status\\/(\\d+)/) || [])[1] : null;
    }).filter(Boolean))].slice(0, 2))()`);
    for (const id of found.result.value || []) if (!ids.includes(id)) ids.push(id);
    if (ids.length < 2) { await evalMain(p, `scrollBy(0, 500)`); await p.waitForTimeout(700); }
  }
  if (ids.length < 2) { rec("skip", { reason: "not enough posts" }); return; }
  for (let i = 1; i <= 5; i++) {
    const id = ids[i % 2];
    const t = await findCell(p, id);
    if (!t) { rec(`cycle${i}`, { error: "cell not found" }); continue; }
    await trustClick(p, t);
    await waitFor(readyWithContent(cond === "orig" ? "orig" : "r1"), p);
    const open = await probe(p);
    await pressEsc(p);
    await p.waitForTimeout(2200);
    const closed = await probe(p);
    rec(`cycle${i}`, { openSurface: cond === "orig" ? open.overlayOpen : open.paneOpen, closedSurface: cond === "orig" ? closed.overlayOpen : closed.paneOpen, paneResidue: closed.paneOpen && cond === "r1", pathAfter: closed.path });
  }
  await shot(p, `e9-${cond}-final`);
}

// ---------- E7: deep scroll then close ----------
async function e7(p, rec) {
  await p.cdp("Page.bringToFront");
  await p.goto("https://x.com/XiaoJi0403/status/2109146979972403349");
  await p.waitForTimeout(7000);
  await waitFor(readyWithContent(cond === "orig" ? "orig" : "r1"), p);
  const before = await probe(p);
  for (let i = 0; i < 8; i++) {
    await p.cdp("Input.dispatchMouseEvent", { type: "mouseWheel", x: 720, y: 450, deltaX: 0, deltaY: 900 });
    await p.waitForTimeout(400);
  }
  rec("deep-scrolled", { ...(await probe(p)), beforeCells: before.cellCount });
  await shot(p, `e7-${cond}-deep`);
  await pressEsc(p);
  await p.waitForTimeout(2500);
  rec("deep-close", await probe(p));
}

for (const cond of ["orig", "r1"]) {
  await runScenario(cond, "E3", e3);
  await runScenario(cond, "E4", e4);
  await runScenario(cond, "E5", e5);
  await runScenario(cond, "E7", e7);
  await runScenario(cond, "E9", e9);
}

writeFileSync(join(OUT, "experience-log.json"), JSON.stringify(log, null, 1));
console.log("experience run complete →", OUT);
for (const l of created) { try { await task.page(l).close(); } catch { /* gone */ } }
try { unlinkSync(PAGES_FILE); } catch {}
