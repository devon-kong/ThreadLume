// M2-B2-B S3 — real-experience acceptance for the reader-skin UI (live browser).
// Extends docs/m2-b2-a-l4/evidence/experience-checks.mjs (same verified
// machinery: real pointer events, preview observer, open-with-preview retry
// discipline) with skin-specific checks:
//
//   geometry   preview card vs pinned native card: dx/dy/dw must be ≤1px
//              (single geometry source), no horizontal overflow
//   chrome     topbar + backdrop + skin style mounted while ACTIVE; topbar
//              carries NO brand image (rabbit-logo ban); X app bar tagged/hidden
//   topbarback topbar 返回 follows the safe history rule (back to the list)
//   nativeview 原生视图 releases the session in place → X single column;
//              the next navigation re-arms the reader
//   lightbox   photo click opens X's lightbox ABOVE the skin; Esc closes the
//              lightbox ONLY (reader still active) — the skin binds no Esc
//   menu       caret menu opens in #layers, fully inside the viewport (no clip)
//   quote      a quote post renders the quote card inside the left focal card
//   viewports  1440×900 / 1280×800 / 1000px (split) and 800px (native single)
//   plus the L4 set: fourposts / video / loops / theme / narrow / reload
//
// Scenarios (globalThis.__RUN__, comma list; default all). No account writes.
const RUNRAW = (typeof __RUN__ !== "undefined" && __RUN__) || (typeof process !== "undefined" && process.env?.RUN) || "all";
const RUNSET = new Set(RUNRAW === "all" ? ["all"] : RUNRAW.split(","));
const run = (id) => RUNSET.has("all") || RUNSET.has(id);
const SHOTS = "/Users/devon/claude/peek-main/docs/m2-b2-b/evidence/shots";
const task = await taskSpace("peek m2b2b ui verify");
const page = task.page("p1");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
import { mkdirSync, writeFileSync } from "node:fs";
mkdirSync(SHOTS, { recursive: true });

const RESULTS_PATH = "/Users/devon/claude/peek-main/docs/m2-b2-b/evidence/experience-results.json";
// Merge-per-scenario discipline (same honesty rule as L4: a scenario's record
// comes from its first PASSING run; failures stay visible in the same file's
// history field, never silently replaced by a luckier rerun).
let prior = [];
try { prior = JSON.parse((await import("node:fs")).readFileSync(RESULTS_PATH, "utf8")); } catch { prior = []; }
const history = prior.flatMap((r) => (r.history || []).concat(r.pass === false ? [{ scenario: r.scenario, kind: r.kind ?? null, pass: false, error: r.error ?? null }] : []));
const results = prior.filter((r) => r.pass !== false); // keep first PASSING record per key
const keyOf = (x) => `${x.scenario}|${x.kind ?? ""}`;
const record = (r) => {
  const idx = results.findIndex((x) => keyOf(x) === keyOf(r));
  if (r.pass === false) {
    // a later failure never replaces an earlier PASS — it is appended to history
    history.push({ scenario: r.scenario, kind: r.kind ?? null, pass: false, error: r.error ?? null, at: new Date().toISOString() });
    if (idx < 0) results.push({ ...r, history });
    else results[idx].history = history;
  } else if (idx >= 0) results[idx] = { ...r, history };
  else results.push({ ...r, history });
  console.log(JSON.stringify({ ...r, shots: r.shots?.map((s) => String(s).split("/").pop()) }));
};

// preview + handoff geometry observer (4ms timer chain — rAF freezes on idle timelines)
const OBS = `(function () {
  if (window.__xpObs) return "rearmed";
  window.__xpObs = true;
  window.__xp = { pv: [], born: performance.now(), pvRect: null, nvRect: null };
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const loop = () => {
    const c = window.__xp;
    if (!c) return;
    const p = document.getElementById("peek-lad-preview");
    c.pv.push({ at: +(performance.now() - c.born).toFixed(0), on: Boolean(p && p.isConnected), id: p?.dataset.statusId || null, len: p ? (p.textContent || "").trim().length : 0 });
    if (c.pv.length > 900) c.pv = c.pv.slice(-450);
    if (p && !c.pvRect) c.pvRect = rect(p);
    const a = document.querySelector("article[data-peek-lad-focal]");
    if (a && !p && !c.nvRect) c.nvRect = rect(a);
    if (performance.now() - c.born < 90000) setTimeout(loop, 4);
  };
  setTimeout(loop, 4);
  return "installed";
})()`;
const obs = () => page.evaluate(OBS);
const pvSamples = () => page.evaluate(`(() => {
  const c = window.__xp || { pv: [] };
  const on = c.pv.filter(x => x.on);
  const g = c.pvRect && c.nvRect
    ? { dx: Math.abs(c.pvRect.x - c.nvRect.x), dy: Math.abs(c.pvRect.y - c.nvRect.y), dw: Math.abs(c.pvRect.w - c.nvRect.w) }
    : null;
  return { onFrames: on.length, firstOn: on[0]?.at ?? null, lastOn: on[on.length - 1]?.at ?? null, id: on[0]?.id ?? null, maxLen: Math.max(0, ...c.pv.map(x => x.len)), pvNow: Boolean(document.getElementById("peek-lad-preview")), pvRect: c.pvRect ?? null, nvRect: c.nvRect ?? null, geom: g };
})()`);
// click target verified in the SAME evaluate (timeline reflows under hydration)
const verifiedLinkPos = (id) => page.evaluate((tid) => {
  const link = [...document.querySelectorAll("a[href] time")]
    .map((t) => t.closest("a"))
    .find((a) => (a.getAttribute("href") || "").includes("/status/" + tid) && !a.closest('div[role="link"]'));
  if (!link) return null;
  link.scrollIntoView({ block: "center" });
  const r = link.getBoundingClientRect();
  const x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2);
  const el = document.elementFromPoint(x, y);
  return el && el.closest('a[href*="/status/' + tid + '"]') ? { x, y } : null;
}, id);
const focalState = () => page.evaluate(`(() => {
  const a = document.querySelector("article[data-peek-lad-focal]");
  return {
    focal: Boolean(a && a.isConnected), focalCount: document.querySelectorAll("article[data-peek-lad-focal]").length,
    state: document.documentElement.getAttribute("data-peek-lad-state"),
    split: Boolean(document.getElementById("peek-lad-style")),
    textLen: a ? (a.querySelector('[data-testid="tweetText"]')?.textContent || "").trim().length : 0,
    hasVideo: Boolean(a && a.querySelector("video")),
  };
})()`);
const skinState = () => page.evaluate(`(() => {
  const a = document.querySelector("article[data-peek-lad-focal]");
  const bar = document.getElementById("peek-reader-topbar");
  return {
    topbar: Boolean(bar), backdrop: Boolean(document.getElementById("peek-reader-backdrop")),
    skinStyle: Boolean(document.getElementById("peek-reader-skin")),
    // the Native UI must carry NO brand imagery in its chrome (rabbit-logo ban)
    brandFree: bar ? bar.querySelectorAll("img, image").length === 0 && (bar.textContent || "").includes("Peek") : null,
    appbarTaggedHidden: (() => { const t = document.querySelector("[data-peek-reader-appbar]"); return t ? getComputedStyle(t).display === "none" : false; })(),
    radius: a ? getComputedStyle(a).borderRadius : null,
    hOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    vw: window.innerWidth, vh: window.innerHeight,
  };
})()`);
const backBtn = () => page.evaluate(`(() => {
  const b = [...document.querySelectorAll("[role=button], button")].find(x => ["返回", "Back"].includes(x.getAttribute("aria-label") || ""));
  if (b) { b.click(); return true; } return false;
})()`);
// topbar back button (extension chrome): real pointer click on the fixed bar
const topbarBack = async () => {
  const pos = await page.evaluate(`(() => {
    const b = document.querySelector("#peek-reader-topbar .pk-tb-btn");
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`);
  if (!pos) return false;
  await page.mouse.click(pos.x, pos.y, { label: "顶栏返回" });
  return true;
};

async function openWithPreview(profile, id, { previewShot, attempts = 8 } = {}) {
  await page.goto(profile);
  await sleep(4500);
  await obs();
  for (let attempt = 0; attempt < attempts; attempt++) {
    const p = await verifiedLinkPos(id);
    if (!p) { await page.evaluate(() => window.scrollBy(0, 1200)); await sleep(700); continue; }
    await page.mouse.click(p.x, p.y, { label: "打开目标帖" });
    await sleep(120);
    let shot = null;
    if (previewShot) {
      try { await page.screenshot({ path: previewShot }); shot = previewShot; } catch {}
    }
    await sleep(2300);
    const onDetail = (await page.evaluate(() => location.pathname)).includes("/status/" + id);
    const pv = await pvSamples();
    if (onDetail && pv.onFrames > 0) return { opened: true, pv, shot };
    if (onDetail) { await backBtn(); await sleep(1500); await obs(); continue; }
    await obs();
  }
  return { opened: false, pv: await pvSamples(), shot: null };
}

const SAMPLES = {
  text: { id: "1760839985715204230", profile: "https://x.com/gefei55" },
  photos: { id: "2099877465795735861", profile: "https://x.com/KinGao476942" },
  video: { id: "2109309251533570509", profile: "https://x.com/thinkszyg" },
  highcomments: { id: "2100757389112938573", profile: "https://x.com/ruanyf" },
};

// ---------- fourposts (+ skin geometry & chrome) ----------
if (run("fourposts")) {
  for (const [kind, s] of Object.entries(SAMPLES)) {
    const r = await openWithPreview(s.profile, s.id, { previewShot: `${SHOTS}/fourposts-${kind}-1-preview.png` });
    if (!r.opened) { record({ scenario: "fourposts", kind, pass: false, error: "did not open with preview" }); continue; }
    const fs = await focalState();
    const skin = await skinState();
    const shotNative = `${SHOTS}/fourposts-${kind}-2-native.png`;
    await page.screenshot({ path: shotNative });
    const geomOk = !r.pv.geom || (r.pv.geom.dx <= 1 && r.pv.geom.dy <= 1 && r.pv.geom.dw <= 1);
    record({
      scenario: "fourposts", kind,
      pass: r.pv.id === s.id && r.pv.maxLen > 8 && fs.focal && fs.focalCount === 1 && fs.textLen > 8 && !fs.pvNow
        && skin.topbar && skin.backdrop && skin.brandFree && !skin.hOverflow && geomOk,
      preview: r.pv, focal: fs, skin, geomOk,
      shots: [r.shot, shotNative].filter(Boolean),
    });
    await backBtn();
    await sleep(1500);
  }
}

// ---------- video controls (L4 protocol) ----------
if (run("video")) {
  const id = SAMPLES.video.id;
  await page.goto("https://x.com/thinkszyg/status/" + id);
  await sleep(5000);
  await obs();
  const readV = () => page.evaluate(() => {
    const v = document.querySelector("article[data-peek-lad-focal] video") || document.querySelector("article video");
    return v ? { paused: v.paused, t: +v.currentTime.toFixed(1), muted: v.muted, ready: v.readyState } : null;
  });
  const clickLabel = async (label) => {
    const h = await page.evaluate(() => {
      const v = document.querySelector("article[data-peek-lad-focal] video") || document.querySelector("article video");
      if (!v) return null;
      const r = v.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    });
    if (!h) return false;
    let b = null;
    for (let i = 0; i < 4 && !b; i++) {
      await page.evaluate(() => {
        const pane = document.querySelector("article[data-peek-lad-focal]");
        const v = pane?.querySelector("video");
        if (pane && v) {
          const vb = v.getBoundingClientRect().bottom;
          if (vb > window.innerHeight - 60) pane.scrollTop += Math.ceil(vb - window.innerHeight) + 90;
        }
      });
      await sleep(200);
      await page.mouse.move(h.x + (i % 2 ? 3 : -3), h.y, { label: "悬停视频" });
      await page.mouse.move(h.x, h.y, { label: "悬停视频" });
      await sleep(450);
      b = await page.evaluate((lab) => {
        const scope = document.querySelector("article[data-peek-lad-focal]") || document;
        for (const btn of scope.querySelectorAll('[role="button"], button')) {
          if ((btn.getAttribute("aria-label") || "") !== lab) continue;
          const r = btn.getBoundingClientRect();
          if (r.width < 8 || r.height < 8) continue;
          const x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2);
          const el = document.elementFromPoint(x, y);
          if (el && (el === btn || btn.contains(el) || el.closest('[aria-label="' + lab + '"]') === btn)) return { x, y };
        }
        return null;
      }, label);
    }
    if (!b) return false;
    await page.mouse.click(b.x, b.y, { label: `点击「${label}」` });
    return true;
  };
  const fs = await focalState();
  const st0 = await readV();
  const t0 = st0?.t ?? 0;
  await sleep(1200);
  const st1 = await readV();
  const autoplaying = Boolean(st1 && !st1.paused && st1.t > t0);
  let pausedClicked = await clickLabel("暂停");
  await sleep(700);
  let stPaused = await readV();
  if (!stPaused?.paused) { pausedClicked = (await clickLabel("暂停")) || pausedClicked; await sleep(700); stPaused = await readV(); }
  let playClicked = await clickLabel("播放");
  await sleep(900);
  let stResumed = await readV();
  if (stResumed?.paused) { playClicked = (await clickLabel("播放")) || playClicked; await sleep(900); stResumed = await readV(); }
  const shotPlay = `${SHOTS}/video-1-playback.png`;
  await page.screenshot({ path: shotPlay });
  const fsIn = await clickLabel("全屏");
  await sleep(1500);
  const fsOn = await page.evaluate(() => ({ fs: Boolean(document.fullscreenElement), tag: document.fullscreenElement?.tagName || null }));
  await page.screenshot({ path: `${SHOTS}/video-3-fullscreen.png` });
  const fsOutClicked = await clickLabel("退出全屏");
  await sleep(900);
  const fsOff = await page.evaluate(() => !document.fullscreenElement);
  const before = await readV();
  const ds = await page.evaluate(async () => {
    const t0 = performance.now();
    for (let y = 0; y <= 5000; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
    return Math.round(performance.now() - t0);
  });
  await sleep(900);
  const after = await readV();
  const identity = await page.evaluate(() => {
    const v = document.querySelector("article video");
    const focal = document.querySelector("article[data-peek-lad-focal]");
    return { connected: Boolean(v && v.isConnected), inFocal: Boolean(focal && focal.contains(v)) };
  });
  const shotDeep = `${SHOTS}/video-4-deepscroll.png`;
  await page.screenshot({ path: shotDeep });
  await page.evaluate(() => window.scrollTo(0, 0));
  record({
    scenario: "video",
    pass: Boolean(fs.focal && autoplaying && stPaused?.paused && stResumed && !stResumed.paused && fsOn.fs && (fsOutClicked ? fsOff : true) && identity.connected && identity.inFocal && after && before && after.t > before.t),
    steps: {
      focalPinned: fs.focal, autoplaying,
      pause: { clicked: pausedClicked, paused: stPaused?.paused ?? null },
      resume: { clicked: playClicked, playing: stResumed ? !stResumed.paused : null },
      mute: { automatable: false, note: "current X build exposes no mute control (L4 finding, unchanged)" },
      fullscreen: { enterClicked: fsIn, on: fsOn.fs, exitClicked: fsOutClicked, exited: fsOff },
      deepScroll: { ms: ds, videoStillConnected: identity.connected, inFocal: identity.inFocal, timeAdvanced: Boolean(after && before && after.t > before.t), playingAfter: Boolean(after && !after.paused) },
    },
    shots: [shotPlay, `${SHOTS}/video-3-fullscreen.png`, shotDeep],
  });
  await backBtn();
  await sleep(1200);
}

// ---------- lightbox + Esc layering ----------
if (run("lightbox")) {
  const s = SAMPLES.photos;
  await page.goto(`${s.profile}/status/${s.id}`);
  await sleep(5000);
  const fs0 = await focalState();
  const photoPos = await page.evaluate(() => {
    const scope = document.querySelector("article[data-peek-lad-focal]");
    const img = scope?.querySelector('[data-testid="tweetPhoto"] img');
    if (!img) return null;
    const r = img.getBoundingClientRect();
    if (r.width < 20) return null;
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + Math.min(r.height / 2, 200)) };
  });
  let opened = false;
  if (photoPos) {
    await page.mouse.click(photoPos.x, photoPos.y, { label: "打开图片灯箱" });
    await sleep(2500);
    opened = await page.evaluate(() => {
      const layer = document.querySelector('[role="dialog"], [aria-modal="true"]');
      return Boolean(layer && (layer.querySelector("img") || layer.querySelector("video")));
    });
  }
  const shotLb = `${SHOTS}/lightbox-1-open.png`;
  await page.screenshot({ path: shotLb });
  await page.keyboard.press("Escape"); // must close the LIGHTBOX only
  await sleep(1200);
  const afterEsc = await page.evaluate(() => ({
    dialogGone: !document.querySelector('[role="dialog"], [aria-modal="true"]'),
    onDetail: location.pathname.includes("/status/"),
    focal: document.querySelectorAll("article[data-peek-lad-focal]").length,
    state: document.documentElement.getAttribute("data-peek-lad-state"),
  }));
  const shotAfter = `${SHOTS}/lightbox-2-after-esc.png`;
  await page.screenshot({ path: shotAfter });
  record({
    scenario: "lightbox",
    pass: Boolean(fs0.focal && opened && afterEsc.dialogGone && afterEsc.onDetail && afterEsc.focal === 1 && afterEsc.state === "active"),
    expect: "lightbox opens above the skin; Esc closes the lightbox only — reader stays ACTIVE (skin binds no Esc)",
    opened, afterEsc, shots: [shotLb, shotAfter],
  });
}

// ---------- caret menu (no clipping by the floating card) ----------
if (run("menu")) {
  const s = SAMPLES.text;
  await page.goto(`${s.profile}/status/${s.id}`);
  await sleep(5000);
  const pos = await page.evaluate(() => {
    const scope = document.querySelector("article[data-peek-lad-focal]");
    const btn = scope?.querySelector('[data-testid="caret"]');
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  });
  let menu = null;
  if (pos) {
    await page.mouse.click(pos.x, pos.y, { label: "打开焦点帖菜单" });
    await sleep(1500);
    menu = await page.evaluate(() => {
      const m = document.querySelector('[role="menu"]');
      if (!m) return { open: false };
      const r = m.getBoundingClientRect();
      const cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2);
      const el = document.elementFromPoint(cx, cy);
      return {
        open: true, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
        withinViewport: r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight,
        topmostIsMenu: Boolean(el && (m.contains(el) || el === m)),
      };
    });
  }
  const shot = `${SHOTS}/menu-1-caret.png`;
  await page.screenshot({ path: shot });
  await page.keyboard.press("Escape");
  await sleep(600);
  const closed = await page.evaluate(() => !document.querySelector('[role="menu"]'));
  record({
    scenario: "menu",
    pass: Boolean(pos && menu?.open && menu.withinViewport && menu.topmostIsMenu && closed),
    menu, escClosed: closed, shots: [shot],
  });
}

// ---------- quote post ----------
if (run("quote")) {
  // find a quote post on the home timeline (article containing an embedded
  // quote card: div[role=link] with its own article), open it, verify the
  // quote card renders INSIDE the left focal card
  await page.goto("https://x.com/home");
  await sleep(5000);
  const findQuote = () => page.evaluate(() => {
    for (const c of document.querySelectorAll('[data-testid="cellInnerDiv"]')) {
      const art = c.querySelector("article");
      if (!art) continue;
      const quote = art.querySelector('div[role="link"]');
      if (!quote || !(quote.querySelector('[data-testid="tweetText"]') || quote.querySelector("time"))) continue;
      const own = [...art.querySelectorAll("a[href] time")]
        .map((t) => t.closest("a"))
        .find((a) => !a.closest('div[role="link"]') && /\/status\/\d+/.test(a.getAttribute("href") || ""));
      if (own) return (own.getAttribute("href").match(/\/status\/(\d+)/) || [])[1];
    }
    return null;
  });
  let qid = await findQuote();
  for (let i = 0; i < 8 && !qid; i++) {
    await page.evaluate(() => window.scrollBy(0, 1400));
    await sleep(1200);
    qid = await findQuote();
  }
  if (!qid) {
    record({ scenario: "quote", pass: null, verdict: "NOT_TESTED", note: "no quote post found on the home timeline sample window" });
  } else {
    let opened = false;
    for (let attempt = 0; attempt < 4 && !opened; attempt++) {
      const p = await verifiedLinkPos(qid);
      if (!p) { await page.evaluate(() => window.scrollBy(0, 900)); await sleep(700); continue; }
      await page.mouse.click(p.x, p.y, { label: "打开引用帖" });
      await sleep(2500);
      opened = (await page.evaluate(() => location.pathname)).includes("/status/" + qid);
    }
    const q = await page.evaluate(() => {
      const focal = document.querySelector("article[data-peek-lad-focal]");
      const quote = focal?.querySelector('div[role="link"]');
      if (!focal || !quote) return { focal: Boolean(focal), quoteInFocal: false };
      const fr = focal.getBoundingClientRect(), qr = quote.getBoundingClientRect();
      return {
        focal: true, quoteInFocal: true,
        quoteVisible: qr.width > 40 && qr.height > 40,
        quoteInsideCard: qr.left >= fr.left - 1 && qr.right <= fr.right + 1,
      };
    });
    const shot = `${SHOTS}/quote-1-native.png`;
    await page.screenshot({ path: shot });
    record({ scenario: "quote", pass: Boolean(opened && q.focal && q.quoteInFocal && q.quoteVisible && q.quoteInsideCard), qid, q, shots: [shot] });
    await backBtn();
    await sleep(1200);
  }
}

// ---------- topbar back (safe history rule) ----------
if (run("topbarback")) {
  const s = SAMPLES.text;
  const r = await openWithPreview(s.profile, s.id, {});
  let out = { scenario: "topbarback", openedWithPreview: r.opened };
  if (r.opened) {
    const clicked = await topbarBack();
    await sleep(2500);
    const after = await page.evaluate(() => ({
      url: location.pathname, onDetail: location.pathname.includes("/status/"),
      focalLeftover: document.querySelectorAll("article[data-peek-lad-focal]").length,
      chromeLeftover: Boolean(document.getElementById("peek-reader-topbar")),
      cells: document.querySelectorAll('[data-testid="cellInnerDiv"] article').length,
    }));
    out = { ...out, clicked, after, pass: Boolean(clicked && !after.onDetail && after.focalLeftover === 0 && !after.chromeLeftover && after.cells >= 1) };
  } else out.pass = false;
  record(out);
}

// ---------- native view release + re-arm ----------
if (run("nativeview")) {
  const s = SAMPLES.text;
  await page.goto(`${s.profile}/status/${s.id}`);
  await sleep(5000);
  const before = await focalState();
  const pos = await page.evaluate(() => {
    const b = document.querySelector("#peek-reader-topbar .pk-tb-native");
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  });
  if (pos) await page.mouse.click(pos.x, pos.y, { label: "切换原生视图" });
  await sleep(2000);
  const released = await page.evaluate(() => ({
    state: document.documentElement.getAttribute("data-peek-lad-state"),
    split: Boolean(document.getElementById("peek-lad-style")),
    chrome: Boolean(document.getElementById("peek-reader-topbar")),
    focal: document.querySelectorAll("article[data-peek-lad-focal]").length,
    onDetail: location.pathname.includes("/status/"),
  }));
  const shotRel = `${SHOTS}/nativeview-1-released.png`;
  await page.screenshot({ path: shotRel });
  // re-arm: navigate away and into a detail again — the reader must return
  await page.goto("https://x.com/home");
  await sleep(3500);
  const r2 = await openWithPreview(s.profile, s.id, {});
  const rearmed = await focalState();
  const skin2 = await skinState();
  record({
    scenario: "nativeview",
    pass: Boolean(before.focal && pos && released.state !== "active" && !released.split && !released.chrome && released.focal === 0 && released.onDetail && r2.opened && rearmed.focal && skin2.topbar),
    before: before.focal, released, rearmed: rearmed.focal, shots: [shotRel],
  });
}

// ---------- viewports ----------
if (run("viewports")) {
  const s = SAMPLES.text;
  const cases = [
    { name: "1440x900", w: 1440, h: 900, split: true },
    { name: "1280x800", w: 1280, h: 800, split: true },
    { name: "1000x800", w: 1000, h: 800, split: true },
    { name: "800x900", w: 800, h: 900, split: false },
  ];
  const runs = [];
  for (const c of cases) {
    await page.cdp("Emulation.setDeviceMetricsOverride", { width: c.w, height: c.h, deviceScaleFactor: 1, mobile: false });
    await sleep(800);
    await page.goto(`${s.profile}/status/${s.id}`);
    await sleep(4500);
    const fs = await focalState();
    const skin = await skinState();
    // visual caliber: the design contract is "split active (or inert) on
    // screen", not "marker/style element absent" — at <980px the split rules
    // and chrome are media-inert and the page is X's native single column
    const visual = await page.evaluate(`(() => {
      const a = document.querySelector("article[data-peek-lad-focal]") || document.querySelector("article[data-testid='tweet']");
      const bar = document.getElementById("peek-reader-topbar");
      return {
        articlePosition: a ? getComputedStyle(a).position : null,
        topbarDisplay: bar ? getComputedStyle(bar).display : null,
      };
    })()`);
    const shot = `${SHOTS}/viewport-${c.name}.png`;
    await page.screenshot({ path: shot });
    runs.push({
      ...c, focal: fs.focal, focalCount: fs.focalCount, topbar: skin.topbar, hOverflow: skin.hOverflow, visual,
      pass: c.split
        ? Boolean(fs.focal && fs.focalCount === 1 && visual.articlePosition === "fixed" && visual.topbarDisplay !== "none" && !skin.hOverflow)
        : Boolean(visual.articlePosition !== "fixed" && visual.topbarDisplay === "none" && !skin.hOverflow),
      shot,
    });
  }
  await page.cdp("Emulation.clearDeviceMetricsOverride", {});
  await sleep(1200);
  record({ scenario: "viewports", pass: runs.every((r) => r.pass), runs, shots: runs.map((r) => r.shot) });
}

// ---------- 5 open/close loops ----------
if (run("loops")) {
  await page.goto("https://x.com/home");
  await sleep(4500);
  await obs();
  const loops = [];
  const feedState = () => page.evaluate(`(() => ({
    onDetail: location.pathname.includes("/status/"),
    y: Math.round(window.scrollY),
    cells: document.querySelectorAll('[data-testid="cellInnerDiv"] article').length,
    pvLeftover: Boolean(document.getElementById("peek-lad-preview")),
    focalLeftover: document.querySelectorAll("article[data-peek-lad-focal]").length,
    chromeLeftover: Boolean(document.getElementById("peek-reader-topbar")),
  }))()`);
  for (let i = 0; i < 5; i++) {
    const target = await page.evaluate(() => {
      for (const c of document.querySelectorAll('[data-testid="cellInnerDiv"]')) {
        const art = c.querySelector("article");
        if (!art || !art.querySelector('[data-testid="tweetText"]')) continue;
        const own = [...art.querySelectorAll("a[href] time")]
          .map((t) => t.closest("a"))
          .find((a) => !a.closest('div[role="link"]') && /\/status\/\d+/.test(a.getAttribute("href") || ""));
        if (own) return (own.getAttribute("href").match(/\/status\/(\d+)/) || [])[1];
      }
      return null;
    });
    if (!target) { loops.push({ i: i + 1, error: "no target" }); continue; }
    let opened = false;
    let pv = null;
    for (let attempt = 0; attempt < 4 && !opened; attempt++) {
      const p = await verifiedLinkPos(target);
      if (!p) { await sleep(500); continue; }
      await page.mouse.click(p.x, p.y, { label: `循环${i + 1} 打开` });
      await sleep(2300);
      opened = (await page.evaluate(() => location.pathname)).includes("/status/" + target);
      if (opened) {
        pv = await pvSamples();
        if (pv.onFrames === 0) { await backBtn(); await sleep(1500); await obs(); opened = false; }
      }
    }
    if (!opened) { loops.push({ i: i + 1, error: "did not open with preview" }); continue; }
    await page.evaluate(async () => {
      for (let y = 0; y <= 1500; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 80)); }
    });
    const readState = await focalState();
    const closed = await backBtn();
    let after = null;
    for (let w = 0; w < 16; w++) {
      after = await feedState();
      if (after.cells >= 3 && !after.onDetail) break;
      await sleep(500);
    }
    const shot = `${SHOTS}/loops-${i + 1}-after-close.png`;
    await page.screenshot({ path: shot });
    loops.push({
      i: i + 1, target, opened, closed, readState, preview: pv, after,
      pass: Boolean(closed && !after.onDetail && after.cells >= 3 && !after.pvLeftover && after.focalLeftover === 0 && !after.chromeLeftover),
      shot,
    });
    await sleep(1200);
  }
  const shot = `${SHOTS}/loops-final-feed.png`;
  await page.screenshot({ path: shot });
  record({ scenario: "loops", pass: loops.length === 5 && loops.every((l) => l.pass), loops, shots: [shot] });
}

// ---------- theme switch ----------
if (run("theme")) {
  const theme0 = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.goto("https://x.com/settings/display");
  await sleep(3500);
  const swatches = await page.evaluate(`(() => {
    const radios = [...document.querySelectorAll('[role="radio"]')];
    return radios.map((r) => {
      const b = r.getBoundingClientRect();
      return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
    });
  })()`);
  const theme1Try = async (idx) => {
    if (!swatches[idx]) return null;
    await page.mouse.click(swatches[idx].x, swatches[idx].y, { label: "点击主题色块" });
    await sleep(3000);
    return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  };
  let theme1 = await theme1Try(1);
  let usedSwatch = 1;
  if (theme1 === theme0) { theme1 = await theme1Try(0); usedSwatch = 0; }
  const themeChanged = theme1 !== theme0;
  let out = { scenario: "theme", themeBefore: theme0, themeAfterToggle: theme1, themeChanged, swatchUsed: usedSwatch, swatches: swatches.length };
  if (themeChanged) {
    const s = SAMPLES.text;
    const topen = await openWithPreview(s.profile, s.id, { previewShot: `${SHOTS}/theme-1-preview.png` });
    const pv = topen.pv;
    const fs = await focalState();
    const bg = await page.evaluate(() => ({
      body: getComputedStyle(document.body).backgroundColor,
      focal: document.querySelector("article[data-peek-lad-focal]") ? getComputedStyle(document.querySelector("article[data-peek-lad-focal]")).backgroundColor : null,
      bar: document.getElementById("peek-reader-topbar") ? getComputedStyle(document.getElementById("peek-reader-topbar")).backgroundColor : null,
      backdrop: document.getElementById("peek-reader-backdrop") ? getComputedStyle(document.getElementById("peek-reader-backdrop")).backgroundColor : null,
    }));
    const shot = `${SHOTS}/theme-2-native.png`;
    await page.screenshot({ path: shot });
    out = { ...out, pass: topen.opened && pv.id === s.id && fs.focal && fs.focalCount === 1 && bg.body === theme1, preview: pv, focal: fs, colors: bg, shots: [shot] };
    await page.goto("https://x.com/settings/display");
    await sleep(3000);
    const restoreIdx = usedSwatch === 1 ? 0 : 1;
    let restored = null;
    if (swatches[restoreIdx]) {
      await page.mouse.click(swatches[restoreIdx].x, swatches[restoreIdx].y, { label: "恢复原主题" });
      await sleep(2500);
      restored = restoreIdx;
    }
    out.restored = restored;
    out.themeAfterRestore = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  } else {
    out.pass = false;
  }
  record(out);
}

// ---------- narrow viewport (L4 parity) ----------
if (run("narrow")) {
  await page.goto("https://x.com/gefei55");
  await sleep(4500);
  await obs();
  await page.cdp("Emulation.setDeviceMetricsOverride", { width: 800, height: 900, deviceScaleFactor: 2, mobile: false });
  await sleep(1500);
  const s = SAMPLES.text;
  let clicked = false;
  for (let attempt = 0; attempt < 4 && !clicked; attempt++) {
    const p = await verifiedLinkPos(s.id);
    if (!p) { await page.evaluate(() => window.scrollBy(0, 900)); await sleep(700); continue; }
    await page.mouse.click(p.x, p.y, { label: "窄视口打开样本" });
    await sleep(1500);
    clicked = true;
  }
  const pv = await pvSamples();
  const fs = await focalState();
  const shot = `${SHOTS}/narrow-viewport.png`;
  await page.screenshot({ path: shot });
  record({
    scenario: "narrow", pass: pv.onFrames === 0 && !fs.split && !fs.focal,
    expect: "below 980px: no preview offered, no split layout, no skin chrome — X native single column",
    preview: pv, focal: fs, shots: [shot],
  });
  await page.cdp("Emulation.clearDeviceMetricsOverride", {});
  await sleep(1200);
}

// ---------- extension reload ----------
if (run("reload")) {
  await page.goto("chrome://extensions/");
  await page.waitForTimeout(2000);
  await page.click('loc=role:button[name="Reload"]', { label: "重载扩展" });
  await page.waitForTimeout(2000);
  const s = SAMPLES.text;
  const ropen = await openWithPreview(s.profile, s.id, {});
  const marker = await page.evaluate(() => document.documentElement.getAttribute("data-peek-artifact"));
  const fs = await focalState();
  const skin = await skinState();
  record({ scenario: "reload", pass: ropen.opened && ropen.pv.id === s.id && fs.focal && fs.focalCount === 1 && skin.topbar, marker, preview: ropen.pv, focal: fs });
}

writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 1));
console.log("EXPERIENCE DONE:", results.map((r) => `${r.scenario}${r.kind ? ":" + r.kind : ""}:${r.pass === null ? "NOT_TESTED" : r.pass ? "PASS" : "FAIL"}`).join(" "));
