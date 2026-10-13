// S4 follow-up: proper progress-rail seek + fullscreen exit + duplicate check.
const task = await taskSpace(1);
const page = task.page("p1");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};

await page.goto("https://x.com/thinkszyg/status/2109309251533570509");
await sleep(9000);
await page.evaluate(() => {
  const art = document.querySelector("article[data-peek-lad-focal]");
  art.scrollTop = 220;
  const v = art.querySelector("video");
  v.dataset.peekS4 = "identity";
  v.muted = true;
});
await sleep(800);

// find the WIDEST slider (the real scrub rail)
out.seek = await (async () => {
  const bars = await page.evaluate(() => {
    const art = document.querySelector("article[data-peek-lad-focal]");
    const player = art.querySelector("[data-testid=videoPlayer]");
    return [...player.querySelectorAll("[role=slider], input[type=range]")].map((s) => {
      const r = s.getBoundingClientRect();
      return { x: r.x, y: r.y + r.height / 2, w: Math.round(r.width), aria: s.getAttribute("aria-label") };
    });
  });
  const rail = bars.sort((a, b) => b.w - a.w)[0];
  if (!rail || rail.w < 100) return { bars, error: "no wide rail" };
  const before = await page.evaluate(() => +document.querySelector("article[data-peek-lad-focal] video").currentTime.toFixed(2));
  await page.mouse.move(348, 500, { label: "悬停播放器" });
  await sleep(800);
  await page.mouse.click(rail.x + rail.w * 0.15, rail.y, { label: "点击进度条 15% 处" });
  await sleep(1000);
  const after = await page.evaluate(() => +document.querySelector("article[data-peek-lad-focal] video").currentTime.toFixed(2));
  return { rail, timeBefore: before, timeAfter: after, seeked: Math.abs(after - before) > 1.5 };
})();

// fullscreen exit via exitFullscreen (the browser-level Esc keypress cannot be
// synthesized over CDP — noted for the L4 physical-keyboard checklist)
out.fullscreenExit = await (async () => {
  await page.mouse.move(348, 500, { label: "悬停播放器" });
  await sleep(800);
  await page.mouse.click(657, 697, { label: "进入全屏" });
  await sleep(1800);
  const entered = await page.evaluate(() => Boolean(document.fullscreenElement));
  await page.evaluate(() => document.exitFullscreen?.());
  await sleep(1200);
  const exited = await page.evaluate(() => !document.fullscreenElement);
  return { entered, exitedViaExitFullscreen: exited };
})();

// duplicate player check + overall integrity after all interactions
out.integrity = await page.evaluate(() => {
  const art = document.querySelector("article[data-peek-lad-focal]");
  return {
    videoCountInFocal: art.querySelectorAll("video").length,
    focalCellCount: document.querySelectorAll("article[data-peek-lad-focal]").length,
    adapterState: document.documentElement.getAttribute("data-peek-lad-state"),
    videoSame: art.querySelector("video")?.dataset?.peekS4 === "identity",
    videoPlaying: !art.querySelector("video")?.paused,
  };
});

import { writeFileSync } from "node:fs";
writeFileSync("/Users/devon/claude/peek-main/docs/m2-b1/evidence/s4-video2-results.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
