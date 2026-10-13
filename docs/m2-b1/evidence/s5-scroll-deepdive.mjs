// S5 deep-dive: decompose the deep-scroll frame cost in adapter mode.
// Scenarios: video playing vs paused; deep vs shallow; adapter on vs off.
const task = await taskSpace("peek m2b1 lab verification");
const page = task.page("p1");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const POST = "https://x.com/thinkszyg/status/2109956494661656931";
const out = {};

async function setAdapter(on) {
  console.log("[phase] setAdapter", on);
  await page.goto("chrome://extensions/");
  await sleep(1200);
  const r = await page.evaluate((on) => {
    const mgr = document.querySelector("extensions-manager");
    const list = mgr.shadowRoot.querySelector("extensions-item-list");
    const item = [...list.shadowRoot.querySelectorAll("extensions-item")].find(i => i.shadowRoot.querySelector("#name")?.textContent?.includes("M2-B1"));
    const toggle = item.shadowRoot.querySelector("cr-toggle");
    const pressed = toggle.getAttribute("aria-pressed") === "true";
    if (pressed !== on) toggle.click();
    return { pressed, target: on };
  }, on);
  await sleep(1200);
  console.log("[phase] setAdapter done", JSON.stringify(r));
  return r;
}

async function measure(label) {
  console.log("[phase] measure", label);
  await page.goto(POST);
  await sleep(7000);
  console.log("[phase] shallow evaluate");
  const shallow = await page.evaluate(async () => {
    const frames = [];
    let t0 = performance.now();
    for (let y = 0; y <= 1500; y += 150) { window.scrollTo(0, y); await new Promise((res) => requestAnimationFrame(() => res())); frames.push(+(performance.now() - t0).toFixed(1)); t0 = performance.now(); }
    return { frames, total: Math.round(frames.reduce((a, b) => a + b, 0)) };
  });
  console.log("[phase] deep evaluate");
  const deep = await page.evaluate(async () => {
    await window.scrollTo(0, 0);
    await new Promise((res) => setTimeout(res, 300));
    const frames = [];
    let t0 = performance.now();
    for (let y = 0; y <= 5000; y += 500) { window.scrollTo(0, y); await new Promise((res) => requestAnimationFrame(() => res())); frames.push(+(performance.now() - t0).toFixed(1)); t0 = performance.now(); }
    const v = document.querySelector("article video");
    return { frames, total: Math.round(frames.reduce((a, b) => a + b, 0)), videoPresent: Boolean(v), videoPaused: v ? v.paused : null };
  });
  const r = { shallowFrames: shallow.frames, shallowTotal: shallow.total, deepFrames: deep.frames, deepTotal: deep.total, videoPresent: deep.videoPresent, videoPaused: deep.videoPaused };
  out[label] = r;
}

// adapter ON, video playing
await setAdapter(true);
await measure("adapterOn_videoPlaying");
// adapter ON, video paused
console.log("[phase] pause video");
await page.evaluate(() => { const v = document.querySelector("article video"); if (v) { v.pause(); } });
await sleep(500);
out.adapterOn_videoPaused = await page.evaluate(async () => {
  await window.scrollTo(0, 0);
  await new Promise((res) => setTimeout(res, 400));
  const deep = [];
  let t0 = performance.now();
  for (let y = 0; y <= 5000; y += 500) { window.scrollTo(0, y); await new Promise((res) => requestAnimationFrame(() => res())); deep.push(+(performance.now() - t0).toFixed(1)); t0 = performance.now(); }
  return { deepTotal: Math.round(deep.reduce((a, b) => a + b, 0)), deepFrames: deep, videoPaused: document.querySelector("article video")?.paused };
});
// adapter OFF (native)
await setAdapter(false);
await page.goto(POST);
await sleep(7000);
out.adapterOff_native = await page.evaluate(async () => {
  const frames = [];
  let t0 = performance.now();
  for (let y = 0; y <= 1500; y += 150) { window.scrollTo(0, y); await new Promise((res) => requestAnimationFrame(() => res())); frames.push(+(performance.now() - t0).toFixed(1)); t0 = performance.now(); }
  await window.scrollTo(0, 0);
  await new Promise((res) => setTimeout(res, 400));
  const deep = [];
  t0 = performance.now();
  for (let y = 0; y <= 5000; y += 500) { window.scrollTo(0, y); await new Promise((res) => requestAnimationFrame(() => res())); deep.push(+(performance.now() - t0).toFixed(1)); t0 = performance.now(); }
  return { shallowTotal: Math.round(frames.reduce((a, b) => a + b, 0)), deepTotal: Math.round(deep.reduce((a, b) => a + b, 0)), deepFrames: deep };
});
await setAdapter(true); // restore for later passes

import { writeFileSync } from "node:fs";
writeFileSync("/Users/devon/claude/peek-main/docs/m2-b1/evidence/s5-scroll-deepdive.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
