// M2-B2-A-L4 — real-extension performance harness (extends
// docs/m2-b2-a/evidence/perf.mjs; same samples and metric semantics so the
// M2-B1-R baseline columns stay comparable).
//
// L4 fixes over the previous harness:
//   1. Build identity reads the test build's shared-DOM marker
//      (<html data-peek-artifact>) instead of window.__peekNativeTest — the
//      hook lives in the ISOLATED world and is invisible to page.evaluate, and
//      is only armed in offline harness builds anyway. A second Peek build
//      injecting into the same document produces an array marker → the round
//      is refused. "native" requires the marker's ABSENCE.
//   2. t0 is recorded on the WINDOW capture phase (click), which is strictly
//      earlier in the propagation path than the extension's document-capture
//      handler regardless of registration order. The previous harness
//      registered its monitor on document capture AFTER the content script —
//      its t0 landed after the extension's synchronous extraction+mount and
//      hid that cost from t1a. pointerdown (window capture) is recorded too
//      as an earlier reference. Diag builds additionally stamp the extension's
//      own handler entry (data-peek-capture-at) and the overlay mount
//      (data-peek-mount-at) on <html>; reading them after the click
//      decomposes t1a into capture→extract→mount segments.
//   3. Resource accounting: X-native GraphQL/REST/media/video request counts
//      (timing only, bucketed by host+path family; no URLs, no queryIds, no
//      auth material), image cache-hit vs fresh-load split, and a
//      cross-origin counter that must stay zero (the extension has no fetch).
//
// Metrics (single time origin t0 = WINDOW-capture click on the TARGET link):
//   t1a        preview first real readable (m2a only). Identity-guarded.
//   t1b        native takeover (lab modes): the MARKED focal article with its
//              own timestamp link and real body. In m1r/native this is the
//              M2-B1-R T1 equivalent (reading copy / plain article).
//   t1c        handoff stability: dupFrames, blankLeftFrames,
//              leftoverPreviewFrames, articleJumpPx, textJumpPx (preview text
//              block top vs native focal text top), fontPx (both faces).
//   t2a/t2b    reply candidates (X's current DOM has no socialContext —
//              candidate caliber everywhere), t2net timings from
//              PerformanceObserver (no URLs recorded).
//   t3         native action bar + composer.
//   t4         close → left detail → t4a/t4Cells/t4Anchor/t4Stable.
//   video      first node / first playable / same-element across 5000px deep
//              scroll / waiting count.
//   resources  request-count deltas between arm and settle (bucketed) +
//              heap before/after + long tasks.
//
// Modes (globalThis.__MODE__): native | m1r | b1r | m2a
// Injection: ego-browser's embedded Node does not inherit shell env — prepend
// `globalThis.__MODE__ = "..."` when piping this script.
const MODE = typeof __MODE__ !== "undefined" ? __MODE__
  : (typeof process !== "undefined" && process.env?.MODE) || "UNSET-MODE";
const ROUNDS = Number(process.env.ROUNDS_N || 4);
if (!["native", "m1r", "b1r", "m2a"].includes(MODE)) throw new Error("bad MODE");
const task = await taskSpace("peek l4 perf " + MODE);
const page = task.page("p1");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {
  mode: MODE, rounds: [], wrapper: null, idle: null, env: null,
  note: "t0 = WINDOW-capture click on the TARGET status link (strictly before the extension's document-capture handler); t0down = window-capture pointerdown; stamps are performance.now()-t0 from one in-page sampler on a bounded 4ms timer chain (rAF is compositor-linked and freezes on idle timelines — observed live); frame counts are 4ms-sample approximations, visual evidence carried by screenshots/recording",
};

const SAMPLES = [
  { id: "2109309251533570509", profile: "https://x.com/thinkszyg", kind: "video" },
  { id: "2099877465795735861", profile: "https://x.com/KinGao476942", kind: "photos" },
  { id: "1760839985715204230", profile: "https://x.com/gefei55", kind: "text" },
  { id: "2100757389112938573", profile: "https://x.com/ruanyf", kind: "highcomments" },
];

// ---------------- in-page monitor ----------------

const MONITOR = `(function () {
  if (window.__s5rInstalled) { window.__s5r = null; return "rearmed"; }
  window.__s5rInstalled = true;
  const OWN_TS = (scope, id) => [...scope.querySelectorAll("a[href] time")]
    .some((t) => (t.closest("a")?.getAttribute("href") || "").includes("/status/" + id));
  const TWEET_TEXT = (art) => art.querySelector('[data-testid="tweetText"]')?.textContent?.trim() || "";

  // build-identity guard (L4-S1): read the test build's shared-DOM marker.
  // The ISOLATED-world hook (window.__peekNativeTest) is invisible here by
  // design; the marker is written by the extension's content script itself.
  // An array value means TWO Peek builds injected — refuse the round.
  function artifactInfo() {
    const raw = document.documentElement.getAttribute("data-peek-artifact");
    if (!raw) return { present: false, mode: null, build: null, conflict: false };
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch { return { present: true, mode: null, build: null, conflict: true, malformed: true }; }
    if (Array.isArray(parsed)) {
      const modes = parsed.map((m) => (m && typeof m === "object" ? m.mode : "?")).filter(Boolean);
      return { present: true, mode: modes.length === 1 ? modes[0] : null, build: null, conflict: true, modes };
    }
    if (!parsed || typeof parsed !== "object") return { present: true, mode: null, build: null, conflict: true, malformed: true };
    return { present: true, mode: parsed.mode || null, build: parsed.build || null, conflict: false };
  }
  function artifactOk(mode, info) {
    if (mode === "native") return !info.present && !info.conflict; // must be absent
    return info.present && !info.conflict && info.mode === mode;
  }

  function previewValid(id) {
    const p = document.getElementById("peek-lad-preview");
    return Boolean(p && p.isConnected && p.dataset.statusId === id &&
      (p.textContent || "").trim().length > 8);
  }
  function previewTextRect() {
    const p = document.getElementById("peek-lad-preview");
    const t = p?.querySelector(".ppl-text");
    return t ? t.getBoundingClientRect().toJSON() : null;
  }
  function previewFontPx() {
    const t = document.getElementById("peek-lad-preview")?.querySelector(".ppl-text");
    return t ? getComputedStyle(t).fontSize : null;
  }

  function focalInfo(mode, id) {
    if (mode === "m1r") {
      const pane = document.getElementById("peek-native-pane");
      if (!pane || pane.dataset.statusId !== id) return null;
      const t = pane.querySelector(".peek-native-text");
      if (!t || !t.textContent.trim() || t.classList.contains("peek-native-unknown")) return null;
      return { art: null, pane };
    }
    if (mode === "b1r" || mode === "m2a") {
      const a = document.querySelector("article[data-peek-lad-focal]");
      if (!a || !a.isConnected || !OWN_TS(a, id)) return null; // identity guard
      if (!TWEET_TEXT(a)) return null;                          // real body, not skeleton
      return { art: a, pane: null };
    }
    const a = [...document.querySelectorAll("article[data-testid=tweet]")].find((x) => OWN_TS(x, id));
    if (!a || !TWEET_TEXT(a)) return null;
    return { art: a, pane: null };
  }
  // the detail's own focal article (pinned or not) — for the handoff-jump probe
  function detailArticle(id) {
    return [...document.querySelectorAll("article[data-testid=tweet]")].find((x) => OWN_TS(x, id)) || null;
  }
  function handleOf(info, mode) {
    if (mode === "m1r") return (info.pane.querySelector(".peek-native-author span")?.textContent || "").replace(/^@/, "").trim();
    const a = info.art.querySelector('a[href^="/"]');
    return (a?.getAttribute("href") || "").replace(/^\\//, "").split("/")[0];
  }
  function replies(mode, id, info) {
    const fcell = info.art ? info.art.closest('[data-testid="cellInnerDiv"]') : null;
    let candidate = null;
    for (const c of document.querySelectorAll('[data-testid="cellInnerDiv"]')) {
      if (c === fcell || !c.isConnected) continue;
      const art = c.querySelector("article");
      if (!art) continue;
      const txt = TWEET_TEXT(art);
      if (!txt) continue;
      if (OWN_TS(art, id)) continue; // quote-of-focal or the focal cell itself
      if (!candidate) candidate = { cell: c, art };
      break;
    }
    return { verified: null, candidate }; // candidate caliber everywhere (no socialContext in current X DOM)
  }
  function readableRight(mode, cell) {
    const r = cell.getBoundingClientRect();
    if (!(r.top < innerHeight && r.bottom > 0 && r.width > 0)) return false;
    if (mode === "native") return true;
    const paneRight = innerWidth * 0.52;
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
    const actions = mode === "m1r" ? true
      : Boolean((info.art || info.pane).querySelector('[data-testid="reply"], [data-testid="like"]'));
    return actions && composerVisible();
  }
  let vidSeq = 0;
  function videoScan(st) {
    if (!st.video) st.video = { firstNodeAt: null, firstPlayableAt: null, el: null, tag: 0, waiting: 0 };
    const v = st.video;
    if (!v.el || !v.el.isConnected) {
      const info = focalInfo(st.mode, st.id);
      const scope = info ? (info.art || document)
        : (st.mode === "m2a" && onDetail() ? (detailArticle(st.id) || document) : document);
      const el = scope.querySelector ? scope.querySelector("article video") : null;
      if (el && !v.el) {
        v.el = el; v.tag = ++vidSeq; el.__s5tag = v.tag; v.firstNodeAt = performance.now() - st.t0;
        el.addEventListener("waiting", () => { v.waiting++; });
      } else if (el && v.el && el !== v.el) {
        v.el = el; v.tag = ++vidSeq; el.__s5tag = v.tag; v.retagged = true;
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
  function stampT4(st, key) {
    if (st.t40 == null) return;
    if (st.m[key] == null) st.m[key] = performance.now() - st.t40;
  }
  function onDetail() { return /status\\/\\d+/.test(location.pathname); }
  function loop(st) {
    if (st.stop || window.__s5r !== st) return;
    // bounded sampler lifetime: the round's own waits own completion; this
    // only guarantees the 4ms chain cannot outlive the measurement by much
    if (st.t0 !== null && st.born === null) st.born = performance.now();
    if (st.born !== null && performance.now() - st.born > 30000) { st.stop = true; return; }
    try {
      if (st.t0 !== null) {
        if (st.scrollAt != null && st.m.scrollAt == null) stamp(st, "scrollAt");
        if (st.artifactOk === null) {
          st.artifact = artifactInfo();
          st.artifactOk = artifactOk(st.mode, st.artifact);
        }
        if (st.artifactOk === false) { st.m.artifactMismatch = 0; st.stop = true; return; }
        // T1c frame sampling (m2a): duplication / blank left pane / leftover
        if (st.mode === "m2a" && st.previewStarted && st.m.t1b == null) {
          const pv = previewValid(st.id);
          const pinned = document.querySelector("article[data-peek-lad-focal]");
          if (pv && pinned && pinned.isConnected) st.dupFrames++;
          if (onDetail() && !pv && !(pinned && pinned.isConnected && OWN_TS(pinned, st.id) && TWEET_TEXT(pinned))) st.blankLeftFrames++;
        }
        if (st.mode === "m2a" && st.previewStarted) {
          if (previewValid(st.id)) {
            stamp(st, "t1a");
            if (!st.previewText) { st.previewText = previewTextRect(); st.previewFont = previewFontPx(); }
          }
        }
        const info = focalInfo(st.mode, st.id);
        if (info) {
          st.focal = info;
          stamp(st, "t1b");
          // T1c: native focal text geometry + font, once, at takeover
          if (st.mode === "m2a" && !st.nativeText) {
            const t = info.art.querySelector('[data-testid="tweetText"]');
            if (t) { st.nativeText = t.getBoundingClientRect().toJSON(); st.nativeFont = getComputedStyle(t).fontSize; }
          }
          const { candidate } = replies(st.mode, st.id, info);
          if (candidate) stamp(st, "t2aCandidate");
          if (candidate && readableRight(st.mode, candidate.cell)) stamp(st, "t2bCandidate");
          if (t3ok(st.mode, st.id)) stamp(st, "t3");
        }
        // unpinned article rect (for the handoff-jump probe)
        if (st.m.t1b == null && st.mode !== "m1r") {
          const da = detailArticle(st.id);
          if (da) { st.unpinnedRect = da.getBoundingClientRect().toJSON(); }
        }
        // post-handoff rect, once
        if (st.m.t1b != null && st.m.pinnedRectAt == null) {
          const da = detailArticle(st.id);
          if (da) { st.m.pinnedRectAt = performance.now() - st.t0; st.pinnedRect = da.getBoundingClientRect().toJSON(); }
        }
        if (st.wantVideo) videoScan(st);
        if (st.t40 !== null) {
          const leftDetail = !onDetail();
          if (leftDetail) {
            stampT4(st, "t4Left");
            if (st.mode === "m2a" && document.getElementById("peek-lad-preview")) st.leftoverPreviewFrames++;
            const cells = [...document.querySelectorAll('[data-testid="cellInnerDiv"]')].filter((c) => c.querySelector("article"));
            if (cells.length >= 1) {
              stampT4(st, "t4a"); // first feed frame — the feed accepts input again
            }
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
    // 4ms timer chain, NOT rAF: on an idle X timeline the compositor may not
    // produce frames for hundreds of ms (observed live: 2 rAF fires in 1.4s on
    // a text/photos profile — video playback keeps it alive, idle lists do
    // not). A near-frozen rAF silently mis-stamps t1a/t1b by whole hundreds of
    // ms and shows zero preview frames. Timers are not compositor-linked; the
    // chain is bounded (stops with the round) and only samples, never writes.
    st.timer = setTimeout(() => loop(st), 4);
  }
  // t0 must be strictly EARLIER than the extension's own capture handler.
  // The extension listens on document capture; a listener on WINDOW capture is
  // reached first in the propagation path no matter who registered first.
  window.addEventListener("click", (e) => {
    const st = window.__s5r;
    if (!st) return;
    if (st.t4Armed && st.t40 === null) { st.t40 = performance.now(); return; }
    if (st.t0 !== null || st.id === null) return;
    const a = e.target?.closest?.('a[href*="/status/' + st.id + '"]');
    if (!a) return;
    st.t0 = performance.now();
    st.m = {};
    st.previewStarted = st.mode === "m2a";
    st.dupFrames = 0; st.blankLeftFrames = 0; st.leftoverPreviewFrames = 0;
    st.unpinnedRect = null; st.pinnedRect = null;
    st.previewText = null; st.nativeText = null; st.previewFont = null; st.nativeFont = null;
    st.born = null;
    setTimeout(() => loop(st), 0);
  }, { capture: true });
  // pointerdown precedes click — an even earlier user-gesture reference
  window.addEventListener("pointerdown", (e) => {
    const st = window.__s5r;
    if (!st || st.t0 !== null || st.id === null) return;
    const a = e.target?.closest?.('a[href*="/status/' + st.id + '"]');
    if (a && st.t0down === null) st.t0down = performance.now();
  }, { capture: true });
  window.__s5rArm = (mode, id, wantVideo) => {
    window.__s5r = { mode, id, wantVideo: Boolean(wantVideo), t0: null, t0down: null, t40: null, t4Armed: false, m: {}, stop: false, born: null, stableRef: null, focal: null, video: null, artifact: null, artifactOk: null, previewStarted: false, dupFrames: 0, blankLeftFrames: 0, leftoverPreviewFrames: 0, unpinnedRect: null, pinnedRect: null, previewText: null, nativeText: null, previewFont: null, nativeFont: null };
    return true;
  };
  window.__s5rArmT4 = () => { if (window.__s5r) window.__s5r.t4Armed = true; return true; };
  window.__s5rRead = () => {
    const st = window.__s5r;
    if (!st) return null;
    const v = st.video || {};
    return {
      t0Set: st.t0 !== null, t0abs: st.t0, t0down: st.t0down, t40Set: st.t40 !== null, artifactOk: st.artifactOk,
      artifact: st.artifact, ...st.m,
      dupFrames: st.dupFrames, blankLeftFrames: st.blankLeftFrames, leftoverPreviewFrames: st.leftoverPreviewFrames,
      unpinnedRect: st.unpinnedRect, pinnedRect: st.pinnedRect,
      previewText: st.previewText, nativeText: st.nativeText, previewFont: st.previewFont, nativeFont: st.nativeFont,
      video: v.el ? { tag: v.tag, firstNodeAt: v.firstNodeAt, firstPlayableAt: v.firstPlayableAt, waiting: v.waiting, retagged: Boolean(v.retagged), currentTime: +v.el.currentTime.toFixed(2), paused: v.el.paused, readyState: v.el.readyState, connected: v.el.isConnected } : null,
    };
  };
  window.__s5rVideoIdentity = () => {
    const v = window.__s5r?.video;
    if (!v || !v.tag) return { tracked: false };
    const found = [...document.querySelectorAll("article video")].find((x) => x.__s5tag === v.tag);
    return {
      tracked: true, sameElement: Boolean(found), trackedTag: v.tag,
      connected: Boolean(found?.isConnected), waiting: v.waiting, retagged: Boolean(v.retagged),
      currentTime: found ? +found.currentTime.toFixed(2) : null,
      paused: found ? found.paused : null,
      playableNow: found ? (found.readyState >= 3 && !found.paused) : false,
    };
  };
  // extension handler-entry / overlay-mount stamps (diag builds only; null in
  // artifacts without them). Read AFTER the click so the values belong to the
  // click just dispatched (single-writer attributes).
  window.__s5rDiagStamps = (t0) => {
    const cap = document.documentElement.getAttribute("data-peek-capture-at");
    const mnt = document.documentElement.getAttribute("data-peek-mount-at");
    return {
      captureDeltaMs: cap ? +(parseFloat(cap) - t0).toFixed(2) : null,
      extractMs: cap && mnt ? +(parseFloat(mnt) - parseFloat(cap)).toFixed(2) : null,
    };
  };
  return "installed";
})();`;

// network-stage observer: request-count buckets + X's own conversation fetch
// timings (timings only — no URLs, no queryIds, no auth material is ever
// recorded). crossOrigin must stay 0: the extension cannot fetch (isolation
// contract), so any cross-origin request would mean X loaded it, not Peek.
const NETMON = `(function () {
  if (window.__peekNetObs) { window.__peekNet = null; window.__peekBuckets0 = null; return "rearmed"; }
  window.__peekNetObs = true;
  window.__peekNet = [];
  window.__peekRes = [];
  const bucketOf = (url) => {
    try {
      const u = new URL(url, location.href);
      const h = u.hostname;
      const p = u.pathname;
      if (h === "x.com" || h === "twitter.com" || h.endsWith(".x.com") || h.endsWith(".twitter.com")) {
        if (/^\\/i\\/api\\/graphql\\//.test(p)) {
          return /TweetDetail|TweetResultByRestId|Conversation|Detail/.test(p) ? "gqlDetail" : "gqlOther";
        }
        if (/^\\/i\\/api\\/1\\.1\\//.test(p)) return "rest11";
        return "xOther";
      }
      if (h === "pbs.twimg.com") return "mediaImages";
      if (h === "video.twimg.com") return "videoMedia";
      if (h === "abs.twimg.com" || h === "api.twitter.com" || h === "api.x.com") return "xOther";
      return "crossOrigin";
    } catch { return "crossOrigin"; }
  };
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (e.initiatorType === "fetch" || e.initiatorType === "xmlhttprequest") {
          if (/graphql/.test(e.name) && /TweetDetail|TweetResultByRestId|Conversation|Detail/.test(e.name)) {
            window.__peekNet.push({ start: Math.round(e.startTime), end: Math.round(e.responseEnd), dur: Math.round(e.duration) });
          }
        }
        const b = bucketOf(e.name);
        const transfer = e.transferSize || 0;
        window.__peekRes.push({ b, at: Math.round(e.startTime), transfer, enc: e.encodedBodySize || 0 });
      }
    }).observe({ entryTypes: ["resource"] });
  } catch {}
  window.__peekBuckets = () => {
    const out = {};
    for (const r of window.__peekRes) {
      out[r.b] = out[r.b] || { count: 0, cacheHits: 0, bytes: 0 };
      out[r.b].count++;
      if (r.b === "mediaImages") { if (r.transfer === 0) out[r.b].cacheHits++; else out[r.b].bytes += r.transfer; }
      else out[r.b].bytes += r.transfer;
    }
    out.crossOrigin = out.crossOrigin || { count: 0, cacheHits: 0, bytes: 0 };
    return out;
  };
  window.__peekBucketsMark = () => { window.__peekBuckets0 = window.__peekRes.length; return window.__peekBuckets0; };
  window.__peekBucketsDelta = () => {
    const base = window.__peekBuckets0 ?? 0;
    const delta = window.__peekRes.slice(base);
    const out = {};
    for (const r of delta) {
      out[r.b] = out[r.b] || { count: 0, cacheHits: 0, bytes: 0 };
      out[r.b].count++;
      if (r.b === "mediaImages") { if (r.transfer === 0) out[r.b].cacheHits++; else out[r.b].bytes += r.transfer; }
      else out[r.b].bytes += r.transfer;
    }
    return out;
  };
  return "installed";
})();`;

const arm = async (id, wantVideo) => {
  await page.evaluate(MONITOR);
  await page.evaluate(NETMON);
  await page.evaluate("window.__peekBucketsMark()");
  return page.evaluate(`window.__s5rArm(${JSON.stringify(MODE)}, ${JSON.stringify(id)}, ${Boolean(wantVideo)})`);
};
const armT4 = () => page.evaluate("window.__s5rArmT4()");
const read = () => page.evaluate("window.__s5rRead()");

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
  identityMarker: document.documentElement.getAttribute("data-peek-artifact") || null,
}));

for (let round = 0; round < ROUNDS; round++) {
  const rec = { round, samples: [] };
  for (const s of SAMPLES) {
    await page.goto(s.profile, { timeout: 30000 }).catch(() => {});
    await sleep(4000);
    await arm(s.id, s.kind === "video");

    let opened = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      await arm(s.id, s.kind === "video");
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
      await sleep(350);
      await page.mouse.click(pos.x, pos.y, { label: "点击目标帖时间链接进入详情" });
      let landed = null;
      // 2.5s: X's SPA commit is in-click-task; longer only wastes time on a
      // stale-coordinate miss (the timeline reflows under lazy hydration)
      for (let i = 0; i < 25; i++) {
        landed = await page.evaluate(() => location.pathname);
        if (landed.includes("/status/" + s.id)) break;
        await sleep(100);
      }
      if (landed && landed.includes("/status/" + s.id)) { opened = landed; break; }
    }
    if (!opened) { rec.samples.push({ sample: s.kind, target: s.id, skipped: "click did not open the target detail" }); continue; }

    let st = await waitStamps((x) => x.t3 != null, 12000);
    st = st || {};
    if (st.artifactOk === false) {
      rec.samples.push({ sample: s.kind, target: s.id, skipped: "loaded artifact does not match MODE", identity: st.artifact ?? null });
      continue;
    }

    // t1a decomposition (diag builds): extension capture-entry delta relative
    // to the window-capture t0, and the extraction→mount cost inside the
    // extension handler. Null for artifacts without the diag stamps.
    const diagStamps = await page.evaluate(`window.__s5rDiagStamps(${JSON.stringify(st.t0abs ?? st.t0 ?? 0)})`);

    const net = await page.evaluate(() => (window.__peekNet || []).slice(0, 3));
    const resDelta = await page.evaluate("window.__peekBucketsDelta()");
    const beforeScroll = await page.evaluate(() => {
      if (window.__s5r && window.__s5r.t0 !== null && window.__s5r.scrollAt == null) {
        window.__s5r.scrollAt = performance.now() - window.__s5r.t0;
      }
      return { longTasks: window.__s5long?.length ?? 0, heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null };
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
    const labIntegrity = (MODE === "b1r" || MODE === "m2a") ? await page.evaluate(() => ({
      focalConnected: Boolean(document.querySelector("article[data-peek-lad-focal]")?.isConnected),
      focalCount: document.querySelectorAll("article[data-peek-lad-focal]").length,
      videoInFocal: Boolean(document.querySelector("article[data-peek-lad-focal] video")),
      state: document.documentElement.getAttribute("data-peek-lad-state"),
      previewLeftover: Boolean(document.getElementById("peek-lad-preview")),
    })) : null;
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(800);

    const closeOk = await page.evaluate(`(() => {
      const b = ${MODE === "m1r"
        ? `document.querySelector("#peek-native-pane .peek-native-close")`
        : `[...document.querySelectorAll("[role=button], button")].find(x => (x.getAttribute("aria-label") || "") === "返回" || (x.getAttribute("aria-label") || "") === "Back")`};
      if (b) { window.__s5rArmT4(); b.click(); return true; }
      return false;
    })()`);
    const t4st = closeOk ? await waitStamps((x) => x.t4Stable != null, 12000) : {};
    const late = await read();
    const merged = (k) => {
      const pre = st[k] ?? null;
      const post = late[k] ?? null;
      if (pre != null) return { ms: Math.round(pre), phase: "pre-scroll" };
      if (post != null) return { ms: Math.round(post), phase: post > (st.scrollAt ?? Infinity) ? "post-scroll" : "pre-scroll" };
      return null;
    };
    const rect = st.unpinnedRect && late.pinnedRect ? {
      dx: Math.round((late.pinnedRect.x ?? late.pinnedRect.left) - (st.unpinnedRect.x ?? st.unpinnedRect.left)),
      dy: Math.round((late.pinnedRect.y ?? late.pinnedRect.top) - (st.unpinnedRect.y ?? st.unpinnedRect.top)),
    } : null;
    const textJump = st.previewText && late.nativeText ? {
      dy: Math.round((late.nativeText.y ?? late.nativeText.top) - (st.previewText.y ?? st.previewText.top)),
      previewFontPx: st.previewFont, nativeFontPx: late.nativeFont ?? st.nativeFont,
    } : null;

    rec.samples.push({
      sample: s.kind, target: s.id, openedAt: opened,
      identity: st.artifact ?? null,
      t0base: { click: "window-capture", pointerdownAt: st.t0down != null && st.t0 != null ? Math.round(st.t0 - st.t0down) : null },
      diag: diagStamps,
      t1a: st.t1a != null ? Math.round(st.t1a) : null,
      t1b: st.t1b != null ? Math.round(st.t1b) : null,
      handoff: MODE === "m2a" ? {
        dupFrames: late.dupFrames ?? st.dupFrames ?? 0,
        blankLeftFrames: late.blankLeftFrames ?? st.blankLeftFrames ?? 0,
        leftoverPreviewFrames: late.leftoverPreviewFrames ?? st.leftoverPreviewFrames ?? 0,
        articleJumpPx: rect,
        textJumpPx: textJump,
      } : null,
      t2aCandidate: merged("t2aCandidate"),
      t2bCandidate: merged("t2bCandidate"),
      t2net: net.length ? net[0] : null,
      t3: st.t3 != null ? Math.round(st.t3) : null,
      video: late.video ?? st.video ?? (s.kind === "video" ? { missing: "no video node appeared" } : undefined),
      videoIdentityAfterDeepScroll: videoIdentity,
      labIntegrity,
      resources: resDelta,
      heapDom: { beforeClick: beforeScroll, afterScroll },
      deepScrollMs: scrollPerf.ms,
      longTasksDuringDeepScroll: afterScroll.longTasks - beforeScroll.longTasks,
      t4: closeOk ? {
        a: t4st.t4a ?? null, left: t4st.t4Left ?? null, cells: t4st.t4Cells ?? null,
        anchor: t4st.t4Anchor ?? null, anchorVisible: t4st.t4AnchorVisible ?? null,
        stable: t4st.t4Stable ?? null,
      } : { error: "no close affordance" },
    });
    await sleep(3000);
  }
  out.rounds.push(rec);
  await sleep(6000);
}

// ---------------- idle + wrapper overhead ----------------

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
writeFileSync(`/Users/devon/claude/peek-main/docs/m2-b2-a-l4/evidence/perf-results-${MODE}.json`, JSON.stringify(out, null, 1));
console.log("MODE " + MODE + " done");
for (const r of out.rounds) for (const x of r.samples) if (x.t1b !== undefined || x.skipped) console.log(JSON.stringify({ s: x.sample, t1a: x.t1a, t1b: x.t1b, diag: x.diag, ho: x.handoff, t2aC: x.t2aCandidate?.ms, t2bC: x.t2bCandidate?.ms, net: x.t2net, res: x.resources, t3: x.t3, t4: x.t4?.stable, t4a: x.t4?.a, vSame: x.videoIdentityAfterDeepScroll?.sameElement, skipped: x.skipped }));
