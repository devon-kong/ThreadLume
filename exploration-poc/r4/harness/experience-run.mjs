// R4 G3 experience harness v2 — scripted reading-flow equivalence sequences
// for A (original Peek) and B (R1 PoC). Lessons from v1:
//  - every scenario runs on a FRESH page (clean joint session history — v1's
//    shared page made "close" traverse into earlier scenarios' entries),
//  - orig's overlay only exists after a timeline click, so every orig scenario
//    enters through profile → find → trusted click (never a bare detail goto),
//  - reply probes scroll until a reply cell is inside the interaction band.
// No writes; scrolling/reading only.
// Run: exploration-poc/r3/run.sh exploration-poc/r4/harness/experience-run.mjs
const ROOT = "__PEEK_REPO_ROOT__";
if (ROOT.startsWith("__")) throw new Error("run via exploration-poc/r3/run.sh");
const { readFileSync, mkdirSync, writeFileSync, unlinkSync } = await import("node:fs");
const { join } = await import("node:path");

const OUT = join(ROOT, "exploration-poc", "r4", "evidence", "experience");
mkdirSync(OUT, { recursive: true });

const PROFILE = "https://x.com/gefei55";
const HIGHREPLY = { author: "XiaoJi0403", id: "2109146979972403349", profile: "https://x.com/XiaoJi0403" };
const VIEWPORT = { width: 1440, height: 900 };

const PAGES_FILE = `${ROOT}/exploration-poc/r4/harness/.pages-exp.json`;
let stale = [];
try { stale = JSON.parse(readFileSync(PAGES_FILE, "utf8")); } catch { /* first run */ }
for (const n of [...stale, "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10", "p11", "p12", "p13", "p14", "p15"]) {
  try { await task.page(n).close(); } catch { /* absent */ }
}
const allPages = [];
writeFileSync(PAGES_FILE, "[]");

const evalMain = (p, expression, opts = {}) => p.cdp("Runtime.evaluate", { expression, returnByValue: true, ...opts });

async function newPage(cond) {
  const p = await task.newPage();
  allPages.push(p.label);
  writeFileSync(PAGES_FILE, JSON.stringify(allPages));
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
    await p.cdp("Page.addScriptToEvaluateOnNewDocument", { source: iso, worldName: `peek-r4-orig-${p.label}`, runImmediately: true });
  } else {
    const css = readFileSync(`${ROOT}/exploration-poc/mv3-poc/content.css`, "utf8");
    const js = readFileSync(`${ROOT}/exploration-poc/mv3-poc/content.js`, "utf8");
    const boot = `(function(){function inj(){if(document.querySelector("style[data-peek-poc-css]"))return;var s=document.createElement("style");s.setAttribute("data-peek-poc-css","1");s.textContent=${JSON.stringify(css)};(document.head||document.documentElement||document).appendChild(s);}if(document.head||document.documentElement){inj();}else{document.addEventListener("DOMContentLoaded",inj,{once:true});}})();\n` + js;
    await p.cdp("Page.addScriptToEvaluateOnNewDocument", { source: boot, worldName: `peek-poc-r4exp-${p.label}`, runImmediately: true });
  }
  return p;
}

async function shot(p, name) {
  const r = await p.cdp("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.data, "base64"));
}

async function pressEsc(p) {
  await p.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await p.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
}

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
    if (await pred(p)) return true;
    if (Date.now() - t0 > timeoutMs) return false;
    await p.waitForTimeout(pollMs);
  }
}

async function findCell(p, statusId) {
  for (let step = 0; step < 40; step++) {
    const tgt = await evalMain(p, `(() => {
      const id = ${JSON.stringify(statusId)};
      for (const cell of document.querySelectorAll('[data-testid="cellInnerDiv"]')) {
        const a = [...cell.querySelectorAll('a[href*="/status/' + id + '"]')].find(x => x.querySelector("time") && !x.closest('div[role="link"]'));
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

// open a post the way a user does: profile → find → trusted click
async function openViaTimeline(p, cond, profileUrl, statusId) {
  await p.cdp("Page.bringToFront");
  await p.goto(profileUrl);
  await p.waitForTimeout(7000);
  const t = await findCell(p, statusId);
  if (!t) return false;
  await trustClick(p, t);
  const ok = await waitFor(async (pp) => {
    const v = await probe(pp);
    return cond === "orig" ? v.overlayOpen : v.paneOpen;
  }, p, 9000);
  return ok;
}

const log = [];
const record = (scenario, cond, step, data) => {
  log.push({ scenario, cond, step, ...data });
  console.log(`${scenario}/${cond}/${step}: ${JSON.stringify(data).slice(0, 240)}`);
};

// ---------- E3: consecutive A→B→C open/close loop (fresh page) ----------
async function e3(cond) {
  const p = await newPage(cond);
  const rec = (step, data) => record("E3", cond, step, data);
  try {
    const ids = [];
    await p.goto(PROFILE);
    await p.waitForTimeout(7000);
    for (let step = 0; step < 25 && ids.length < 3; step++) {
      const found = await evalMain(p, `(() => {
        const out = [];
        for (const cell of document.querySelectorAll('[data-testid="cellInnerDiv"]')) {
          const a = [...cell.querySelectorAll('a[href*="/status/"]')].find(x => x.querySelector("time") && !x.closest('div[role="link"]'));
          if (!a) continue;
          out.push((a.getAttribute("href").match(/status\\/(\\d+)/) || [])[1]);
        }
        return [...new Set(out)].slice(0, 3);
      })()`);
      for (const id of found.result.value || []) if (!ids.includes(id)) ids.push(id);
      if (ids.length < 3) { await evalMain(p, `scrollBy(0, 500)`); await p.waitForTimeout(700); }
    }
    rec("ids", { ids });
    if (ids.length < 3) { rec("skip", { reason: "not enough posts" }); return; }
    for (const [i, id] of ids.entries()) {
      const tag = "ABC"[i];
      const t = await findCell(p, id);
      if (!t) { rec(`open-${tag}`, { error: "cell not found" }); continue; }
      await trustClick(p, t);
      await waitFor(async (pp) => { const v = await probe(pp); return cond === "orig" ? v.overlayOpen : v.paneOpen; }, p, 9000);
      rec(`open-${tag}`, await probe(p));
      await shot(p, `e3-${cond}-${tag}`);
      await pressEsc(p);
      await p.waitForTimeout(2600);
      const closed = await probe(p);
      rec(`back-from-${tag}`, closed);
      if (cond === "r1" && closed.paneOpen) {
        rec(`back-from-${tag}-anomaly`, { note: "pane persisted after Esc — previous history entry is a detail page (逐级后退 semantics, see report)" });
      }
    }
  } finally { try { await p.close(); } catch { /* gone */ } }
}

// ---------- E4: quote card → quoted post → back ----------
async function e4(cond) {
  const p = await newPage(cond);
  const rec = (step, data) => record("E4", cond, step, data);
  try {
    await p.goto(PROFILE);
    await p.waitForTimeout(7000);
    let quoteId = null;
    for (let step = 0; step < 20 && !quoteId; step++) {
      const q = await evalMain(p, `(() => {
        for (const cell of document.querySelectorAll('[data-testid="cellInnerDiv"]')) {
          const a = [...cell.querySelectorAll('a[href*="/status/"]')].find(x => x.querySelector("time") && !x.closest('div[role="link"]'));
          if (!a) continue;
          if (cell.querySelector('div[role="link"] [data-testid="tweetText"]')) {
            return (a.getAttribute("href").match(/status\\/(\\d+)/) || [])[1];
          }
        }
        return null;
      })()`);
      quoteId = q.result.value;
      if (!quoteId) { await evalMain(p, `scrollBy(0, 600)`); await p.waitForTimeout(700); }
    }
    rec("quote-source", { quoteId });
    if (!quoteId) { rec("skip", { reason: "no quote post on profile timeline" }); return; }
    if (!(await openViaTimeline(p, cond, PROFILE, quoteId))) { rec("skip", { reason: "quote source did not open" }); return; }
    rec("open-quote-source", await probe(p));
    const scopeSel = cond === "orig" ? "'#tuzai-x-popover-root'" : "'[data-testid=\"primaryColumn\"]'";
    const q2 = await evalMain(p, `(() => {
      const scope = document.querySelector(${scopeSel});
      const card = [...(scope || document).querySelectorAll('div[role="link"]')].find(n => n.querySelector('[data-testid="tweetText"]'));
      if (!card) return null;
      const r = card.getBoundingClientRect();
      if (r.y < 80 || r.y > innerHeight - 80) return { offscreen: true };
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + Math.min(r.height, 300) / 2) };
    })()`);
    if (!q2.result.value || q2.result.value.offscreen) { rec("skip", { reason: "quote card not in band" }); return; }
    await trustClick(p, q2.result.value);
    await p.waitForTimeout(3500);
    rec("quote-opened", await probe(p));
    await shot(p, `e4-${cond}-quoted`);
    await pressEsc(p);
    await p.waitForTimeout(2600);
    rec("quote-back", await probe(p));
  } finally { try { await p.close(); } catch { /* gone */ } }
}

// ---------- E5: nested sub-reply → back ----------
async function e5(cond) {
  const p = await newPage(cond);
  const rec = (step, data) => record("E5", cond, step, data);
  try {
    if (!(await openViaTimeline(p, cond, HIGHREPLY.profile, HIGHREPLY.id))) { rec("skip", { reason: "post did not open" }); return; }
    rec("open-highreply", await probe(p));
    let t = null;
    for (let step = 0; step < 12 && !t; step++) {
      t = (await evalMain(p, `(() => {
        const scope = ${cond === "orig" ? "document.getElementById('tuzai-x-popover-root')" : "document.querySelector('[data-testid=\"primaryColumn\"]')"};
        if (!scope) return null;
        const cells = [...scope.querySelectorAll('[data-testid="cellInnerDiv"]')].slice(1);
        for (const c of cells) {
          const a = [...c.querySelectorAll('a[href*="/status/"]')].find(x => x.querySelector("time") && !x.closest('div[role="link"]'));
          if (!a) continue;
          const r = a.getBoundingClientRect();
          if (r.y < 80 || r.y > innerHeight - 80) continue;
          return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + 20) };
        }
        return null;
      })()`)).result.value;
      if (!t) {
        await evalMain(p, cond === "orig" ? `document.querySelector('#tuzai-x-popover-root .tuzai-reply-list')?.scrollBy(0, 600)` : `scrollBy(0, 600)`);
        await p.waitForTimeout(700);
      }
    }
    if (!t) { rec("skip", { reason: "no clickable reply found" }); return; }
    await trustClick(p, t);
    await p.waitForTimeout(4000);
    rec("reply-opened", await probe(p));
    await shot(p, `e5-${cond}-reply`);
    await pressEsc(p);
    await p.waitForTimeout(2600);
    rec("reply-back", await probe(p));
  } finally { try { await p.close(); } catch { /* gone */ } }
}

// ---------- E7: deep scroll then close ----------
async function e7(cond) {
  const p = await newPage(cond);
  const rec = (step, data) => record("E7", cond, step, data);
  try {
    if (!(await openViaTimeline(p, cond, HIGHREPLY.profile, HIGHREPLY.id))) { rec("skip", { reason: "post did not open" }); return; }
    const before = await probe(p);
    for (let i = 0; i < 8; i++) {
      await p.cdp("Input.dispatchMouseEvent", { type: "mouseWheel", x: 720, y: 450, deltaX: 0, deltaY: 900 });
      await p.waitForTimeout(400);
    }
    const after = await probe(p);
    rec("deep-scrolled", { ...after, beforeCells: before.cellCount });
    await shot(p, `e7-${cond}-deep`);
    await pressEsc(p);
    await p.waitForTimeout(2800);
    rec("deep-close", await probe(p));
  } finally { try { await p.close(); } catch { /* gone */ } }
}

// ---------- E9: repeated open/close cycles (stability + residue) ----------
async function e9(cond) {
  const p = await newPage(cond);
  const rec = (step, data) => record("E9", cond, step, data);
  try {
    await p.goto(PROFILE);
    await p.waitForTimeout(7000);
    const ids = [];
    for (let step = 0; step < 20 && ids.length < 2; step++) {
      const found = await evalMain(p, `(() => [...new Set([...document.querySelectorAll('[data-testid="cellInnerDiv"]')].map(c => {
        const a = [...c.querySelectorAll('a[href*="/status/"]')].find(x => x.querySelector("time") && !x.closest('div[role="link"]'));
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
      await waitFor(async (pp) => { const v = await probe(pp); return cond === "orig" ? v.overlayOpen : v.paneOpen; }, p, 9000);
      const open = await probe(p);
      await pressEsc(p);
      await p.waitForTimeout(2400);
      const closed = await probe(p);
      rec(`cycle${i}`, {
        openSurface: cond === "orig" ? open.overlayOpen : open.paneOpen,
        closedSurface: cond === "orig" ? closed.overlayOpen : closed.paneOpen,
        pathAfter: closed.path,
      });
    }
    await shot(p, `e9-${cond}-final`);
  } finally { try { await p.close(); } catch { /* gone */ } }
}

for (const cond of ["orig", "r1"]) {
  await e3(cond);
  await e4(cond);
  await e5(cond);
  await e7(cond);
  await e9(cond);
}

writeFileSync(join(OUT, "experience-log.json"), JSON.stringify(log, null, 1));
console.log("experience run complete →", OUT);
for (const l of allPages) { try { await task.page(l).close(); } catch { /* gone */ } }
try { unlinkSync(PAGES_FILE); } catch {}
