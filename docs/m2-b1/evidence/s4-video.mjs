// M2-B1 S4 — native video interaction acceptance on the real lab extension.
// All actions are real pointer events on X's own player controls; read-only
// checks around them. No account writes.
const task = await taskSpace(1);
const page = task.page("p1");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};

const videoState = () => page.evaluate(() => {
  const art = document.querySelector("article[data-peek-lad-focal]");
  const v = art?.querySelector("video");
  if (!v) return null;
  return {
    same: v.dataset.peekS4 === "identity",
    time: +v.currentTime.toFixed(2),
    paused: v.paused,
    muted: v.muted,
    volume: +v.volume.toFixed(2),
    readyState: v.readyState,
  };
});

await page.goto("https://x.com/thinkszyg/status/2109309251533570509");
await sleep(9000);
await page.evaluate(() => {
  const art = document.querySelector("article[data-peek-lad-focal]");
  art.scrollTop = 220;
  const v = art.querySelector("video");
  v.dataset.peekS4 = "identity";
});
await sleep(800);
out.t0 = await videoState();

// 1) pause via the native 暂停 control
await page.mouse.move(348, 500, { label: "悬停播放器" });
await sleep(900);
await page.mouse.click(39, 697, { label: "点击原生暂停按钮" });
await sleep(1200);
out.afterPause = await videoState();
// time must not advance while paused
await sleep(1500);
out.pausedStill = await videoState();

// 2) resume via the same control (now labeled 播放)
await page.mouse.move(348, 500, { label: "悬停播放器" });
await sleep(900);
await page.mouse.click(39, 697, { label: "点击原生播放按钮" });
await sleep(1000);
out.afterResume = await videoState();

// 3) seek: click the progress bar at ~60% (the bar sits just above the buttons)
out.seek = await (async () => {
  const bar = await page.evaluate(() => {
    const art = document.querySelector("article[data-peek-lad-focal]");
    const player = art.querySelector("[data-testid=videoPlayer]");
    // X's seek bar: an input[role=slider] or the progress rail inside the player
    const slider = player.querySelector("[role=slider], input[type=range]");
    if (!slider) return null;
    const r = slider.getBoundingClientRect();
    return { x: r.x + r.width * 0.6, y: r.y + r.height / 2, w: Math.round(r.width) };
  });
  if (!bar) return { error: "no slider found" };
  await page.mouse.move(348, 500, { label: "悬停播放器" });
  await sleep(800);
  await page.mouse.click(bar.x, bar.y, { label: "点击进度条 60% 处" });
  await sleep(1200);
  return { clicked: true, at: bar, state: await videoState() };
})();

// 4) mute toggle via the native control (取消隐藏 = unmute)
await page.mouse.move(348, 500, { label: "悬停播放器" });
await sleep(900);
await page.mouse.click(549, 697, { label: "点击原生静音切换" });
await sleep(900);
out.afterMuteToggle = await videoState();

// 5) fullscreen enter via the native 全屏 control
await page.mouse.move(348, 500, { label: "悬停播放器" });
await sleep(900);
await page.mouse.click(657, 697, { label: "点击原生全屏按钮" });
await sleep(2000);
out.fullscreen = await page.evaluate(() => ({
  fullscreenElement: document.fullscreenElement ? document.fullscreenElement.tagName : null,
  videoRect: (() => { const v = document.querySelector("article[data-peek-lad-focal] video"); if (!v) return null; const r = v.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
  focalStillConnected: Boolean(document.querySelector("article[data-peek-lad-focal]")?.isConnected),
}));
await page.screenshot({ path: "/Users/devon/claude/peek-main/docs/m2-b1/evidence/s4-video-fullscreen.png" });

// 6) fullscreen exit via Esc (X's own Esc handling — the adapter owns no Esc)
await page.keyboard.press("Escape");
await sleep(1500);
out.fullscreenExit = await page.evaluate(() => ({
  fullscreenElement: document.fullscreenElement ? document.fullscreenElement.tagName : null,
  focalStillConnected: Boolean(document.querySelector("article[data-peek-lad-focal]")?.isConnected),
  adapterStillActive: document.documentElement.getAttribute("data-peek-lad-state"),
}));

// 7) tab switch away and back: identity + playback survive
const p2 = await task.newPage();
await p2.goto("https://x.com/home");
await sleep(4000);
await task.finish ? null : null; // no-op guard
await p2.close();
await sleep(2000);
out.afterTabSwitch = await videoState();

import { writeFileSync } from "node:fs";
writeFileSync("/Users/devon/claude/peek-main/docs/m2-b1/evidence/s4-video-results.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
