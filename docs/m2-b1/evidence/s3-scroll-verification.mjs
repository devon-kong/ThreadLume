// M2-B1 S3 — real-page scroll boundary verification against the live lab
// extension (loaded as a real MV3 extension in the ego Chromium browser).
// Produces docs/m2-b1/evidence/s3-*.json — read-only checks, no account writes.
const FOCAL_URL = "https://x.com/thinkszyg/status/2109309251533570509";
const task = await taskSpace(1);
const page = task.page("p1");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};

// --- setup: fresh detail load, adapter active ---
await page.goto(FOCAL_URL);
await sleep(9000);

// mark the video element for identity tracking (dataset survives as long as
// the SAME DOM node is kept alive by the retention adapter)
await page.evaluate(() => {
  const v = document.querySelector("article[data-peek-lad-focal] video");
  if (v) { v.dataset.peekS3Mark = "video-identity"; v.muted = true; v.play?.().catch(() => {}); }
  window.scrollTo(0, 0);
});
await sleep(1500);

// --- 1. right-column deep scroll: video survival + single focal cell ---
const deepScrollSteps = [];
for (const target of [2000, 4000, 5000, 5800]) {
  await page.evaluate((y) => window.scrollTo(0, y), target);
  await sleep(2500);
  deepScrollSteps.push(await page.evaluate(() => {
    const art = document.querySelector("article[data-peek-lad-focal]");
    const v = art?.querySelector("video");
    return {
      scrollY: Math.round(window.scrollY),
      focalConnected: Boolean(art?.isConnected),
      focalMarkedVideoSame: v?.dataset?.peekS3Mark === "video-identity",
      videoTime: v ? +v.currentTime.toFixed(3) : null,
      videoPaused: v ? v.paused : null,
      focalCellCount: document.querySelectorAll("article[data-peek-lad-focal]").length,
      visibleReplyCells: [...document.querySelectorAll("[data-testid=cellInnerDiv]")].filter(c => {
        const r = c.getBoundingClientRect();
        return r.left > innerWidth * 0.5 && r.bottom > 0 && r.top < innerHeight;
      }).length,
    };
  }));
}
out.deepScroll = deepScrollSteps;

// --- 2. left pane independent scroll ---
await page.evaluate(() => window.scrollTo(0, 0));
await sleep(1500);
out.leftScroll = await page.evaluate(async () => {
  const art = document.querySelector("article[data-peek-lad-focal]");
  if (!art) return { error: "focal missing" };
  const before = { scrollTop: art.scrollTop, scrollY: Math.round(window.scrollY) };
  art.scrollTop = 300;
  await new Promise((r) => setTimeout(r, 600));
  const after = { scrollTop: art.scrollTop, scrollY: Math.round(window.scrollY) };
  art.scrollTop = 0;
  await new Promise((r) => setTimeout(r, 300));
  return { before, after, leftMovesIndependently: after.scrollTop !== before.scrollTop && after.scrollY === before.scrollY };
});

// --- 3. geometry stability: repeated pagination must not duplicate the focal
// cell nor shift the list cumulatively; measure focal stub height twice ---
await page.evaluate(() => window.scrollTo(0, 3000));
await sleep(2000);
await page.evaluate(() => window.scrollTo(0, 0));
await sleep(2500);
out.geometry = await page.evaluate(() => {
  const art = document.querySelector("article[data-peek-lad-focal]");
  const cell = art?.closest("[data-testid=cellInnerDiv]");
  const rects = [...document.querySelectorAll("[data-testid=cellInnerDiv]")].slice(0, 8).map((c) => Math.round(c.getBoundingClientRect().top + window.scrollY));
  return {
    focalCellCount: document.querySelectorAll("article[data-peek-lad-focal]").length,
    focalStubHeight: cell ? Math.round(cell.getBoundingClientRect().height) : null,
    firstCellsPageY: rects,
    docHeight: document.documentElement.scrollHeight,
  };
});

// --- 4. right column still functional after deep scroll (replies visible) ---
await page.evaluate(() => window.scrollTo(0, 5800));
await sleep(2000);
out.deepState = await page.evaluate(() => {
  const art = document.querySelector("article[data-peek-lad-focal]");
  const v = art?.querySelector("video");
  return {
    scrollY: Math.round(window.scrollY),
    focalConnected: Boolean(art?.isConnected),
    videoSame: v?.dataset?.peekS3Mark === "video-identity",
    videoTime: v ? +v.currentTime.toFixed(3) : null,
  };
});
await page.screenshot({ path: "/Users/devon/claude/peek-main/docs/m2-b1/evidence/s3-deep-scroll-5800.png" });

// --- 5. leave the route: adapter uninstall + native layout restore ---
await page.goto("https://x.com/home");
await sleep(4000);
out.teardown = await page.evaluate(() => ({
  ladState: document.documentElement.getAttribute("data-peek-lad-state"),
  styleRemoved: !document.getElementById("peek-lad-style"),
  htmlAttrGone: !document.documentElement.hasAttribute("data-peek-lad"),
  markerGone: !document.querySelector("article[data-peek-lad-focal]"),
  bannerVisible: (() => { const b = document.querySelector("header[role=banner]"); return b ? getComputedStyle(b).display !== "none" : false; })(),
}));
await page.screenshot({ path: "/Users/devon/claude/peek-main/docs/m2-b1/evidence/s3-after-close.png" });

// --- 6. narrow viewport degradation (1000px < 980px media guard) ---
await page.cdp("Emulation.setDeviceMetricsOverride", { width: 1000, height: 800, deviceScaleFactor: 1, mobile: false });
await page.goto(FOCAL_URL);
await sleep(8000);
out.narrow1000 = await page.evaluate(() => ({
  ladState: document.documentElement.getAttribute("data-peek-lad-state"),
  styleMounted: Boolean(document.getElementById("peek-lad-style")),
  fixedArticle: (() => {
    const a = document.querySelector("article[data-peek-lad-focal]");
    if (!a) return null;
    const s = getComputedStyle(a);
    return { position: s.position, width: Math.round(a.getBoundingClientRect().width) };
  })(),
}));
await page.screenshot({ path: "/Users/devon/claude/peek-main/docs/m2-b1/evidence/s3-narrow-1000.png" });
await page.cdp("Emulation.clearDeviceMetricsOverride", {});

import { writeFileSync } from "node:fs";
writeFileSync("/Users/devon/claude/peek-main/docs/m2-b1/evidence/s3-scroll-results.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
