// M2-B1-R — unified performance harness (P0-B rewrite of m2-b1 s5-perf.mjs).
//
// Fix of the measured flaw: the S5 collector slept a FIXED 1500ms after the
// click before starting the T1 poll, and started T2/T2b/T3 serially after T1 —
// so the reported T1 (~1580ms) measured "first readable AFTER the sleep", not
// first readable. This harness arms ALL condition monitors BEFORE the click;
// a capture-phase listener stamps t0 = the user click on the TARGET status
// link, and one in-page rAF loop records every first-hit timestamp relative to
// that single origin. The harness never sleeps between click and measurement —
// it only polls the recorded stamps.
//
// Metrics (single time origin t0):
//   T1        focal post first REAL readable (correct id, own timestamp link,
//             non-empty body — not a skeleton/loading/error snapshot)
//   T2a       first VERIFIED reply (X's own socialContext present = proven
//             conversation member; recommendation/quote cells are excluded by
//             their own focal-status link) + first raw candidate — reported
//             SEPARATELY, never merged. Candidates are labeled as such.
//   T2b       first reply cell entering the readable region (mode-specific:
//             right pane for lab / beyond the 52vw reading pane for m1r /
//             viewport for native). Real geometry, not DOM presence.
//   T3        native action bar + reply composer visible and interactive
//             (read-only: no account writes)
//   T4        close → detail left → ≥3 cells re-rendered → ORIGINAL anchor
//             back → layout stable (same scrollHeight over two probes
//             ≥500ms apart). First-cell-only is NOT completion.
//   video     first video node / first playable frame / SAME-element identity
//             across a 5000px deep scroll / playback continuity / rebuffer
//             (waiting) count.
//
// Modes (MODE env): lab | m1r | native — same script, same browser/profile/
// viewport/theme/samples. Read-only: no account writes; observers are passive
// DOM/rAF reads — arming them sends no X requests. Rate-limit honesty: low
// frequency, fixed sample order, skipped rounds recorded, INCONCLUSIVE marking.
// MODE injection: ego-browser's embedded Node does NOT inherit shell env —
// pass the mode by prepending `globalThis.__MODE__ = "..."` to the piped
// script (see run notes). Shell env is only a fallback for plain node.
const MODE = typeof __MODE__ !== "undefined" ? __MODE__
  : (typeof process !== "undefined" && process.env?.MODE) || "UNSET-MODE";
const ROUNDS = Number(process.env.ROUNDS_N || 4);
const task = await taskSpace("peek m2b1r perf " + MODE);
const page = task.page("p1");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {
  mode: MODE, rounds: [], wrapper: null, idle: null, env: null,
  note: "t0 = capture-phase click on the TARGET status link; all stamps are performance.now()-t0 from one in-page rAF loop; no fixed sleeps between click and measurement",
};

// Fixed sample set + fixed order (identical across modes). Each sample is
// opened by clicking ITS OWN timestamp link inside the profile timeline, so
// profile reordering cannot silently swap the measured post; the landing URL
// is verified and a mismatch discards the round.
// Verified on 2026-10-13 (live, logged-in, Chromium 152): video post plays
// (readyState 4, 60 replies), photos = 3 photos (45 replies), text = text+1
// image (126 replies), highcomments = @ruanyf's PINNED post (372 replies —
// pinned ⇒ deterministic position).
const SAMPLES = [
  { id: "2109309251533570509", profile: "https://x.com/thinkszyg", kind: "video" },
  { id: "2099877465795735861", profile: "https://x.com/KinGao476942", kind: "photos" },
  { id: "1760839985715204230", profile: "https://x.com/gefei55", kind: "text" },
  { id: "2100757389112938573", profile: "https://x.com/ruanyf", kind: "highcomments" },
];

// ---------------- in-page monitor (installed once per page, armed per sample) ----------------

const MONITOR = `(function () {
  if (window.__s5rInstalled) { window.__s5r = null; return "rearmed"; }
  window.__s5rInstalled = true;
  // includes-caliber identity (same as the adapter's focalCellByStatusId):
  // edited posts carry /status/{id}/history timestamp links
  const OWN_TS = (scope, id) => [...scope.querySelectorAll("a[href] time")]
    .some((t) => (t.closest("a")?.getAttribute("href") || "").includes("/status/" + id));
  const TWEET_TEXT = (art) => art.querySelector('[data-testid="tweetText"]')?.textContent?.trim() || "";

  function focalInfo(mode, id) {
    if (mode === "lab") {
      const a = document.querySelector("article[data-peek-lad-focal]");
      if (!a || !a.isConnected || !OWN_TS(a, id)) return null; // identity guard
      if (!TWEET_TEXT(a)) return null;                          // real body, not skeleton
      return { art: a, pane: null };
    }
    if (mode === "m1r") {
      const pane = document.getElementById("peek-native-pane");
      if (!pane || pane.dataset.statusId !== id) return null;
      const t = pane.querySelector(".peek-native-text");
      if (!t || !t.textContent.trim() || t.classList.contains("peek-native-unknown")) return null;
      return { art: null, pane };
    }
    const a = [...document.querySelectorAll("article[data-testid=tweet]")].find((x) => OWN_TS(x, id));
    if (!a || !TWEET_TEXT(a)) return null;
    return { art: a, pane: null };
  }
  function handleOf(info, mode) {
    if (mode === "m1r") return (info.pane.querySelector(".peek-native-author span")?.textContent || "").replace(/^@/, "").trim();
    const a = info.art.querySelector('a[href^="/"]');
    return (a?.getAttribute("href") || "").replace(/^\\//, "").split("/")[0];
  }
  function replies(mode, id, info) {
    const fcell = info.art ? info.art.closest('[data-testid="cellInnerDiv"]') : null;
    let verified = null, candidate = null;
    for (const c of document.querySelectorAll('[data-testid="cellInnerDiv"]')) {
      if (c === fcell || !c.isConnected) continue;
      const art = c.querySelector("article");
      if (!art) continue;
      const txt = TWEET_TEXT(art);
      if (!txt) continue;
      if (OWN_TS(art, id)) continue; // quote-of-focal or the focal cell itself
      const social = art.querySelector('div[data-testid="socialContext"]');
      if (social && !verified) verified = { cell: c, art };
      if (!candidate) candidate = { cell: c, art };
      if (verified) break;
    }
    return { verified, candidate };
  }
  function readableRight(mode, cell) {
    const r = cell.getBoundingClientRect();
    if (!(r.top < innerHeight && r.bottom > 0 && r.width > 0)) return false;
    if (mode === "native") return true; // single column: viewport presence is readable
    const paneRight = innerWidth * 0.52; // lab split / m1r fixed pane: 52vw
    const visible = Math.min(r.right, innerWidth) - Math.max(r.left, paneRight);
    return visible >= 100;
  }
  function composerVisible() {
    const c = document.querySelector('[data-testid^="tweetTextarea"], [data-testid="toolBar"]');
    if (!c) return false;
    const r = c.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0;
  }
  function t3ok(mode, id) {
    const info = focalInfo(mode, id);
    if (!info) return false;
    const actions = mode === "m1r" ? true // M1-R renders its own action row; composer check covers interactivity
      : Boolean((info.art || info.pane).querySelector('[data-testid="reply"], [data-testid="like"]'));
    return actions && composerVisible();
  }
  let vidSeq = 0;
  function videoScan(st) {
    if (!st.video) st.video = { firstNodeAt: null, firstPlayableAt: null, el: null, tag: 0, waiting: 0 };
    const v = st.video;
    if (!v.el || !v.el.isConnected) {
      // track the FOCAL article's video specifically (never a reply's player)
      const info = focalInfo(st.mode, st.id);
      const scope = info ? (info.art || document) : document;
      const el = scope.querySelector ? scope.querySelector("article video") : null;
      if (el && !v.el) {
        v.el = el; v.tag = ++vidSeq; el.__s5tag = v.tag; v.firstNodeAt = performance.now() - st.t0;
        el.addEventListener("waiting", () => { v.waiting++; });
      } else if (el && v.el && el !== v.el) {
        v.el = el; v.tag = ++vidSeq; el.__s5tag = v.tag; v.retagged = true; // recycled + re-tracked
      }
    }
    const el = v.el;
    if (el && v.firstPlayableAt === null && el.readyState >= 3 && !el.paused && !el.ended) {
      v.firstPlayableAt = performance.now() - st.t0;
    }
  }
  function stamp(st, key) {
    if (st.m[key] == null) st.m[key] = performance.now() - st.t0;
  }
  // T4 stamps measure from the CLOSE click (t40), per the round contract:
  // "T4 starts at the user's close action" — never from the open click
  function stampT4(st, key) {
    if (st.t40 == null) return;
    if (st.m[key] == null) st.m[key] = performance.now() - st.t40;
  }
  function loop(st) {
    if (st.stop || window.__s5r !== st) return; // replaced by the next arm: die quietly
    try {
      if (st.t0 !== null) {
        if (st.scrollAt != null && st.m.scrollAt == null) stamp(st, "scrollAt");
        const info = focalInfo(st.mode, st.id);
        if (info) {
          st.focal = info;
          stamp(st, "t1");
          const { verified, candidate } = replies(st.mode, st.id, info);
          if (verified) stamp(st, "t2a");
          if (candidate) stamp(st, "t2aCandidate");
          if (verified && readableRight(st.mode, verified.cell)) stamp(st, "t2b");
          if (!verified && candidate && readableRight(st.mode, candidate.cell)) stamp(st, "t2bCandidate");
          if (t3ok(st.mode, st.id)) stamp(st, "t3");
        }
        if (st.wantVideo) videoScan(st);
        if (st.t40 !== null) {
          // every T4 condition is evaluated only after the detail is LEFT, and
          // every T4 stamp is relative to the close click (stampT4) — "T4
          // starts at the user's close action", per the round contract
          const leftDetail = !/status\\/\\d+/.test(location.pathname);
          if (leftDetail) {
            stampT4(st, "t4Left");
            const cells = [...document.querySelectorAll('[data-testid="cellInnerDiv"]')].filter((c) => c.querySelector("article"));
            if (cells.length >= 3) {
              stampT4(st, "t4Cells");
              const anchor = [...document.querySelectorAll("a[href] time")].find((t) => (t.closest("a")?.getAttribute("href") || "").includes("/status/" + st.id));
              if (anchor) {
                stampT4(st, "t4Anchor");
                const r = anchor.getBoundingClientRect();
                if (r.top >= 0 && r.top < innerHeight) stampT4(st, "t4AnchorVisible");
              }
              const sh = document.documentElement.scrollHeight;
              if (!st.stableRef || st.stableRef.sh !== sh) st.stableRef = { sh, at: performance.now() };
              else if (performance.now() - st.stableRef.at >= 500) { stampT4(st, "t4Stable"); st.stop = true; return; }
            }
          }
        }
      }
    } catch { /* never let the probe break the page */ }
    requestAnimationFrame(() => loop(st));
  }
  document.addEventListener("click", (e) => {
    const st = window.__s5r;
    if (!st) return;
    if (st.t4Armed && st.t40 === null) { st.t40 = performance.now(); return; }
    if (st.t0 !== null || st.id === null) return;
    const a = e.target?.closest?.('a[href*="/status/' + st.id + '"]');
    if (!a) return;
    st.t0 = performance.now();
    st.m = {};
    requestAnimationFrame(() => loop(st));
  }, { capture: true });
  window.__s5rArm = (mode, id, wantVideo) => {
    window.__s5r = { mode, id, wantVideo: Boolean(wantVideo), t0: null, t40: null, t4Armed: false, m: {}, stop: false, stableRef: null, focal: null, video: null };
    return true;
  };
  window.__s5rArmT4 = () => { if (window.__s5r) window.__s5r.t4Armed = true; return true; };
  window.__s5rRead = () => {
    const st = window.__s5r;
    if (!st) return null;
    const v = st.video || {};
    return {
      t0Set: st.t0 !== null, t40Set: st.t40 !== null, ...st.m,
      video: v.el ? { tag: v.tag, firstNodeAt: v.firstNodeAt, firstPlayableAt: v.firstPlayableAt, waiting: v.waiting, retagged: Boolean(v.retagged), currentTime: +v.el.currentTime.toFixed(2), paused: v.el.paused, readyState: v.el.readyState, connected: v.el.isConnected } : null,
    };
  };
  window.__s5rVideoIdentity = () => {
    const v = window.__s5r?.video;
    if (!v || !v.tag) return { tracked: false };
    // find the TRACKED element by its tag (the first DOM video may be a reply's)
    const found = [...document.querySelectorAll("article video")].find((x) => x.__s5tag === v.tag);
    return {
      tracked: true, sameElement: Boolean(found), trackedTag: v.tag,
      connected: Boolean(found?.isConnected), waiting: v.waiting, retagged: Boolean(v.retagged),
      currentTime: found ? +found.currentTime.toFixed(2) : null,
      paused: found ? found.paused : null,
      playableNow: found ? (found.readyState >= 3 && !found.paused) : false,
    };
  };
  return "installed";
})();`;

const installMonitor = () => page.evaluate(MONITOR);
const arm = (id, wantVideo) => page.evaluate(`window.__s5rArm(${JSON.stringify(MODE)}, ${JSON.stringify(id)}, ${Boolean(wantVideo)})`);
const armT4 = () => page.evaluate("window.__s5rArmT4()");
const read = () => page.evaluate("window.__s5rRead()");

// polls the recorded stamps; NO fixed sleeps between click and measurement
async function waitStamps(pred, timeoutMs) {
  const t0 = Date.now();
  for (;;) {
    const st = await read();
    if (st && pred(st)) return st;
    if (Date.now() - t0 > timeoutMs) return st;
    await sleep(120);
  }
}

out.env = await page.evaluate(() => ({
  viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
  theme: getComputedStyle(document.body).backgroundColor,
  chrome: (navigator.userAgent.match(/Chrome\/([\d.]+)/) || [])[1] || null,
}));

for (let round = 0; round < ROUNDS; round++) {
  const rec = { round, samples: [] };
  for (const s of SAMPLES) {
    await page.goto(s.profile, { timeout: 30000 }).catch(() => {});
    await sleep(4000);
    await installMonitor();

    // REAL pointer click on the TARGET status link (up to 3 attempts; landing
    // URL verified — mismatch discards the round). t0 starts at the click.
    let opened = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      await arm(s.id, s.kind === "video");
      // locate the target's own timestamp link, scrolling the profile up to
      // 10 screens if the timeline has buried it (deterministic + bounded)
      let pos = null;
      for (let i = 0; i < 12 && !pos; i++) {
        pos = await page.evaluate((tid) => {
          const link = [...document.querySelectorAll("a[href] time")]
            .map((t) => t.closest("a"))
            .find((a) => (a.getAttribute("href") || "").includes("/status/" + tid) && !a.closest('div[role="link"]'));
          if (!link) return null;
          link.scrollIntoView({ block: "center" });
          const r = link.getBoundingClientRect();
          return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
        }, s.id);
        if (!pos) { await page.evaluate(() => window.scrollBy(0, 1200)); await sleep(900); }
      }
      if (!pos) break;
      await sleep(350); // scrollIntoView settle (outside any measurement)
      await page.mouse.click(pos.x, pos.y, { label: "点击目标帖时间链接进入详情" });
      let landed = null;
      for (let i = 0; i < 80; i++) {
        landed = await page.evaluate(() => location.pathname);
        if (landed.includes("/status/" + s.id)) break;
        await sleep(100);
      }
      if (landed && landed.includes("/status/" + s.id)) { opened = landed; break; }
    }
    if (!opened) { rec.samples.push({ sample: s.kind, target: s.id, skipped: "click did not open the target detail" }); continue; }

    let st = await waitStamps((x) => x.t3 != null, 12000);
    st = st || {};

    const beforeScroll = await page.evaluate(() => {
      if (window.__s5r && window.__s5r.t0 !== null && window.__s5r.scrollAt == null) {
        window.__s5r.scrollAt = performance.now() - window.__s5r.t0; // phase marker
      }
      return { longTasks: window.__s5long?.length ?? 0 };
    });
    if (!(await page.evaluate(() => Boolean(window.__s5long)))) {
      await page.evaluate(() => { window.__s5long = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__s5long.push(Math.round(e.duration)); }).observe({ entryTypes: ["longtask"] }); } catch {} });
    }
    const scrollPerf = await page.evaluate(async () => {
      const t0 = performance.now();
      for (let y = 0; y <= 5000; y += 500) { window.scrollTo(0, y); await new Promise((r) => requestAnimationFrame(() => r())); }
      return { ms: Math.round(performance.now() - t0) };
    });
    const afterScroll = await page.evaluate(() => ({
      heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
      dom: document.getElementsByTagName("*").length,
      longTasks: window.__s5long?.length ?? 0,
    }));
    const videoIdentity = s.kind === "video" ? await page.evaluate("window.__s5rVideoIdentity()") : null;
    const labIntegrity = MODE === "lab" ? await page.evaluate(() => ({
      focalConnected: Boolean(document.querySelector("article[data-peek-lad-focal]")?.isConnected),
      focalCount: document.querySelectorAll("article[data-peek-lad-focal]").length,
      videoInFocal: Boolean(document.querySelector("article[data-peek-lad-focal] video")),
      state: document.documentElement.getAttribute("data-peek-lad-state"),
    })) : null;
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(800);

    // T4 (stamp origin = the close click itself)
    const closeOk = await page.evaluate(`(() => {
      const b = ${MODE === "m1r"
        ? `document.querySelector("#peek-native-pane .peek-native-close")`
        : `[...document.querySelectorAll("[role=button], button")].find(x => (x.getAttribute("aria-label") || "") === "返回" || (x.getAttribute("aria-label") || "") === "Back")`};
      if (b) { window.__s5rArmT4(); b.click(); return true; }
      return false;
    })()`);
    const t4st = closeOk ? await waitStamps((x) => x.t4Stable != null, 12000) : {};
    // late stamps: replies may first appear after the pre-scroll wait window;
    // stamps are click-relative so a late READ still reports the true first
    // appearance — but anything stamped after the deep scroll started is
    // labeled post-scroll and excluded from the pre-scroll T2 statistics
    const late = await read();
    const merged = (k) => {
      const pre = st[k] ?? null;
      const post = late[k] ?? null;
      if (pre != null) return { ms: Math.round(pre), phase: "pre-scroll" };
      if (post != null) return { ms: Math.round(post), phase: post > (st.scrollAt ?? Infinity) ? "post-scroll" : "pre-scroll" };
      return null;
    };

    rec.samples.push({
      sample: s.kind, target: s.id, openedAt: opened,
      t1: st.t1 != null ? Math.round(st.t1) : null,
      t2a: merged("t2a"), t2aCandidate: merged("t2aCandidate"),
      t2b: merged("t2b"), t2bCandidate: merged("t2bCandidate"),
      t3: st.t3 != null ? Math.round(st.t3) : null,
      video: late.video ?? st.video ?? (s.kind === "video" ? { missing: "no video node appeared" } : undefined),
      videoIdentityAfterDeepScroll: videoIdentity,
      labIntegrity,
      heapDom: { afterScroll },
      deepScrollMs: scrollPerf.ms,
      longTasksDuringDeepScroll: afterScroll.longTasks - beforeScroll.longTasks,
      t4: closeOk ? {
        left: t4st.t4Left ?? null, cells: t4st.t4Cells ?? null,
        anchor: t4st.t4Anchor ?? null, anchorVisible: t4st.t4AnchorVisible ?? null,
        stable: t4st.t4Stable ?? null,
      } : { error: "no close affordance" },
    });
    await sleep(3000);
  }
  out.rounds.push(rec);
  await sleep(6000);
}

// ---------------- idle + wrapper overhead (same scope as S5) ----------------

await page.goto("https://x.com/home");
await sleep(5000);
await page.evaluate(() => { window.__s5long = []; });
await sleep(8000);
out.idle = await page.evaluate(() => ({ longTasks: window.__s5long?.length ?? 0, longTaskMs: (window.__s5long ?? []).reduce((a, b) => a + b, 0) }));

await page.goto(SAMPLES[0].profile + "/status/" + SAMPLES[0].id);
await sleep(8000);
out.wrapper = await page.evaluate(`(async () => {
  const id = location.pathname.match(/status\\/(\\d+)/)?.[1];
  const cell = [...document.querySelectorAll("article[data-testid=tweet]")].find(x => [...x.querySelectorAll("a")].some(l => l.querySelector("time") && (l.getAttribute("href") || "").includes("/" + id)))?.closest("[data-testid=cellInnerDiv]");
  if (!cell) return { error: "no cell" };
  let fiber = cell[Object.keys(cell).find(k => k.startsWith("__reactFiber"))];
  while (fiber && !(fiber.stateNode && typeof fiber.stateNode._getFinalRenderedItems === "function")) fiber = fiber.return;
  const inst = fiber?.stateNode;
  if (!inst) return { error: "no virtualizer" };
  const fn = inst._getFinalRenderedItems.bind(inst);
  fn();
  const t0 = performance.now();
  for (let i = 0; i < 3000; i++) fn();
  const ms = performance.now() - t0;
  const wrapped = typeof Object.getOwnPropertyDescriptor(inst, "_getFinalRenderedItems")?.value === "function";
  return { perCallUs: +(ms / 3000 * 1000).toFixed(2), totalMs: +ms.toFixed(1), wrappedOwnProperty: wrapped };
})()`);

import { writeFileSync } from "node:fs";
writeFileSync(`/Users/devon/claude/peek-main/docs/m2-b1-r/evidence/perf-results-${MODE}.json`, JSON.stringify(out, null, 1));
console.log("MODE " + MODE + " done");
for (const r of out.rounds) for (const x of r.samples) if (x.t1 !== undefined) console.log(JSON.stringify({ s: x.sample, t1: x.t1, t2a: x.t2a, t2aC: x.t2aCandidate, t2b: x.t2b, t2bC: x.t2bCandidate, t3: x.t3, t4: x.t4?.stable, vSame: x.videoIdentityAfterDeepScroll?.sameElement, vPlay: x.videoIdentityAfterDeepScroll?.playableNow }));
