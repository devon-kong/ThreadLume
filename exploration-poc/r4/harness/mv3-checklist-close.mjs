// MV3 checklist completion via the ✕ button — the ✕ calls the SAME
// closeReader() as Esc, so all close semantics verify with mouse-only dispatch
// (CDP key dispatch silently drops in this multi-window session; Esc itself
// was proven working in debug-esc/debug-esc2/debug-keys when the page has
// keyboard focus).
// Run: exploration-poc/r3/run.sh exploration-poc/r4/harness/mv3-checklist-close.mjs
const ROOT = "__PEEK_REPO_ROOT__";
if (ROOT.startsWith("__")) throw new Error("run via exploration-poc/r3/run.sh");
const { readFileSync, mkdirSync, writeFileSync, unlinkSync } = await import("node:fs");
const { join } = await import("node:path");

const OUT = join(ROOT, "exploration-poc", "r4", "evidence", "mv3");
mkdirSync(OUT, { recursive: true });
const PROFILE = "https://x.com/gefei55";
const HIGHREPLY = { profile: "https://x.com/XiaoJi0403", id: "2109146979972403349" };
const VIEWPORT = { width: 1440, height: 900 };

const PAGES_FILE = `${ROOT}/exploration-poc/r4/harness/.pages-mv3c.json`;
let stale = [];
try { stale = JSON.parse(readFileSync(PAGES_FILE, "utf8")); } catch { }
for (const n of [...stale, "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10", "p11", "p12", "p13", "p14", "p15"]) {
  try { await task.page(n).close(); } catch { }
}
const allPages = [];
writeFileSync(PAGES_FILE, "[]");

const evalMain = (p, expression, opts = {}) => p.cdp("Runtime.evaluate", { expression, returnByValue: true, ...opts });
async function newPage() {
  const p = await task.newPage();
  allPages.push(p.label);
  writeFileSync(PAGES_FILE, JSON.stringify(allPages));
  await p.cdp("Emulation.setDeviceMetricsOverride", { ...VIEWPORT, deviceScaleFactor: 1, mobile: false });
  await p.cdp("Page.bringToFront");
  return p;
}
const shot = async (p, name) => {
  const r = await p.cdp("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.data, "base64"));
};
const probe = async (p) => {
  try {
    const r = await evalMain(p, `(() => ({
      path: location.pathname,
      paneOpen: Boolean(document.getElementById('peek-poc-pane')),
      paneStatusId: document.getElementById('peek-poc-pane')?.dataset.statusId || null,
      htmlAttr: document.documentElement.getAttribute('data-peek-poc'),
      cellCount: document.querySelectorAll('[data-testid="cellInnerDiv"]').length,
      scrollY: Math.round(scrollY),
      paneCount: document.querySelectorAll('#peek-poc-pane').length,
    }))()`);
    return r.result?.value ?? null;
  } catch { return null; }
};
async function waitFor(pred, p, timeoutMs = 10000, pollMs = 150) {
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
  } catch { /* mid-navigation */ }
}
async function closeViaX(p) {
  const b = await evalMain(p, `(() => { const b = document.querySelector('.peek-poc-close'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), inView: r.y > 0 && r.y < innerHeight }; })()`);
  if (!b.result.value?.inView) return false;
  await trustClick(p, b.result.value);
  return true;
}

const log = [];
const record = (item, step, data) => {
  log.push({ item, step, ...data });
  writeFileSync(join(OUT, "mv3-close-log.json"), JSON.stringify(log, null, 1));
  console.log(`#${item}/${step}: ${JSON.stringify(data).slice(0, 260)}`);
};

const p = await newPage();

// ---- Item 6 via ✕: timeline → click → ✕ → back to feed, anchor kept ----
await p.goto(PROFILE);
await p.waitForTimeout(7000);
let idA = null;
for (let step = 0; step < 12 && !idA; step++) {
  const found = await evalMain(p, `(() => { for (const cell of document.querySelectorAll('[data-testid="cellInnerDiv"]')) { const a = [...cell.querySelectorAll('a[href*="/status/"]')].find(x => x.querySelector("time") && !x.closest('div[role="link"]')); if (!a) continue; const r = a.getBoundingClientRect(); if (r.y < 80 || r.y > innerHeight - 80) break; return { id: (a.getAttribute("href").match(/status\\/(\\d+)/) || [])[1], x: Math.round(r.x + r.width / 2), y: Math.round(r.y + Math.min(r.height, 300) / 2) }; } return null; })()`);
  if (found.result.value) { idA = found.result.value.id; await trustClick(p, found.result.value); }
  else { await evalMain(p, `scrollBy(0, 400)`); await p.waitForTimeout(600); }
}
const opened6 = await waitFor(async (pp) => { const v = await probe(pp); return v && v.paneOpen; }, p, 9000);
const pre6 = await probe(p);
const x6 = await closeViaX(p);
await p.waitForTimeout(2800);
const after6 = await probe(p);
record(6, "via-✕", {
  opened: opened6, closed: Boolean(after6 && !after6.paneOpen && !after6.path.includes("/status/")),
  preScroll: pre6?.scrollY, postScroll: after6?.scrollY, path: after6?.path,
  anchorKept: pre6 && after6 ? Math.abs(after6.scrollY - pre6.scrollY) <= 300 : null,
});
await shot(p, "item6-via-x-after");

// ---- Item 7 via ✕: direct URL → ✕ → stays on the detail page ----
await p.goto(`${PROFILE}/status/2109450990575611958`);
await p.waitForTimeout(7000);
const opened7 = await probe(p);
await closeViaX(p);
await p.waitForTimeout(2800);
const after7 = await probe(p);
record(7, "via-✕", {
  opened: Boolean(opened7?.paneOpen), closed: Boolean(after7 && !after7.paneOpen),
  staysOnDetail: Boolean(after7?.path.includes("/status/")), path: after7?.path,
});

// ---- Item 10 via ✕: residue ----
const residue = await evalMain(p, `(() => ({ pane: Boolean(document.getElementById('peek-poc-pane')), htmlAttr: document.documentElement.getAttribute('data-peek-poc'), paneCount: document.querySelectorAll('#peek-poc-pane').length }))()`).catch(() => ({ result: { value: null } }));
record(10, "via-✕", { residue: residue.result?.value });

// ---- Item 14 via ✕: external → deeper reply → back → ✕ stays on A ----
await p.goto(`${HIGHREPLY.profile}/status/${HIGHREPLY.id}`);
await p.waitForTimeout(7000);
const opened14 = await probe(p);
let tReply = null;
for (let step = 0; step < 8 && !tReply; step++) {
  tReply = (await evalMain(p, `(() => {
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
  if (!tReply) { await evalMain(p, `scrollBy(0, 600)`); await p.waitForTimeout(700); }
}
if (tReply) {
  await trustClick(p, tReply);
  await p.waitForTimeout(3500);
  const onB = await probe(p);
  await evalMain(p, `history.back()`);
  await p.waitForTimeout(3000);
  const onA = await probe(p);
  await closeViaX(p);
  await p.waitForTimeout(2800);
  const closed = await probe(p);
  record(14, "via-✕", {
    openedA: Boolean(opened14?.paneOpen), onB: onB?.path, backOnA: onA?.path,
    closedStaysOnA: Boolean(closed && !closed.paneOpen && closed.path.includes(HIGHREPLY.id)),
    neverLeftX: Boolean(closed?.path.includes("x.com") || closed?.path.startsWith("/")),
  });
  await shot(p, "item14-after-close");
}

// ---- Item 15 via ✕: 5 open/close cycles ----
await p.goto(PROFILE);
await p.waitForTimeout(7000);
const ids = [];
for (let step = 0; step < 12 && ids.length < 3; step++) {
  const found = await evalMain(p, `(() => [...new Set([...document.querySelectorAll('[data-testid="cellInnerDiv"]')].map(c => { const a = [...c.querySelectorAll('a[href*="/status/"]')].find(x => x.querySelector("time") && !x.closest('div[role="link"]')); return a ? (a.getAttribute("href").match(/status\\/(\\d+)/) || [])[1] : null; }).filter(Boolean))].slice(0, 3))()`);
  for (const id of found.result.value || []) if (!ids.includes(id)) ids.push(id);
  if (ids.length < 3) { await evalMain(p, `scrollBy(0, 500)`); await p.waitForTimeout(700); }
}
const cycles = [];
for (let i = 1; i <= 5; i++) {
  const id = ids[i % Math.max(1, Math.min(3, ids.length))];
  const t = await findCell(p, id);
  if (!t) { cycles.push({ cycle: i, error: "cell not found" }); continue; }
  const t0 = Date.now();
  await trustClick(p, t);
  const opened = await waitFor(async (pp) => { const v = await probe(pp); return Boolean(v && v.paneOpen); }, p, 9000);
  const openMs = Date.now() - t0;
  await closeViaX(p);
  const closedOk = await waitFor(async (pp) => { const v = await probe(pp); return Boolean(v && !v.paneOpen); }, p, 5000);
  const after = await probe(p);
  cycles.push({ cycle: i, openMs, opened, closed: closedOk, pathAfter: after?.path });
}
record(15, "via-✕", { cycles, allOk: cycles.length === 5 && cycles.every((c) => c.opened && c.closed) });
await shot(p, "item15-final");

writeFileSync(join(OUT, "mv3-close-log.json"), JSON.stringify(log, null, 1));
console.log("close-path checklist complete");
for (const l of allPages) { try { await task.page(l).close(); } catch { } }
try { unlinkSync(PAGES_FILE); } catch { }
