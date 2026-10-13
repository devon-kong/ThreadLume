// S7 remediation — re-archive the evidence the independent reviewer found
// missing or contradictory (P1-1 seek, P1-2 lightbox via role=dialog,
// P1-3 controlled deep-dive on a real VIDEO post with per-scenario video
// state, P1-4 composer placeholder-aware clean check + real quick-switch).
const task = await taskSpace("peek m2b1 lab verification");
const page = task.page("p1");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};

// ---------- P1-1: progress-rail seek on the KNOWN video post ----------
await page.goto("https://x.com/thinkszyg/status/2109309251533570509");
await sleep(9000);
await page.evaluate(() => {
  const art = document.querySelector("article[data-peek-lad-focal]");
  art.scrollTop = 220;
  const v = art.querySelector("video");
  v.dataset.peekS7 = "identity";
  v.muted = true;
});
await sleep(800);
out.seek = await (async () => {
  await page.mouse.move(348, 500, { label: "悬停播放器" });
  await sleep(600);
  await page.mouse.move(348, 690, { label: "悬停控件区" });
  await sleep(1500);
  const rails = await page.evaluate(() => {
    const art = document.querySelector("article[data-peek-lad-focal]");
    const player = art.querySelector("[data-testid=videoPlayer]");
    return [...player.querySelectorAll("div")].map((d) => { const r = d.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })
      .filter((r) => r.w > 400 && r.h <= 24 && r.h > 0 && r.y > 500);
  });
  const rail = rails.sort((a, b) => b.w - a.w)[0];
  if (!rail) return { error: "no rail" };
  const before = await page.evaluate(() => +document.querySelector("article[data-peek-lad-focal] video").currentTime.toFixed(2));
  const duration = await page.evaluate(() => { const d = document.querySelector("article[data-peek-lad-focal] video").duration; return Number.isFinite(d) ? +d.toFixed(1) : null; });
  await page.mouse.click(rail.x + rail.w * 0.5, rail.y + rail.h / 2, { label: "点击进度条中点" });
  await sleep(1200);
  const after = await page.evaluate(() => +document.querySelector("article[data-peek-lad-focal] video").currentTime.toFixed(2));
  return { railWidth: Math.round(rail.w), duration, timeBefore: before, timeAfter: after, seekedToMidpoint: Math.abs(after - duration / 2) < Math.max(2, duration * 0.15), jumped: Math.abs(after - before) > 3 };
})();

// ---------- P1-2: lightbox via role=dialog on the 2-photo post ----------
await page.goto("https://x.com/KinGao476942/status/2109792240776421482");
await sleep(9000);
out.lightbox = await (async () => {
  const ph = await page.evaluate(() => {
    const art = document.querySelector("article[data-peek-lad-focal]");
    const img = art?.querySelector("[data-testid=tweetPhoto] img");
    if (!img) return null;
    const r = img.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  });
  if (!ph) return { error: "no photo" };
  await page.mouse.click(ph.x, ph.y, { label: "点击左栏图片" });
  await sleep(2500);
  const open = await page.evaluate(() => {
    const dlgs = [...document.querySelectorAll("div[role=dialog]")];
    const viewer = dlgs.find((d) => d.querySelector("img[src*='pbs.twimg.com/media']"));
    return {
      dialogsOpen: dlgs.length,
      viewerOpen: Boolean(viewer),
      viewerImages: viewer ? viewer.querySelectorAll("img").length : 0,
      htmlOverflowByX: document.documentElement.style.overflow || "(unset)",
    };
  });
  await page.screenshot({ path: "/Users/devon/claude/peek-main/docs/m2-b1/evidence/s7-lightbox-open.png" });
  await page.keyboard.press("Escape");
  await sleep(1500);
  const closed = await page.evaluate(() => ({
    dialogsOpen: document.querySelectorAll("div[role=dialog]").length,
    focalConnected: Boolean(document.querySelector("article[data-peek-lad-focal]")?.isConnected),
    adapterState: document.documentElement.getAttribute("data-peek-lad-state"),
  }));
  return { open, closed };
})();

// ---------- P1-3: controlled deep-dive on the real VIDEO post ----------
const VIDEO_POST = "https://x.com/thinkszyg/status/2109309251533570509";
async function measure(label) {
  await page.goto(VIDEO_POST);
  await sleep(8000);
  const shallow = await page.evaluate(async () => {
    const v0 = document.querySelector("article[data-peek-lad-focal] video");
    if (v0) { v0.muted = true; v0.play?.().catch(() => {}); }
    const frames = [];
    let t0 = performance.now();
    for (let y = 0; y <= 1500; y += 150) { window.scrollTo(0, y); await new Promise((res) => requestAnimationFrame(() => res())); frames.push(+(performance.now() - t0).toFixed(1)); t0 = performance.now(); }
    return { total: Math.round(frames.reduce((a, b) => a + b, 0)) };
  });
  await sleep(400);
  const deep = await page.evaluate(async () => {
    await window.scrollTo(0, 0);
    await new Promise((res) => setTimeout(res, 300));
    const frames = [];
    let t0 = performance.now();
    for (let y = 0; y <= 5000; y += 500) { window.scrollTo(0, y); await new Promise((res) => requestAnimationFrame(() => res())); frames.push(+(performance.now() - t0).toFixed(1)); t0 = performance.now(); }
    const v = document.querySelector("article[data-peek-lad-focal] video");
    return { total: Math.round(frames.reduce((a, b) => a + b, 0)), videoPresent: Boolean(v), videoPaused: v ? v.paused : null, videoTime: v ? +v.currentTime.toFixed(1) : null };
  });
  out[label] = { shallowTotal: shallow.total, deepTotal: deep.total, videoPresent: deep.videoPresent, videoPaused: deep.videoPaused, videoTimeAtEnd: deep.videoTime };
}
// scenario 1: adapter ON, video playing (not paused beforehand)
await measure("adapterOn_videoPlaying");
// scenario 2: adapter ON, video paused BEFORE measuring
await page.evaluate(() => document.querySelector("article[data-peek-lad-focal] video")?.pause());
await sleep(500);
await measure("adapterOn_videoPaused");
// scenario 3: adapter OFF (native)
await page.goto("chrome://extensions/");
await sleep(1200);
await page.evaluate(() => {
  const mgr = document.querySelector("extensions-manager");
  const list = mgr.shadowRoot.querySelector("extensions-item-list");
  const item = [...list.shadowRoot.querySelectorAll("extensions-item")].find(i => i.shadowRoot.querySelector("#name")?.textContent?.includes("M2-B1"));
  const toggle = item.shadowRoot.querySelector("cr-toggle");
  if (toggle.getAttribute("aria-pressed") === "true") toggle.click();
});
await sleep(1500);
await measure("adapterOff_native");
// restore adapter ON
await page.goto("chrome://extensions/");
await sleep(1200);
await page.evaluate(() => {
  const mgr = document.querySelector("extensions-manager");
  const list = mgr.shadowRoot.querySelector("extensions-item-list");
  const item = [...list.shadowRoot.querySelectorAll("extensions-item")].find(i => i.shadowRoot.querySelector("#name")?.textContent?.includes("M2-B1"));
  const toggle = item.shadowRoot.querySelector("cr-toggle");
  if (toggle.getAttribute("aria-pressed") !== "true") toggle.click();
});
await sleep(1000);

// ---------- P1-4: composer placeholder-aware check + quick switch ----------
await page.goto("https://x.com/thinkszyg/status/2109309251533570509");
await sleep(9000);
out.composer = await (async () => {
  const box = await page.evaluate(() => {
    const b = document.querySelector("[data-testid^=tweetTextarea_0]");
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), inRight: r.left > innerWidth * 0.5 };
  });
  if (!box) return { error: "no composer" };
  await page.mouse.click(box.x, box.y, { label: "聚焦右栏编辑器" });
  await sleep(600);
  await page.keyboard.type("peek-m2b1-check", { delay: 15 });
  await sleep(500);
  const typed = await page.evaluate(() => {
    const b = document.querySelector("[data-testid^=tweetTextarea_0]");
    return { text: b?.textContent ?? "", draftVisible: Boolean(b?.dataset?.textContent?.includes?.("peek")) || (b?.textContent || "").includes("peek") };
  });
  for (let i = 0; i < 18; i++) await page.keyboard.press("Backspace");
  await sleep(500);
  const cleared = await page.evaluate(() => {
    const b = document.querySelector("[data-testid^=tweetTextarea_0]");
    const t = (b?.textContent || "").trim();
    // the placeholder ("发布你的回复") renders as content of the empty editor —
    // empty means: no user text beyond the placeholder
    return { text: t, isEmptyOrPlaceholder: t === "" || t === "发布你的回复" };
  });
  return { composerInRightPane: box.inRight, typed: typed, cleared: cleared };
})();

// real quick switch A → B (click a reply timestamp inside the right column)
out.quickSwitch = await (async () => {
  await page.goto("https://x.com/KinGao476942/status/2109792240776421482");
  await sleep(9000);
  const a = await page.evaluate(() => ({ url: location.pathname.slice(0, 50), state: document.documentElement.getAttribute("data-peek-lad-state"), focal: document.querySelectorAll("article[data-peek-lad-focal]").length }));
  for (let i = 0; i < 5; i++) {
    const link = await page.evaluate(() => {
      const art = document.querySelector("article[data-peek-lad-focal]");
      const id = location.pathname.match(/status\/(\d+)/)?.[1];
      window.scrollBy(0, 700);
      for (const c of document.querySelectorAll("[data-testid=cellInnerDiv]")) {
        const ca = c.querySelector("article");
        if (!ca || (art && art.contains(ca))) continue;
        const own = [...ca.querySelectorAll("a")].some(x => x.querySelector("time") && (x.getAttribute("href") || "").includes("/" + id));
        if (own) continue;
        const l = [...ca.querySelectorAll("a")].find(x => x.querySelector("time"));
        if (!l) continue;
        const r = l.getBoundingClientRect();
        if (r.top > 60 && r.bottom < innerHeight - 10) return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      }
      return null;
    });
    if (link) {
      await page.mouse.click(link.x, link.y, { label: "点击右栏回复时间链接" });
      await sleep(6000);
      const b = await page.evaluate(() => ({
        url: location.pathname.slice(0, 50),
        state: document.documentElement.getAttribute("data-peek-lad-state"),
        focalCount: document.querySelectorAll("article[data-peek-lad-focal]").length,
        composerPresent: Boolean(document.querySelector("[data-testid^=tweetTextarea_0]")),
      }));
      return { from: a, to: b, switched: b.url.includes("/status/") && b.focalCount === 1 && b.state === "active" };
    }
    await sleep(1200);
  }
  return { from: a, note: "no clickable reply link found" };
})();

import { writeFileSync } from "node:fs";
writeFileSync("/Users/devon/claude/peek-main/docs/m2-b1/evidence/s7-remediation.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
