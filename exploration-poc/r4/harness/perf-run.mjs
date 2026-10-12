// R4 G1 performance harness — A (original Peek 0.8.10) vs B (R1 PoC v5) vs
// C (X native), same logged-in session, interleaved, trusted CDP clicks.
//
// Method:
//  - One page per condition, injections registered per page (orig: page-bridge
//    MAIN world + vendor/core/content isolated; r1: mv3-poc isolated; native:
//    none). Viewport equalized via Emulation.setDeviceMetricsOverride; the
//    measured page is brought to the foreground for its window (background
//    tabs throttle timers, which would corrupt the 25ms predicate sampling).
//  - Scenario: author profile → scroll-to-find the sample cell → quiet period
//    (network drained to silence) → trusted Input.dispatchMouseEvent click on
//    the post's timestamp link. THE CLICK IS THE CLOCK START for every metric.
//  - In-page recorder (MAIN world, every document) timestamps the first click,
//    Esc presses, pre-close scrollY, and samples every 25ms for:
//    T1 first meaningful focal content (focal identity + non-empty body);
//    T2 first real attributed replies; T4 close → feed scrollable again
//    (r1/native: route left /status/ + scroll settled; orig: overlay removed);
//    T5 long tasks during an identical scripted wheel scroll + video start.
//  - Click-aligned network census: events are drained to QUIET right before
//    the click, so every recorded request is post-click (fixes the R3-R
//    attribution gap the strict G0-C judge exposed). Sanitized records only.
//  - No writes anywhere; scrolling and reading only. Small n (4 samples × 3
//    rounds): raw values, medians, slowest sample — no p95.
// Run: exploration-poc/r3/run.sh exploration-poc/r4/harness/perf-run.mjs
const ROOT = "__PEEK_REPO_ROOT__";
if (ROOT.startsWith("__")) throw new Error("run via exploration-poc/r3/run.sh");
const { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } = await import("node:fs");
const { join } = await import("node:path");
const { recordsFromEvents } = await import(`${ROOT}/exploration-poc/r3/network-census.mjs`);

const OUT = join(ROOT, "exploration-poc", "r4", "evidence", "perf");
mkdirSync(OUT, { recursive: true });

// Public sample posts (found read-only on the logged-in home timeline in the
// probe rounds; the long post was found via the search page). No Article-type
// post surfaced through filter:articles — the long show-more post stands in.
const SAMPLES = {
  short: { id: "2109450990575611958", author: "gefei55", name: "哥飞", profile: "https://x.com/gefei55" },
  highReply: { id: "2109146979972403349", author: "XiaoJi0403", name: "老季", profile: "https://x.com/XiaoJi0403" },
  long: { id: "2107948362414866685", author: "z35001116", name: "Ace_Analyst", profile: "https://x.com/z35001116" },
  video: { id: "2109309251533570509", author: "thinkszyg", name: "爆裂队长NEXT", profile: "https://x.com/thinkszyg" },
};
const ROUNDS = 3;
// smoke override: if harness/smoke.json exists, run a reduced matrix
let SMOKE = null;
try {
  SMOKE = JSON.parse(readFileSync(`${ROOT}/exploration-poc/r4/harness/smoke.json`, "utf8"));
  console.log("SMOKE MODE:", JSON.stringify(SMOKE));
} catch { /* full run */ }
const ORDERS = [ // rotate condition order per round to de-bias session evolution
  ["orig", "native", "r1"],
  ["native", "r1", "orig"],
  ["r1", "orig", "native"],
];
const VIEWPORT = { width: 1440, height: 900 };
const SETTLE_PROFILE_MS = 7000;
const SETTLE_READ_MS = 6000;      // reading window after the click (T1/T2 land here)
const FIND_MAX_STEPS = 40;
const QUIET_MAX_TRIES = 6;

// ---------- in-page recorder (MAIN world, every page, every document) ----------
const RECORDER = `(() => {
  if (window.__r4) return;
  const r = window.__r4 = {
    clicks: [], escapes: [], t1: null, t2: null, escAt: null, closedAt: null,
    overlayFirstAt: null, paneFirstAt: null, bodyFirstAt: null,
    preScrollY: null, feedAt: null, restoredScrollY: null, scrollSamples: [],
    anchorTop: null, anchorDelta: null,
    longtasks: [], videoPlayingAt: null, videoScrollAt: null, marks: {},
    started: false, cfg: null,
  };
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    r.escapes.push(performance.now());
    if (r.escAt === null) r.escAt = performance.now(); // first Escape = the close action
  }, true);
  addEventListener('click', (e) => {
    r.clicks.push({ t: performance.now(), x: e.clientX, y: e.clientY });
    if (!r.started && r.cfg && r.cfg.autoStart !== true) {
      // anchor for the T4 restoration check: where the clicked post sat in
      // the viewport (X re-anchors the virtualized list, so absolute scrollY
      // is NOT the restoration criterion — the clicked cell's position is)
      r.anchorTop = e.target?.closest?.('[data-testid="cellInnerDiv"]')?.getBoundingClientRect()?.top ?? null;
      start();
    }
  }, true);
  addEventListener('wheel', () => { if (r.cfg?.wantVideo && r.videoScrollAt === null) r.videoScrollAt = performance.now(); }, { passive: true, capture: true });
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) r.longtasks.push(Math.round(e.duration)); })
      .observe({ entryTypes: ['longtask'] });
  } catch {}

  function focalFacts() {
    const art = document.querySelector('[data-testid="primaryColumn"] article[data-testid="tweet"]');
    if (!art) return null;
    return {
      text: (art.querySelector('[data-testid="tweetText"]')?.innerText || '').trim(),
      name: (art.querySelector('[data-testid="User-Name"]')?.innerText || '').trim(),
      body: (art.innerText || '').trim(),
    };
  }
  function paneState() {
    const p = document.getElementById('peek-poc-pane');
    if (!p) return null;
    return {
      id: p.dataset.statusId,
      text: (p.querySelector('.peek-poc-text')?.innerText || '').trim(),
      unknown: Boolean(p.querySelector('.peek-poc-unknown')),
      author: (p.querySelector('.peek-poc-author span')?.innerText || '').replace(/^@/, ''),
    };
  }
  function overlayState() {
    const root = document.getElementById('tuzai-x-popover-root');
    if (!root) return null;
    return {
      bodyText: (root.querySelector('.tuzai-post-body')?.innerText || '').trim(),
      rootText: (root.innerText || '').trim(),
      replies: [...(root.querySelector('.tuzai-reply-list')?.children || [])]
        .filter((ch) => (ch.innerText || '').trim().length > 20).length,
      tools: Boolean(root.querySelector('.tuzai-reply-tools')),
    };
  }
  function t1Holds() {
    const cfg = r.cfg || {};
    if (cfg.cond === 'orig') {
      const o = overlayState();
      if (!o || !o.bodyText) return false;
      // the DOM snapshot may render the author without a resolvable handle
      // ("@unknown") — display name OR handle counts as focal identity
      const h = (cfg.handle || '').replace('/', '');
      return o.rootText.includes(h) || o.rootText.includes(cfg.authorName || '');
    }
    if (cfg.cond === 'r1') {
      const p = paneState();
      if (!p || p.unknown) return false;
      return p.id === cfg.id && p.text.length > 0 && p.author === (cfg.handle || '').replace('/', '');
    }
    const f = focalFacts();
    if (!f) return false;
    const h = (cfg.handle || '').replace('/', '');
    return f.text.length > 0 && (f.name.includes(h) || f.body.includes(h));
  }
  function t2Holds() {
    const cfg = r.cfg || {};
    if (cfg.cond === 'orig') {
      const root = document.getElementById('tuzai-x-popover-root');
      if (!root) return false;
      // a real reply card with its own timestamp + non-empty text (not a
      // skeleton or loading block)
      return [...root.querySelectorAll('.tuzai-reply-card')].some((c) =>
        c.querySelector('time') && (c.innerText || '').trim().length > 20);
    }
    const cells = [...document.querySelectorAll('[data-testid="primaryColumn"] [data-testid="cellInnerDiv"]')];
    return cells.length >= 2 && cells.slice(1).some((c) =>
      ((c.querySelector('article [data-testid="tweetText"]')?.innerText) || '').trim().length > 0);
  }
  function feedInteractive() {
    const cfg = r.cfg || {};
    if (cfg.cond === 'orig') {
      if (document.getElementById('tuzai-x-popover-root')) return false;
    } else if (location.pathname.includes('/status/')) return false;
    // the timeline must show the clicked post again before we call it recovered
    const id = cfg.id;
    const cell = [...document.querySelectorAll('[data-testid="cellInnerDiv"]')].find((c) =>
      [...c.querySelectorAll('a[href*="/status/' + id + '"]')].some((a) => a.querySelector('time')));
    if (cfg.cond !== 'orig' && !cell) return false;
    r.scrollSamples.push(scrollY);
    const s = r.scrollSamples;
    if (s.length >= 4) {
      const tail = s.slice(-4);
      if (Math.max(...tail) - Math.min(...tail) <= 1) {
        r.restoredScrollY = scrollY;
        r.anchorDelta = cell && r.anchorTop != null ? Math.round(cell.getBoundingClientRect().top - r.anchorTop) : (cfg.cond === 'orig' ? 0 : null);
        return true;
      }
    }
    return false;
  }
  function start() {
    if (r.started) return;
    r.started = true;
    r.preScrollY = scrollY;
    const tick = setInterval(() => {
      if (r.cfg && r.t1 === null && t1Holds()) r.t1 = performance.now();
      if (r.cfg && r.t1 !== null && r.t2 === null && t2Holds()) r.t2 = performance.now();
      // diagnostic first-paint markers (why-t1-when): raw surface presence and
      // raw focal body presence, independent of the identity requirement
      if (r.overlayFirstAt === null && document.getElementById('tuzai-x-popover-root')) {
        r.overlayFirstAt = performance.now();
        r.overlayFirstText = (document.getElementById('tuzai-x-popover-root').innerText || '').slice(0, 220);
      }
      if (r.paneFirstAt === null && document.getElementById('peek-poc-pane')) r.paneFirstAt = performance.now();
      if (r.bodyFirstAt === null) {
        const o = document.querySelector('#tuzai-x-popover-root .tuzai-post-body');
        const p2 = document.querySelector('#peek-poc-pane .peek-poc-text');
        const n2 = document.querySelector('[data-testid="primaryColumn"] article[data-testid="tweet"] [data-testid="tweetText"]');
        if ((o && (o.innerText || '').trim()) || (p2 && (p2.innerText || '').trim()) || (n2 && (n2.innerText || '').trim())) r.bodyFirstAt = performance.now();
      }
      if (r.escAt !== null && r.closedAt === null) {
        const cfg = r.cfg || {};
        const gone = cfg.cond === 'orig'
          ? !document.getElementById('tuzai-x-popover-root')
          : !document.getElementById('peek-poc-pane');
        if (gone) r.closedAt = performance.now();
      }
      if (r.escAt !== null && r.feedAt === null && feedInteractive()) r.feedAt = performance.now();
      if (r.cfg?.wantVideo && r.videoScrollAt !== null && r.videoPlayingAt === null) {
        const scope = r.cfg.cond === 'orig'
          ? document.getElementById('tuzai-x-popover-root')
          : document.querySelector('[data-testid="primaryColumn"]');
        const v = scope?.querySelector('video');
        if (v && v.readyState >= 2 && !v.paused && v.currentTime > 0) r.videoPlayingAt = performance.now();
      }
    }, 25);
  }
  window.__r4arm = (cfg) => { r.cfg = cfg; if (cfg.autoStart) start(); };
  window.__r4reset = () => {
    r.clicks.length = 0; r.escapes.length = 0;
    r.t1 = null; r.t2 = null; r.escAt = null; r.closedAt = null; r.feedAt = null;
    r.preScrollY = null; r.restoredScrollY = null; r.scrollSamples.length = 0;
    r.anchorTop = null; r.anchorDelta = null;
    r.overlayFirstAt = null; r.paneFirstAt = null; r.bodyFirstAt = null; r.overlayFirstText = null;
    r.longtasks.length = 0; r.videoPlayingAt = null; r.videoScrollAt = null;
    r.marks = {}; r.started = false;
  };
  window.__r4mark = (name) => { r.marks[name] = performance.now(); };
})()`;

// ---------- page setup ----------
const PAGES_FILE = `${ROOT}/exploration-poc/r4/harness/.pages.json`;
// close leftovers from earlier runs/probes (the task space page budget is small)
let staleLabels = [];
try { staleLabels = JSON.parse(readFileSync(PAGES_FILE, "utf8")); } catch { /* first run */ }
for (const n of [...staleLabels, "p2", "p3", "p4", "p5", "p6", "p7", "p8", "p9", "p10", "p11", "p12"]) {
  try { await task.page(n).close(); console.log(`closed stale page ${n}`); } catch { /* absent */ }
}
const pages = {};
const createdLabels = [];
for (const cond of ["orig", "r1", "native"]) {
  const p = await task.newPage();
  createdLabels.push(p.label);
  await p.cdp("Emulation.setDeviceMetricsOverride", { ...VIEWPORT, deviceScaleFactor: 1, mobile: false });
  await p.cdp("Network.enable");
  await p.cdp("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER, runImmediately: true });
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
  } else if (cond === "r1") {
    const css = readFileSync(`${ROOT}/exploration-poc/mv3-poc/content.css`, "utf8");
    const js = readFileSync(`${ROOT}/exploration-poc/mv3-poc/content.js`, "utf8");
    const boot = `(function(){window.__PEEK_POC_TEST__=true;})();\n` +
      `(function(){function inj(){if(document.querySelector("style[data-peek-poc-css]"))return;var s=document.createElement("style");s.setAttribute("data-peek-poc-css","1");s.textContent=${JSON.stringify(css)};(document.head||document.documentElement||document).appendChild(s);}if(document.head||document.documentElement){inj();}else{document.addEventListener("DOMContentLoaded",inj,{once:true});}})();\n` + js;
    await p.cdp("Page.addScriptToEvaluateOnNewDocument", { source: boot, worldName: "peek-poc-r4", runImmediately: true });
  }
  pages[cond] = p;
}
writeFileSync(PAGES_FILE, JSON.stringify(createdLabels));
console.log("pages ready:", createdLabels.join(","));

try { // everything below runs with guaranteed page cleanup at the end

// ---------- helpers ----------
const evalMain = (p, expression, opts = {}) =>
  p.cdp("Runtime.evaluate", { expression, returnByValue: true, ...opts });
const page_wait = (p, ms) => p.waitForTimeout(ms);

async function quietThenDrain(p) {
  // drain until a window with no requests (background X traffic settles)
  for (let i = 0; i < QUIET_MAX_TRIES; i++) {
    const evts = await p.events();
    if (!evts.some((e) => e.method === "Network.requestWillBeSent")) return;
    await page_wait(p, 1200);
  }
  await p.events(); // last drain regardless
}

async function findAndClickSample(p, cond, sample) {
  // scroll the profile until the sample's timestamp link sits in the viewport,
  // then trusted-click at its center. X virtualizes the timeline (cells are
  // unmounted once far off-screen), so the scroll step must stay small enough
  // to catch the link inside the mounted band.
  for (let step = 0; step < FIND_MAX_STEPS; step++) {
    const tgt = await evalMain(p, `(() => {
      const id = ${JSON.stringify(sample.id)};
      for (const cell of document.querySelectorAll('[data-testid="cellInnerDiv"]')) {
        const a = [...cell.querySelectorAll('a[href*="/status/' + id + '"]')].find(x => x.querySelector("time"));
        if (!a) continue;
        const r = a.getBoundingClientRect();
        if (r.y < 80 || r.y > innerHeight - 80) break; // mounted but outside the band: scroll a little
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + Math.min(r.height, 300) / 2) };
      }
      return null;
    })()`);
    if (tgt.result.value) {
      const { x, y } = tgt.result.value;
      await p.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await p.cdp("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
      await p.cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
      return true;
    }
    await evalMain(p, `scrollBy(0, 400)`);
    await page_wait(p, 650);
  }
  const diag = await evalMain(p, `({ scrollY, cells: document.querySelectorAll('[data-testid="cellInnerDiv"]').length, path: location.pathname })()`);
  console.log(`find-diag ${cond}: ${JSON.stringify(diag.result.value)}`);
  return false;
}

async function scriptedWheelScroll(p) {
  for (let i = 0; i < 6; i++) {
    await p.cdp("Input.dispatchMouseEvent", { type: "mouseWheel", x: 720, y: 450, deltaX: 0, deltaY: 700 });
    await page_wait(p, 350);
  }
}

async function pressEsc(p) {
  await p.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await p.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
}

async function readRecorder(p) {
  const r = await evalMain(p, `(() => { const r = window.__r4; return r ? {
    clicks: r.clicks, escapes: r.escapes, t1: r.t1, t2: r.t2, escAt: r.escAt,
    closedAt: r.closedAt, feedAt: r.feedAt, preScrollY: r.preScrollY,
    overlayFirstAt: r.overlayFirstAt, paneFirstAt: r.paneFirstAt, bodyFirstAt: r.bodyFirstAt,
    overlayFirstText: r.overlayFirstText || null,
    restoredScrollY: r.restoredScrollY, anchorDelta: r.anchorDelta, longtasks: r.longtasks,
    videoPlayingAt: r.videoPlayingAt, videoScrollAt: r.videoScrollAt,
  } : null; })()`);
  return r.result.value;
}
async function readRouteDetect(p) {
  // the isolated world's JS hook is not reachable via Runtime.evaluate, so the
  // PoC mirrors the route-change timestamp onto <html> when the test hook is
  // armed (shared DOM); also reports which detection path is active
  const r = await evalMain(p, `(() => ({
    at: parseFloat(document.documentElement.getAttribute("data-peek-poc-route-change-at")) || -1,
    pane: Boolean(document.getElementById("peek-poc-pane")),
  }))()`);
  return r.result.value;
}

// ---------- scenario runner ----------
async function runWindow(cond, sampleKey, round) {
  const sample = SAMPLES[sampleKey];
  const p = pages[cond];
  const detailUrl = `https://x.com/${sample.author}/status/${sample.id}`;

  await p.cdp("Page.bringToFront"); // foreground: no timer throttling during measurement
  await p.goto(sample.profile);
  await page_wait(p, SETTLE_PROFILE_MS);
  await quietThenDrain(p);
  await evalMain(p, `window.__r4arm(${JSON.stringify({ cond, id: sample.id, handle: "/" + sample.author, authorName: sample.name, wantVideo: sampleKey === "video" })})`);
  await evalMain(p, `window.__r4reset()`);
  const clicked = await findAndClickSample(p, cond, sample);
  if (!clicked) {
    await p.events();
    console.log(`SKIP   r: sample cell not found on profile`); return { meta: { cond, sample: sampleKey, round, scenario: "spa" }, skipped: "sample cell not found on profile" };
  }
  await page_wait(p, SETTLE_READ_MS);

  // T5: identical scripted scroll + long tasks
  await evalMain(p, `__r4mark('scrollStart')`);
  await scriptedWheelScroll(p);
  await evalMain(p, `__r4mark('scrollEnd')`);

  // T3 booleans at settle
  const t3 = await evalMain(p, `(() => {
    const root = document.getElementById('tuzai-x-popover-root');
    const pane = document.getElementById('peek-poc-pane');
    const nativeComposer = Boolean(document.querySelector('[data-testid="primaryColumn"] [data-testid="tweetButtonInline"], [data-testid="primaryColumn"] [data-testid="tweetTextarea_0"]'));
    return {
      origTools: Boolean(root?.querySelector('.tuzai-reply-tools')),
      origComposer: Boolean(root?.querySelector('[data-testid="tweetTextarea_0"], [contenteditable="true"]')),
      paneActions: Boolean(pane?.querySelector('.peek-poc-actions')),
      nativeComposer,
      overlayOpen: Boolean(root),
      paneOpen: Boolean(pane),
    };
  })()`);

  // route detection latency must be read BEFORE the close — the mirror
  // attribute holds the LATEST route change, and the close's back-traverse
  // would overwrite the click's push
  const routeDetect = cond === "r1" ? await readRouteDetect(p) : null;

  // close: Esc (same user action for both Peek variants); native has no Esc
  // close — the reference close is browser back, fired right after
  await pressEsc(p);
  if (cond === "native") {
    await page_wait(p, 300);
    await evalMain(p, `history.back()`);
  }
  await page_wait(p, 5000); // traverse + restore window

  const rec = await readRecorder(p);

  // click-aligned network census: the profile was drained to QUIET right
  // before the click, so everything buffered now is post-click traffic
  const evts = await p.events();
  const requests = recordsFromEvents(evts);

  const clickAt = rec?.clicks?.[0]?.t ?? null;
  const escAt = rec?.escapes?.find((t) => clickAt !== null && t > clickAt) ?? null;
  const out = {
    meta: { cond, sample: sampleKey, round, scenario: "spa", url: detailUrl.replace("https://x.com", "x.com"), viewport: VIEWPORT },
    clickAt, escAt,
    t1: rec?.t1 != null && clickAt != null ? Math.round(rec.t1 - clickAt) : null,
    paint: clickAt != null ? { overlayFirstAt: rec?.overlayFirstAt != null ? Math.round(rec.overlayFirstAt - clickAt) : null, paneFirstAt: rec?.paneFirstAt != null ? Math.round(rec.paneFirstAt - clickAt) : null, bodyFirstAt: rec?.bodyFirstAt != null ? Math.round(rec.bodyFirstAt - clickAt) : null, snapText: cond === 'orig' ? (rec?.overlayFirstText || null) : undefined } : null,
    t2: rec?.t2 != null && clickAt != null ? Math.round(rec.t2 - clickAt) : null,
    t3: t3.result.value,
    t4: escAt != null ? {
      closedAt: rec?.closedAt != null ? Math.round(rec.closedAt - escAt) : null,
      feedAt: rec?.feedAt != null ? Math.round(rec.feedAt - escAt) : null,
      preScrollY: rec?.preScrollY ?? null,
      restoredScrollY: rec?.restoredScrollY ?? null,
      anchorDelta: rec?.anchorDelta ?? null,
      restored: rec?.anchorDelta != null ? Math.abs(rec.anchorDelta) <= 60
        : (rec?.restoredScrollY != null && rec?.preScrollY != null
          ? Math.abs(rec.restoredScrollY - rec.preScrollY) <= 2 : null),
    } : null,
    t5: {
      longtasks: rec?.longtasks || [],
      longtaskTotal: (rec?.longtasks || []).reduce((a, b) => a + b, 0),
      videoPlayingAt: rec?.videoPlayingAt != null && rec?.videoScrollAt != null
        ? Math.round(rec.videoPlayingAt - rec.videoScrollAt) : null,
    },
    routeDetect: routeDetect && clickAt != null && routeDetect.at > 0
      ? { pane: routeDetect.pane, detectMs: Math.round(routeDetect.at - clickAt) } : null,
    network: { requestCount: requests.length, requests },
  };
  writeFileSync(join(OUT, `spa-${cond}-${sampleKey}-r${round}.json`), JSON.stringify(out, null, 1));
  console.log(`spa ${cond} ${sampleKey} r${round}: paint=${JSON.stringify(out.paint)} t1=${out.t1} t2=${out.t2} t4closed=${out.t4?.closedAt ?? "-"} t4feed=${out.t4?.feedAt ?? "-"} restored=${out.t4?.restored ?? "-"} longtasks=${out.t5.longtasks.length} video=${out.t5.videoPlayingAt ?? "-"} net=${requests.length} detect=${out.routeDetect?.detectMs ?? "-"}`);
  return out;
}

let done = 0;
const SAMPLE_KEYS = SMOKE?.samples ?? Object.keys(SAMPLES);
const TOTAL_ROUNDS = SMOKE?.rounds ?? ROUNDS;
for (let round = 1; round <= TOTAL_ROUNDS; round++) {
  for (const sampleKey of SAMPLE_KEYS) {
    for (const cond of ORDERS[(round - 1) % ORDERS.length]) {
      try {
        await runWindow(cond, sampleKey, round);
      } catch (e) {
        console.log(`ERROR ${cond} ${sampleKey} r${round}: ${e.message}`);
      }
      done++;
    }
  }
}
console.log(`perf run complete: ${done} windows → ${OUT}`);
} finally {
  for (const l of createdLabels) { try { await task.page(l).close(); } catch { /* already gone */ } }
  try { unlinkSync(PAGES_FILE); } catch {}
}
