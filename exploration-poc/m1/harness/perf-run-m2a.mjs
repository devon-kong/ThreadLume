// ARCHIVAL METHOD: cells[1] can be a spacer, T2 can include unrelated tweets,
// and visibility is sampled after manual scrolling. Do not use this harness
// for acceptance; use perf-run-m2a-paired.mjs. Historical JSON is unchanged.
// M2-A performance harness — comments-first build vs the archived M1 baseline.
// Same method as R4 G1 (trusted CDP click = clock start, in-page 25ms recorder,
// foreground measurement, click-aligned windows, zero writes), single condition
// (m2a = current dist-extension-native (comments-first) injected isolated-world, L3 equivalent exactly
// like R4's r1 condition), 4 samples × 3 rounds.
// Evidence: exploration-poc/m1/evidence/perf/spa-m2a-{sample}-r{round}.json
// (same field names as R4 evidence so perf-compare math applies unchanged).
const ROOT = "/Users/devon/claude/peek-main";
const { mkdirSync, writeFileSync } = await import("node:fs");
const { join } = await import("node:path");

const OUT = join(ROOT, "exploration-poc", "m1", "evidence", "perf");
mkdirSync(OUT, { recursive: true });

const SAMPLES = {
  short: { id: "2109450990575611958", author: "gefei55", name: "哥飞", profile: "https://x.com/gefei55" },
  highReply: { id: "2109146979972403349", author: "XiaoJi0403", name: "老季", profile: "https://x.com/XiaoJi0403" },
  long: { id: "2107948362414866685", author: "z35001116", name: "Ace_Analyst", profile: "https://x.com/z35001116" },
  video: { id: "2109309251533570509", author: "thinkszyg", name: "爆裂队长NEXT", profile: "https://x.com/thinkszyg" },
};
const ROUNDS = 3;
const VIEWPORT = { width: 1440, height: 900 };
const SETTLE_PROFILE_MS = 7000;
const SETTLE_READ_MS = 6000;
const FIND_MAX_STEPS = 40;
const QUIET_MAX_TRIES = 6;

// ---------- in-page recorder (main world; native selectors) ----------
const RECORDER = `(() => {
  if (window.__m1) return;
  const r = window.__m1 = {
    clicks: [], escapes: [], t1: null, t2: null, escAt: null, closedAt: null,
    preScrollY: null, feedAt: null, restoredScrollY: null, scrollSamples: [],
    anchorTop: null, anchorDelta: null,
    longtasks: [], videoPlayingAt: null, videoScrollAt: null, marks: {},
    started: false, cfg: null,
  };
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    r.escapes.push(performance.now());
    if (r.escAt === null) r.escAt = performance.now();
  }, true);
  addEventListener('click', (e) => {
    r.clicks.push({ t: performance.now(), x: e.clientX, y: e.clientY });
    if (!r.started && r.cfg) {
      r.anchorTop = e.target?.closest?.('[data-testid="cellInnerDiv"]')?.getBoundingClientRect()?.top ?? null;
      start();
    }
  }, true);
  addEventListener('wheel', () => { if (r.cfg?.wantVideo && r.videoScrollAt === null) r.videoScrollAt = performance.now(); }, { passive: true, capture: true });
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) r.longtasks.push(Math.round(e.duration)); })
      .observe({ entryTypes: ['longtask'] });
  } catch {}

  function paneState() {
    const p = document.getElementById('peek-native-pane');
    if (!p) return null;
    return {
      id: p.dataset.statusId,
      text: (p.querySelector('.peek-native-text')?.innerText || '').trim(),
      unknown: Boolean(p.querySelector('.peek-native-unknown')),
      author: (p.querySelector('.peek-native-author span')?.innerText || '').replace(/^@/, ''),
    };
  }
  function t1Holds() {
    const cfg = r.cfg || {};
    const p = paneState();
    if (!p || p.unknown) return false;
    return p.id === cfg.id && p.text.length > 0 && p.author === (cfg.handle || '').replace('/', '');
  }
  function t2Holds() {
    const cells = [...document.querySelectorAll('[data-testid="primaryColumn"] [data-testid="cellInnerDiv"]')];
    return cells.length >= 2 && cells.slice(1).some((c) =>
      ((c.querySelector('article [data-testid="tweetText"]')?.innerText) || '').trim().length > 0);
  }
  function feedInteractive() {
    const cfg = r.cfg || {};
    if (location.pathname.includes('/status/')) return false;
    const id = cfg.id;
    const cell = [...document.querySelectorAll('[data-testid="cellInnerDiv"]')].find((c) =>
      [...c.querySelectorAll('a[href*="/status/' + id + '"]')].some((a) => a.querySelector("time") && !a.closest('div[role="link"]')));
    if (!cell) return false;
    r.scrollSamples.push(scrollY);
    const s = r.scrollSamples;
    if (s.length >= 4) {
      const tail = s.slice(-4);
      if (Math.max(...tail) - Math.min(...tail) <= 1) {
        r.restoredScrollY = scrollY;
        r.anchorDelta = cell && r.anchorTop != null ? Math.round(cell.getBoundingClientRect().top - r.anchorTop) : null;
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
      if (r.escAt !== null && r.closedAt === null) {
        if (!document.getElementById('peek-native-pane')) r.closedAt = performance.now();
      }
      if (r.escAt !== null && r.feedAt === null && feedInteractive()) r.feedAt = performance.now();
      if (r.cfg?.wantVideo && r.videoScrollAt !== null && r.videoPlayingAt === null) {
        const v = document.querySelector('[data-testid="primaryColumn"] video');
        if (v && v.readyState >= 2 && !v.paused && v.currentTime > 0) r.videoPlayingAt = performance.now();
      }
    }, 25);
  }
  window.__m1arm = (cfg) => { r.cfg = cfg; };
  window.__m1reset = () => {
    r.clicks.length = 0; r.escapes.length = 0;
    r.t1 = null; r.t2 = null; r.escAt = null; r.closedAt = null;
    r.feedAt = null; r.preScrollY = null; r.restoredScrollY = null; r.scrollSamples.length = 0;
    r.anchorTop = null; r.anchorDelta = null;
    r.longtasks.length = 0; r.videoPlayingAt = null; r.videoScrollAt = null;
    r.marks = {}; r.started = false;
  };
  window.__m1mark = (name) => { r.marks[name] = performance.now(); };
  window.__m1read = () => ({ clicks: r.clicks, escapes: r.escapes, t1: r.t1, t2: r.t2, escAt: r.escAt,
    closedAt: r.closedAt, feedAt: r.feedAt, preScrollY: r.preScrollY, restoredScrollY: r.restoredScrollY,
    anchorTop: r.anchorTop, anchorDelta: r.anchorDelta, longtasks: r.longtasks,
    videoPlayingAt: r.videoPlayingAt, videoScrollAt: r.videoScrollAt, marks: r.marks });
})()`;

// ---------- setup ----------
const task = await taskSpace(17);
const page = task.page("p1");
await page.cdp("Emulation.setDeviceMetricsOverride", { ...VIEWPORT, deviceScaleFactor: 1, mobile: false });
await page.cdp("Network.enable");

// native build: isolated world auto-inject (L3 equivalent, same as R4 r1 condition)
const H = await import(`${ROOT}/exploration-poc/m1/harness/m1-harness.mjs`);

// ORDER MATTERS (R4 method): the main-world recorder must be registered BEFORE
// the native build's isolated world. The native Esc handler stops immediate
// propagation after closing the reader; a later-registered main-world capture
// listener would never see the Escape (and a blind retry Esc would then hit
// B3's user-input cancel guard, cancelling the anchor restore).
await page.cdp("Page.addScriptToEvaluateOnNewDocument", { source: RECORDER, runImmediately: true });
await H.registerNative(page);

const evalMain = (expression) => page.cdp("Runtime.evaluate", { expression, returnByValue: true }).then((r) => r.result.value);
const wait = (ms) => page.waitForTimeout(ms);

// network events are recorded by the separate census run; here we only drain.
async function quietThenDrain() {
  for (let i = 0; i < QUIET_MAX_TRIES; i++) {
    const evts = await page.events();
    if (!evts.some((e) => e.method === "Network.requestWillBeSent")) return;
    await wait(1200);
  }
  await page.events();
}

async function findSampleCell(sample) {
  for (let step = 0; step < FIND_MAX_STEPS; step++) {
    const tgt = await evalMain(`(() => {
      const id = ${JSON.stringify(sample.id)};
      for (const cell of document.querySelectorAll('[data-testid="cellInnerDiv"]')) {
        const a = [...cell.querySelectorAll('a[href*="/status/' + id + '"]')].find(x => x.querySelector("time") && !x.closest('div[role="link"]'));
        if (!a) continue;
        const r = a.getBoundingClientRect();
        if (r.y < 80 || r.y > innerHeight - 80) break;
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + Math.min(r.height, 300) / 2) };
      }
      return null;
    })()`);
    if (tgt) return tgt;
    await evalMain(`scrollBy(0, 400)`);
    await wait(650);
  }
  return null;
}

async function clickCoords({ x, y }) {
  await page.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await page.cdp("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await page.cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}
async function pressEsc() {
  await page.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await page.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
}
async function scriptedWheelScroll() {
  for (let i = 0; i < 6; i++) {
    await page.cdp("Input.dispatchMouseEvent", { type: "mouseWheel", x: 720, y: 450, deltaX: 0, deltaY: 700 });
    await wait(350);
  }
}

// ---------- scenario runner ----------
const skipped = [];
for (let round = 1; round <= ROUNDS; round++) {
  for (const key of Object.keys(SAMPLES)) {
    const sample = SAMPLES[key];
    await page.cdp("Page.bringToFront");
    await page.goto(sample.profile);
    await wait(SETTLE_PROFILE_MS);
    await evalMain(`window.__m1arm(${JSON.stringify({ id: sample.id, handle: "/" + sample.author, authorName: sample.name, wantVideo: key === "video" })})`);
    await evalMain(`window.__m1reset()`);
    const coords = await findSampleCell(sample);
    if (!coords) {
      await page.events();
      skipped.push({ sample: key, round, why: "cell not found" });
      console.log(`SKIP m1 ${key} r${round}: cell not found`);
      continue;
    }
    await quietThenDrain();
    await clickCoords(coords);
    let opened = await evalMain(`(() => ({ pane: Boolean(document.getElementById('peek-native-pane')), path: location.pathname }))()`).then(v => v.pane || v.path.includes("/status/"));
    let retried = false;
    if (!opened) {
      retried = true;
      const c2 = await findSampleCell(sample);
      if (c2) { await clickCoords(c2); opened = await evalMain(`(() => ({ pane: Boolean(document.getElementById('peek-native-pane')), path: location.pathname }))()`).then(v => v.pane || v.path.includes("/status/")); }
    }
    if (!opened) {
      await page.events();
      skipped.push({ sample: key, round, why: "surface did not open" });
      console.log(`SKIP m1 ${key} r${round}: surface did not open`);
      continue;
    }
    await wait(SETTLE_READ_MS);

    await evalMain(`__m1mark('scrollStart')`);
    await scriptedWheelScroll();
    await evalMain(`__m1mark('scrollEnd')`);

    const t3 = await evalMain(`(() => {
      const pane = document.getElementById('peek-native-pane');
      const nativeComposer = Boolean(document.querySelector('[data-testid="primaryColumn"] [data-testid="tweetButtonInline"], [data-testid="primaryColumn"] [data-testid="tweetTextarea_0"]'));
      return { paneActions: Boolean(pane?.querySelector('.peek-native-actions')), nativeComposer, paneOpen: Boolean(pane) };
    })()`);

    const routeDetect = await evalMain(`(() => ({
      at: parseFloat(document.documentElement.getAttribute("data-peek-native-route-change-at")) || -1,
      pane: Boolean(document.getElementById("peek-native-pane")),
    }))()`);
    // M2-A: comments-first decision + reply visibility while the reader is open
    const cfState = await evalMain(`(() => {
      const cf = document.documentElement.getAttribute("data-peek-cf");
      return { cf: cf ? JSON.parse(cf) : null };
    })()`).catch(() => ({ cf: null }));
    const cfReply = await evalMain(`(() => {
      const vh = innerHeight;
      const cells = [...document.querySelectorAll('[data-testid="primaryColumn"] [data-testid="cellInnerDiv"]')];
      if (!document.getElementById('peek-native-pane')) return null;
      const focal = cells[0];
      const reply = cells[1];
      if (!focal || !reply) return null;
      const rr = reply.getBoundingClientRect();
      return { replyTop: Math.round(rr.top), replyVisiblePct: Math.max(0, Math.round((vh - Math.max(rr.top, 0)) / vh * 100)) };
    })()`).catch(() => null);

    // Esc press with pane-removal confirmation: stop the moment the reader
    // actually closes — an extra keydown would hit B3's user-input cancel
    // guard and cancel the anchor restore (measured in M1-D diagnosis).
    let escRetries = 0;
    for (let attempt = 0; attempt < 5; attempt++) {
      await pressEsc();
      await wait(400);
      const paneGone = await evalMain(`!document.getElementById('peek-native-pane')`);
      if (paneGone) break;
      escRetries++;
    }
    // T4 + B3: feed-interactive comes from the recorder; the B3 adjustment may
    // land up to ~2.5s later — sample the cell top afterwards and record the
    // FINAL viewport delta too. Wait for the pane to actually close first.
    let closeWait = 0;
    for (let i = 0; i < 20; i++) {
      await wait(300);
      closeWait += 300;
      const p = await evalMain(`Boolean(document.getElementById('peek-native-pane'))`);
      if (!p) break;
    }
    const rec = await evalMain(`window.__m1read()`);
    const finalTops = [];
    for (let i = 0; i < 10; i++) {
      await wait(300);
      finalTops.push(await evalMain(`(() => {
        const id = ${JSON.stringify(sample.id)};
        const cell = [...document.querySelectorAll('[data-testid="cellInnerDiv"]')].find((c) =>
          [...c.querySelectorAll('a[href*="/status/' + id + '"]')].some((a) => a.querySelector("time") && !a.closest('div[role="link"]')));
        return cell ? Math.round(cell.getBoundingClientRect().top) : null;
      })()`));
    }
    const anchorFinal = rec.anchorTop != null && finalTops[finalTops.length - 1] != null
      ? finalTops[finalTops.length - 1] - rec.anchorTop : null;

    const record = {
      meta: { cond: "m2a", sample: key, round, scenario: "spa", url: `x.com/${sample.author}/status/${sample.id}`, viewport: VIEWPORT, clickRetried: retried, escRetries },
      commentsFirst: cfState?.cf ?? null,
      replyVisibilityAtSettle: cfReply,
      clicks: rec.clicks, clickAt: rec.clicks[0]?.t ?? null,
      escAt: rec.escAt, t1: rec.t1, t2: rec.t2,
      t1Rel: rec.t1 !== null && rec.clicks[0] ? rec.t1 - rec.clicks[0].t : null,
      t2Rel: rec.t2 !== null && rec.clicks[0] ? rec.t2 - rec.clicks[0].t : null,
      paint: { paneFirstAt: rec.t1, bodyFirstAt: rec.t1 },
      t3, t4: {
        closedAt: rec.closedAt !== null ? rec.closedAt - (rec.escAt ?? rec.closedAt) : null,
        feedAt: rec.feedAt !== null ? rec.feedAt - (rec.escAt ?? rec.feedAt) : null,
        preScrollY: rec.preScrollY, restoredScrollY: rec.restoredScrollY,
        anchorDelta: rec.anchorDelta, anchorTop: rec.anchorTop, restored: rec.feedAt !== null,
      },
      t5: { longtasks: rec.longtasks, longtaskTotal: rec.longtasks.reduce((a, b) => a + b, 0), videoPlayingAt: rec.videoPlayingAt !== null ? rec.videoPlayingAt - (rec.videoScrollAt ?? rec.videoPlayingAt) : null, videoScrollAt: rec.videoScrollAt },
      routeDetect: routeDetect.at >= 0 && rec.clicks[0] ? routeDetect.at - rec.clicks[0].t : null,
      anchorB3: { finalTops, finalDelta: anchorFinal, targetMaxPx: 60 },
    };
    writeFileSync(join(OUT, `spa-m2a-${key}-r${round}.json`), JSON.stringify(record, null, 1));
    console.log(`OK m1 ${key} r${round}: t1Rel=${record.t1Rel?.toFixed(0)} t2Rel=${record.t2Rel?.toFixed(0)} t4closed=${record.t4.closedAt?.toFixed(0)} t4feed=${record.t4.feedAt?.toFixed(0)} anchor=${record.t4.anchorDelta} anchorB3=${anchorFinal} route=${record.routeDetect?.toFixed(1)} escRetries=${escRetries}`);
  }
}
console.log("skipped:", JSON.stringify(skipped));
console.log("DONE perf run");
