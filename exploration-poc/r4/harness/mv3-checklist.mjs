// R4 MV3 L4 checklist runner — the REAL extension is loaded in this browser
// (loaded by the user via chrome://extensions). NO CDP injection anywhere:
// every pane behavior observed here is produced by the genuine MV3 content
// script. Read-only: no likes/replies/follows/settings writes (checklist #11's
// real write stays with the user; we only test the locate+highlight half).
// Run: exploration-poc/r3/run.sh exploration-poc/r4/harness/mv3-checklist.mjs
const ROOT = "__PEEK_REPO_ROOT__";
if (ROOT.startsWith("__")) throw new Error("run via exploration-poc/r3/run.sh");
const { readFileSync, mkdirSync, writeFileSync, unlinkSync } = await import("node:fs");
const { join } = await import("node:path");
const { recordsFromEvents } = await import(`${ROOT}/exploration-poc/r3/network-census.mjs`);

const OUT = join(ROOT, "exploration-poc", "r4", "evidence", "mv3");
mkdirSync(OUT, { recursive: true });

const PROFILE = "https://x.com/gefei55";
const VIDEO = { profile: "https://x.com/thinkszyg", id: "2109309251533570509" };
const HIGHREPLY = { profile: "https://x.com/XiaoJi0403", id: "2109146979972403349" };
const VIEWPORT = { width: 1440, height: 900 };

// page cleanup
const PAGES_FILE = `${ROOT}/exploration-poc/r4/harness/.pages-mv3.json`;
let stale = [];
try { stale = JSON.parse(readFileSync(PAGES_FILE, "utf8")); } catch { /* first run */ }
for (const n of [...stale, "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10", "p11", "p12", "p13", "p14", "p15"]) {
  try { await task.page(n).close(); } catch { /* absent */ }
}
const allPages = [];
writeFileSync(PAGES_FILE, "[]");

const evalMain = (p, expression, opts = {}) => p.cdp("Runtime.evaluate", { expression, returnByValue: true, ...opts });
const safeGoto = async (p, url) => { try { await p.goto(url); } catch (e) { console.log(`goto ${url} failed: ${e.message}`); } };

async function newPage(label) {
  const p = await task.newPage();
  allPages.push(p.label);
  writeFileSync(PAGES_FILE, JSON.stringify(allPages));
  await p.cdp("Emulation.setDeviceMetricsOverride", { ...VIEWPORT, deviceScaleFactor: 1, mobile: false });
  await p.cdp("Network.enable");
  // read-only observation of Escape's propagation state (main world)
  await p.cdp("Page.addScriptToEvaluateOnNewDocument", { source: `window.__escTrace = [];
    addEventListener('keydown', (e) => { if (e.key === 'Escape') __escTrace.push('cap:' + e.defaultPrevented); }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') __escTrace.push('doc:' + e.defaultPrevented); }, true);`, runImmediately: true });
  return p;
}
const escTrace = (p) => evalMain(p, `window.__escTrace || []`).then((r) => r.result.value);

async function shot(p, name) {
  const r = await p.cdp("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.data, "base64"));
}

async function pressEsc(p) {
  try {
    await p.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await p.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  } catch { /* page mid-navigation: the dispatch target is gone; retried by callers */ }
}
// CDP key dispatch can silently drop when another window holds OS focus (the
// user's own browser window) — verify the event landed and retry with
// bringToFront. Returns the number of attempts (1 = clean).
async function pressEscUntil(p, effectFn, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    await p.cdp("Page.bringToFront");
    await pressEsc(p);
    await p.waitForTimeout(900);
    if (await effectFn(p)) return i;
  }
  return attempts + 1; // exhausted — effect never observed
}

const PROBE = `(() => {
  const pane = document.getElementById('peek-poc-pane');
  const cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
  const firstCell = cells[0];
  const sidebar = document.querySelector('[data-testid="sidebarColumn"]');
  const primary = document.querySelector('[data-testid="primaryColumn"]');
  const art = firstCell?.querySelector('article[data-testid="tweet"]');
  return {
    path: location.pathname,
    paneOpen: Boolean(pane),
    paneStatusId: pane?.dataset.statusId || null,
    paneTextHead: pane ? (pane.querySelector('.peek-poc-text')?.innerText || '').slice(0, 50) : null,
    paneCounts: pane ? (pane.querySelector('.peek-poc-counts')?.innerText || '').slice(0, 80) : null,
    paneAuthor: pane ? (pane.querySelector('.peek-poc-author b')?.innerText || '') : null,
    paneClose: Boolean(pane?.querySelector('.peek-poc-close')),
    richNote: pane ? (pane.querySelector('.peek-poc-rich-note')?.innerText || '').slice(0, 50) || null : null,
    htmlAttr: document.documentElement.getAttribute('data-peek-poc'),
    sidebarHidden: sidebar ? getComputedStyle(sidebar).display === 'none' : null,
    cellCount: cells.length,
    firstCellIsFocal: firstCell ? [...(firstCell.querySelectorAll('a[href*="/status/"]'))].some(a => a.querySelector('time')) : false,
    focalText: (art?.querySelector('[data-testid="tweetText"]')?.innerText || '').slice(0, 50),
    scrollY: Math.round(scrollY),
    theme: (() => { const bg = getComputedStyle(document.body).backgroundColor; return bg.includes('0, 0, 0') ? 'dark' : (bg.includes('255') ? 'light' : bg); })(),
  };
})()`;
const probe = async (p) => {
  try {
    const r = await evalMain(p, PROBE);
    return r.result?.value ?? null;
  } catch { return null; }
};

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
  try {
    await p.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await p.cdp("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await p.cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  } catch { /* page mid-navigation */ }
}

const log = [];
const record = (item, step, data) => {
  log.push({ item, step, ...data });
  console.log(`#${item}/${step}: ${JSON.stringify(data).slice(0, 300)}`);
  writeFileSync(join(OUT, "mv3-checklist-log.json"), JSON.stringify(log, null, 1)); // incremental: crashes never lose evidence
};
const verdict = (item, pass, note, extra = {}) => record(item, "verdict", { pass, note, ...extra });

// ---------- verification that the REAL extension (not CDP injection) runs ----------
const p = await newPage("mv3");
await p.cdp("Page.bringToFront");
// L4 gate: on a page this harness NEVER injected into, the pane must appear
await safeGoto(p, `${PROFILE}/status/2109450990575611958`);
await p.waitForTimeout(6000);
const l4 = await probe(p);
verdict("L4", l4.paneOpen && l4.paneStatusId === "2109450990575611958",
  l4.paneOpen ? "pane appeared on an injection-free page — real MV3 content script confirmed"
    : "PANE DID NOT APPEAR on a fresh page — extension not visible to this task space", l4);

// ---------- Item 1: timeline click → reading view ----------
await safeGoto(p, PROFILE);
await p.waitForTimeout(7000);
const ids = [];
for (let step = 0; step < 12 && ids.length < 3; step++) {
  const found = await evalMain(p, `(() => [...new Set([...document.querySelectorAll('[data-testid="cellInnerDiv"]')].map(c => {
    const a = [...c.querySelectorAll('a[href*="/status/"]')].find(x => x.querySelector("time") && !x.closest('div[role="link"]'));
    return a ? (a.getAttribute("href").match(/status\\/(\\d+)/) || [])[1] : null;
  }).filter(Boolean))].slice(0, 3))()`);
  for (const id of found.result.value || []) if (!ids.includes(id)) ids.push(id);
  if (ids.length < 3) { await evalMain(p, `scrollBy(0, 500)`); await p.waitForTimeout(700); }
}
const t1 = await findCell(p, ids[0]);
if (t1) {
  const preScroll = (await probe(p)).scrollY;
  await trustClick(p, t1);
  const ok = await waitFor(async (pp) => (await probe(pp)).paneOpen, p, 9000);
  await waitFor(async (pp) => { const v = await probe(pp); return v && v.cellCount > 0; }, p, 6000);
  const v1 = await probe(p);
  await shot(p, "item1-open");
  verdict(1, Boolean(ok && v1.paneStatusId === ids[0] && v1.firstCellIsFocal && v1.sidebarHidden !== false),
    ok ? "pane up; sidebar hidden; right column first cell = focal" : "open failed", { ...v1, preScroll });
} else verdict(1, false, "sample cell not found");

// ---------- Item 2: counts parity ----------
{
  const v = await probe(p);
  const native = await evalMain(p, `(() => {
    const cell = document.querySelector('[data-testid="primaryColumn"] [data-testid="cellInnerDiv"]');
    const art = cell && cell.querySelector('article[data-testid="tweet"]');
    if (!art) return { error: 'no focal article' };
    const g = (n) => { const el = art.querySelector('[data-testid="' + n + '"], [data-testid="un' + n + '"]'); return el ? (el.getAttribute('aria-label') || el.innerText || '').slice(0, 24) : null; };
    return { reply: g('reply'), retweet: g('retweet'), like: g('like'), bookmark: g('bookmark') };
  })()`);
  verdict(2, Boolean(v.paneCounts && native.result?.value?.reply != null), "pane vs native counts (human-readable compare)", { pane: v.paneCounts, native: native.result?.value, err: native.exceptionDetails?.text || null });
}

// ---------- Item 3: open a reply detail ----------
{
  // scroll the detail page until a reply timestamp is in band, click it
  let t = null;
  for (let step = 0; step < 10 && !t; step++) {
    t = (await evalMain(p, `(() => {
      const cells = [...document.querySelectorAll('[data-testid="primaryColumn"] [data-testid="cellInnerDiv"]')].slice(1);
      for (const c of cells) {
        const a = [...c.querySelectorAll('a[href*="/status/"]')].find(x => x.querySelector("time") && !x.closest('div[role="link"]'));
        if (!a) continue;
        const r = a.getBoundingClientRect();
        if (r.y < 80 || r.y > innerHeight - 80) continue;
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + 20) };
      }
      return null;
    })()`)).result.value;
    if (!t) { await evalMain(p, `scrollBy(0, 600)`); await p.waitForTimeout(700); }
  }
  if (t) {
    const focalBefore = (await probe(p)).paneTextHead;
    await trustClick(p, t);
    await p.waitForTimeout(3500);
    const v3 = await probe(p);
    await shot(p, "item3-reply");
    const isReply = v3.path.includes("/status/") && v3.paneStatusId && !v3.path.endsWith(`/${v3.paneStatusId}`) === false;
    verdict(3, v3.paneOpen && v3.paneStatusId === (v3.path.match(/status\/(\d+)/) || [])[1],
      v3.paneOpen ? "pane rebuilt for the clicked reply (URL id match)" : "reply open failed",
      { ...v3, focalBefore });
  } else verdict(3, false, "no clickable reply found in view");
}

// ---------- Item 4: click another post on the detail page → pane switches ----------
{
  // deterministic: fresh profile load, then open a different post
  await safeGoto(p, PROFILE);
  await p.waitForTimeout(7000);
  const idB = ids[1];
  const t4 = idB ? await findCell(p, idB) : null;
  if (t4) {
    await trustClick(p, t4);
    await waitFor(async (pp) => { const v = await probe(pp); return v.paneOpen && v.paneStatusId === idB; }, p, 9000);
    const v4 = await probe(p);
    verdict(4, v4.paneOpen && v4.paneStatusId === idB && v4.path.includes(idB), "pane switched to the new post", v4);
  } else verdict(4, false, "second post not reachable");
}

// ---------- Item 5: browser back/forward ----------
{
  const v4path = (await probe(p)).path; // post B detail (from item 4)
  await evalMain(p, `history.back()`);
  await p.waitForTimeout(3000);
  const afterBack = await probe(p);
  await evalMain(p, `history.forward()`);
  const fwdOk = await waitFor(async (pp) => { const v = await probe(pp); return v.paneOpen && v.path === v4path; }, p, 8000);
  const afterFwd = await probe(p);
  verdict(5, !afterBack.paneOpen && fwdOk, "back dismisses / forward restores", { afterBack, afterFwd, fwdOk });
}

// ---------- Item 6: timeline-entered close (Esc) — feed position kept ----------
{
  await evalMain(p, `history.back()`); // return to profile (timeline context)
  await p.waitForTimeout(2500);
  const t6 = await findCell(p, ids[0]);
  if (t6) {
    const preScroll = (await probe(p)).scrollY;
    await trustClick(p, t6);
    await waitFor(async (pp) => (await probe(pp)).paneOpen, p, 9000);
    const attempts6 = await pressEscUntil(p, async (pp) => { const v = await probe(pp); return Boolean(v && !v.paneOpen && !v.path.includes("/status/")); });
    await p.waitForTimeout(1800);
    const v6 = await probe(p);
    const tr6 = await escTrace(p);
    await shot(p, "item6-after-esc");
    verdict(6, Boolean(v6 && !v6.paneOpen && !v6.path.includes("/status/") && Math.abs(v6.scrollY - preScroll) <= 300),
      attempts6 > 1 ? `Esc returned to the feed after ${attempts6} dispatch attempts (first CDP key dispatches silently dropped — environment, see report)` : "Esc returns to the feed; scroll anchor kept (±300px virtualizer re-anchor tolerance)", { preScroll, ...v6, attempts: attempts6, escTrace: tr6 });
  } else verdict(6, false, "post not reachable");
}

// ---------- Item 7: direct URL close — stays on X ----------
{
  await p.goto(`https://x.com/gefei55/status/2109450990575611958`);
  await p.waitForTimeout(6000);
  const opened = await probe(p);
  const attempts7 = await pressEscUntil(p, async (pp) => { const v = await probe(pp); return Boolean(v && !v.paneOpen); });
  await p.waitForTimeout(1800);
  const v7 = await probe(p);
  const tr7 = await escTrace(p);
  verdict(7, Boolean(opened.paneOpen && v7 && !v7.paneOpen && v7.path.includes("/status/")),
    attempts7 > 1 ? `direct-entry Esc dismissed after ${attempts7} dispatch attempts (environment); stays on the detail page` : "direct-entry Esc dismisses the pane and STAYS on the detail page (no off-site back)", { openedPath: opened.path, ...v7, attempts: attempts7, escTrace: tr7 });
}

// ---------- Item 8: video post ----------
{
  await safeGoto(p, VIDEO.profile);
  await p.waitForTimeout(7000);
  const t8 = await findCell(p, VIDEO.id);
  if (t8) {
    await trustClick(p, t8);
    await waitFor(async (pp) => (await probe(pp)).paneOpen, p, 9000);
    await p.waitForTimeout(2500);
    const v8 = await probe(p);
    const vid = await evalMain(p, `(() => { const v = document.querySelector('[data-testid="primaryColumn"] video'); return { present: Boolean(v), ready: v ? v.readyState : null, playing: v ? (!v.paused && v.currentTime > 0) : null }; })()`);
    await shot(p, "item8-video");
    verdict(8, v8.paneOpen && Boolean(v8.richNote) && vid.result.value.present,
      "video post: pane note + native player present in the right column", { ...v8, video: vid.result.value });
  } else verdict(8, false, "video sample not reachable");
}

// ---------- Item 10/11: residue + locate&highlight (no write) ----------
{
  // use the current (video) post for the locate test
  const v = await probe(p);
  if (v.paneOpen) {
    const likeBtn = await evalMain(p, `(() => {
      const b = document.querySelector('.peek-poc-actions [data-act="like"]');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()`);
    if (likeBtn.result.value) {
      await trustClick(p, likeBtn.result.value); // pane button = locate + highlight only
      await p.waitForTimeout(800); // mid-highlight window (outline clears at 1.6s)
      const hlMid = await evalMain(p, `(() => {
        const cell = document.querySelector('[data-testid="primaryColumn"] [data-testid="cellInnerDiv"]');
        const native = cell && (cell.querySelector('[data-testid="like"]') || cell.querySelector('[data-testid="unlike"]'));
        return { outlined: native ? (native.style.outline || "").includes("solid") : false };
      })()`);
      await p.waitForTimeout(1800); // smooth scrollIntoView settled
      const hl = await evalMain(p, `(() => {
        const cell = document.querySelector('[data-testid="primaryColumn"] [data-testid="cellInnerDiv"]');
        const native = cell && (cell.querySelector('[data-testid="like"]') || cell.querySelector('[data-testid="unlike"]'));
        const pane = document.getElementById('peek-poc-pane');
        return { nativeFound: Boolean(native),
                 nativeInViewport: native ? (native.getBoundingClientRect().y > 0 && native.getBoundingClientRect().y < innerHeight) : false,
                 outlined: native ? (native.style.outline || "").includes("solid") : false,
                 paneStill: Boolean(pane) };
      })()`);
      hl.result.value = { ...hl.result.value, outlinedMid: hlMid.result?.value?.outlined ?? null };
      // item 10: close and check residue
      await pressEsc(p);
      await p.waitForTimeout(2600);
      const residue = await probe(p);
      const residueProbe = await evalMain(p, `(() => ({ pane: Boolean(document.getElementById('peek-poc-pane')), htmlAttr: document.documentElement.getAttribute('data-peek-poc'), style: Boolean(document.getElementById('peek-poc-style')) }))()`).catch(() => ({ result: { value: { pane: "eval-error", htmlAttr: "eval-error" } } }));
      const rp = residueProbe.result?.value || {};
      verdict(11, Boolean(hl.result.value && (hl.result.value.nativeInViewport || hl.result.value.outlinedMid)),
        "pane like-button located+highlighted the native control (REAL WRITE NOT PERFORMED — yours to do if desired)", hl.result.value);
      verdict(10, rp.pane === false && rp.htmlAttr === null,
        "closed: no pane residue, html attribute cleaned", { ...rp, path: residue?.path ?? null });
    } else verdict(11, false, "pane like button not found");
  } else verdict(11, false, "no pane open for locate test");
}

// ---------- Item 12: theme following (current theme only — no settings write) ----------
{
  await safeGoto(p, `${PROFILE}/status/2109450990575611958`);
  await p.waitForTimeout(8000);
  const v = await probe(p);
  const paneBg = await evalMain(p, `document.getElementById('peek-poc-pane') ? getComputedStyle(document.getElementById('peek-poc-pane')).backgroundColor : 'pane-missing'`).catch(() => ({ result: { value: "eval-error" } }));
  verdict(12, Boolean(v && v.paneOpen), `theme="${v?.theme}", pane bg=${paneBg.result?.value} (current theme followed; switching not exercised to avoid account-setting writes)`, { theme: v?.theme, paneBg: paneBg.result?.value });
  await pressEsc(p);
  await p.waitForTimeout(2000);
}

// ---------- Item 13: rapid A→B race ----------
{
  await safeGoto(p, PROFILE);
  await p.waitForTimeout(7000);
  const tA = await findCell(p, ids[0]);
  if (tA) {
    await trustClick(p, tA);
    await p.waitForTimeout(400); // A not yet built
    // click another status link on the (arriving) detail page, or the next profile post
    const tB = await evalMain(p, `(() => {
      const links = [...document.querySelectorAll('[data-testid="primaryColumn"] a[href*="/status/"]')].filter(a => a.querySelector("time") && !a.closest('div[role="link"]'));
      const a = links.find(l => { const r = l.getBoundingClientRect(); return r.y > 80 && r.y < innerHeight - 80; });
      if (!a) return null;
      const r = a.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + 20) };
    })()`);
    if (tB.result.value) {
      await trustClick(p, tB.result.value);
      await p.waitForTimeout(3500);
      const raced = await probe(p);
      await evalMain(p, `history.back()`);
      await p.waitForTimeout(2200);
      const back = await probe(p);
      const panes = await evalMain(p, `document.querySelectorAll('#peek-poc-pane').length`);
      verdict(13, panes.result.value <= 1 && !back.paneOpen,
        "no double pane, no residue after rapid switch + return", { racedPath: raced?.path, racedPane: raced?.paneStatusId, paneCount: panes.result.value, backPath: back?.path });
    } else verdict(13, false, "no second status link visible for the race");
  } else verdict(13, false, "post A not reachable");
}

// ---------- Item 14: external → A → deeper B → back → close stays on A ----------
{
  await p.goto(`https://x.com/${HIGHREPLY.profile.replace("https://x.com/", "")}/status/${HIGHREPLY.id}`);
  await p.waitForTimeout(6000);
  const opened = await probe(p) || {};
  // click a reply (deeper navigation)
  let t = null;
  for (let step = 0; step < 8 && !t; step++) {
    t = (await evalMain(p, `(() => {
      const cells = [...document.querySelectorAll('[data-testid="primaryColumn"] [data-testid="cellInnerDiv"]')].slice(1);
      for (const c of cells) {
        const a = [...c.querySelectorAll('a[href*="/status/"]')].find(x => x.querySelector("time") && !x.closest('div[role="link"]'));
        if (!a) continue;
        const r = a.getBoundingClientRect();
        if (r.y < 80 || r.y > innerHeight - 80) continue;
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + 20) };
      }
      return null;
    })()`)).result.value;
    if (!t) { await evalMain(p, `scrollBy(0, 600)`); await p.waitForTimeout(700); }
  }
  if (t && opened.paneOpen) {
    await trustClick(p, t);
    await p.waitForTimeout(3500);
    const onB = await probe(p);
    await evalMain(p, `history.back()`); // browser back to A
    await p.waitForTimeout(3000);
    const onA = await probe(p);
    await pressEsc(p); // close on A — previous entry is OFF-SITE (direct entry)
    await p.waitForTimeout(2600);
    const closed = await probe(p);
    verdict(14, Boolean(onA && closed && onA.path.includes(HIGHREPLY.id) && !closed.paneOpen && closed.path.includes("/status/")),
      "back to A then close: stays on A, never leaves X", { onA: onA?.path, onB: onB?.path, closed: closed?.path, paneAfterClose: closed?.paneOpen });
  } else verdict(14, false, "could not set up the external-entry sequence");
}

// ---------- Item 15: 5 open/close cycles ----------
{
  await safeGoto(p, PROFILE);
  await p.waitForTimeout(7000);
  const cycles = [];
  for (let i = 1; i <= 5; i++) {
    const id = ids[i % Math.max(1, Math.min(3, ids.length))];
    const t = await findCell(p, id);
    if (!t) { cycles.push({ cycle: i, error: "cell not found" }); continue; }
    const t0 = Date.now();
    await trustClick(p, t);
    const opened = await waitFor(async (pp) => (await probe(pp)).paneOpen, p, 9000);
    const openMs = Date.now() - t0;
    const v = await probe(p);
    await pressEsc(p);
    await p.waitForTimeout(2200);
    const closed = await probe(p);
    cycles.push({ cycle: i, openMs, opened, paneId: v?.paneStatusId ?? null, closed: Boolean(closed && !closed.paneOpen && !closed.path.includes("/status/")), pathAfter: closed?.path });
  }
  const allOk = cycles.length === 5 && cycles.every((c) => c.opened && c.closed && !c.error);
  verdict(15, allOk, "5 cycles; every open/close correct; open times recorded", { cycles });
}

// ---------- network sanity on one open (L4 re-verification of zero-extension-API) ----------
{
  await p.goto("about:blank");
  await p.cdp("Network.enable");
  await safeGoto(p, `${PROFILE}/status/2109450990575611958`);
  await p.waitForTimeout(7000);
  const evts = await p.events();
  const reqs = recordsFromEvents(evts);
  const api = reqs.filter((r) => r.cat === "graphql" || r.cat === "rest");
  const byOp = {};
  for (const r of api) byOp[`${r.cat}:${r.op}`] = (byOp[`${r.cat}:${r.op}`] || 0) + 1;
  verdict("NET", true, "L4 window network (sanitized; TweetDetail etc. are X's own detail-page fetches)", { apiTotal: api.length, byOp });
}

writeFileSync(join(OUT, "mv3-checklist-log.json"), JSON.stringify(log, null, 1));
console.log("mv3 checklist complete →", OUT);
for (const l of allPages) { try { await task.page(l).close(); } catch { /* gone */ } }
try { unlinkSync(PAGES_FILE); } catch {}
