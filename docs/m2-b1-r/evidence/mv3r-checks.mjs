// M2-B1-R — real-MV3 acceptance supplement (P1-D). Runs in the browser with
// the LAB build loaded via --load-extension (real extension runtime, real
// manifest world:MAIN registration). Read-only toward the account: clicks,
// scrolling, and keyboard are interaction, never a post/like/follow write.
// Every check records what was ACTUALLY observed; NOT_TESTED stays NOT_TESTED.
const task = await taskSpace("peek m2b1r mv3 acceptance");
const page = task.page("p1");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { startedAt: new Date().toISOString() };
const j = (x) => JSON.stringify(x);

// --- check 1: chrome://extensions card (enabled, correct name/version) ---
await page.goto("chrome://extensions/", { timeout: 15000 }).catch((e) => out.extNavError = String(e).slice(0, 80));
await sleep(2500);
out.extCard = await page.evaluate(() => {
  const mgr = document.querySelector("extensions-manager");
  if (!mgr) return { webui: false };
  const items = mgr.shadowRoot?.querySelector("extensions-item-list")?.shadowRoot?.querySelectorAll("extensions-item") ?? [];
  for (const it of items) {
    const sr = it.shadowRoot;
    const name = sr?.querySelector("#name")?.textContent?.trim() ?? "";
    if (name.includes("Peek")) {
      return {
        webui: true, name, id: it.id,
        enabled: Boolean(sr?.querySelector("cr-toggle[aria-pressed='true'], cr-toggle[checked]")),
        version: sr?.querySelector("#version")?.textContent?.trim() ?? null,
        devMode: mgr.shadowRoot?.querySelector("#devMode")?.getAttribute("aria-pressed") ?? mgr.shadowRoot?.querySelector("#devMode")?.checked ?? null,
      };
    }
  }
  return { webui: true, peekFound: false, count: items.length };
});
console.log("check1 extCard:", j(out.extCard));

// --- check 2/3/5: video post — playback, native controls, pause/progress/mute ---
await page.goto("https://x.com/thinkszyg/status/2109309251533570509", { timeout: 30000 }).catch(() => {});
await sleep(7000);
out.video = {};
out.video.split = await page.evaluate(() => ({
  state: document.documentElement.getAttribute("data-peek-lad-state"),
  focal: Boolean(document.querySelector("article[data-peek-lad-focal]")),
  video: Boolean(document.querySelector("article[data-peek-lad-focal] video")),
  focalCount: document.querySelectorAll("article[data-peek-lad-focal]").length,
}));
const vidState = () => page.evaluate(() => {
  const v = document.querySelector("article[data-peek-lad-focal] video") || document.querySelector("article video");
  if (!v) return { video: false };
  return { video: true, paused: v.paused, t: +v.currentTime.toFixed(2), ready: v.readyState, muted: v.muted, duration: Number.isFinite(v.duration) ? +v.duration.toFixed(1) : null };
});
out.video.t0 = await vidState();
await sleep(3000);
out.video.t3s = await vidState(); // progress proves real playback
// pause via the native control (read-only UI interaction)
const pauseBtn = await page.evaluate(() => {
  const scope = document.querySelector("article[data-peek-lad-focal]") || document;
  const b = scope.querySelector('[data-testid="videoPlayer"] button[aria-label*="暂停"], [data-testid="videoPlayer"] button[aria-label*="Pause"]');
  if (b) { const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; }
  return null;
});
if (pauseBtn) { await page.mouse.click(pauseBtn.x, pauseBtn.y, { label: "点击原生暂停按钮" }); await sleep(800); }
out.video.afterPauseClick = await vidState();
// mute toggle
const muteBtn = await page.evaluate(() => {
  const scope = document.querySelector("article[data-peek-lad-focal]") || document;
  const b = scope.querySelector('button[aria-label*="静音"], button[aria-label*="Mute"], button[aria-label*="取消静音"], button[aria-label*="Unmute"]');
  if (b) { const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; }
  return null;
});
if (muteBtn) { await page.mouse.click(muteBtn.x, muteBtn.y, { label: "点击原生静音控件" }); await sleep(500); }
out.video.afterMuteClick = await vidState();
console.log("video:", j(out.video));

// --- check: fullscreen + physical Esc ---
const fsBtn = await page.evaluate(() => {
  const scope = document.querySelector("article[data-peek-lad-focal]") || document;
  const b = scope.querySelector('button[aria-label*="全屏"], button[aria-label*="Fullscreen"], button[aria-label*="全屏幕"]');
  if (b) { const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; }
  return null;
});
if (fsBtn) {
  await page.mouse.click(fsBtn.x, fsBtn.y, { label: "点击原生全屏按钮" });
  await sleep(2000);
  out.fullscreen = await page.evaluate(() => ({ fs: Boolean(document.fullscreenElement), tag: document.fullscreenElement?.tagName ?? null }));
  await page.keyboard.press("Escape"); // physical-key-level Esc via real input pipeline
  await sleep(1500);
  out.fullscreenAfterEsc = await page.evaluate(() => ({ fs: Boolean(document.fullscreenElement) }));
  out.video.afterEsc = await vidState();
}
console.log("fullscreen+esc:", j({ fs: out.fullscreen, afterEsc: out.fullscreenAfterEsc, video: out.video.afterEsc }));

// --- check 6: multi-photo viewer + Esc ---
await page.goto("https://x.com/KinGao476942/status/2099877465795735861", { timeout: 30000 }).catch(() => {});
await sleep(7000);
const photoPos = await page.evaluate(() => {
  const scope = document.querySelector("article[data-peek-lad-focal]") || document.querySelector("article");
  const img = scope?.querySelector('[data-testid="tweetPhoto"]');
  if (!img) return null;
  const r = img.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
});
if (photoPos) {
  await page.mouse.click(photoPos.x, photoPos.y, { label: "打开原生图片查看器" });
  await sleep(2500);
  out.lightbox = await page.evaluate(() => ({
    open: Boolean(document.querySelector('[data-testid="lightbox"]')),
    next: Boolean(document.querySelector('[data-testid="lightbox"] [aria-label*="下一步"], [data-testid="lightbox"] [aria-label*="Next"]')),
  }));
  const nextBtn = await page.evaluate(() => {
    const b = document.querySelector('[data-testid="lightbox"] [aria-label*="下一步"], [data-testid="lightbox"] [aria-label*="Next"]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  });
  if (nextBtn) { await page.mouse.click(nextBtn.x, nextBtn.y, { label: "查看器翻到下一张" }); await sleep(1200); out.lightboxAfterNext = await page.evaluate(() => ({ open: Boolean(document.querySelector('[data-testid="lightbox"]')) })); }
  await page.keyboard.press("Escape"); // physical Esc closes the viewer
  await sleep(1500);
  out.lightboxAfterEsc = await page.evaluate(() => ({ open: Boolean(document.querySelector('[data-testid="lightbox"]')), focalStill: Boolean(document.querySelector("article[data-peek-lad-focal]")) }));
}
console.log("lightbox+esc:", j({ lb: out.lightbox, next: out.lightboxAfterNext, esc: out.lightboxAfterEsc }));

// --- check 7: quick switch + browser back/forward ---
out.quickSwitch = {};
const replyLink = await page.evaluate(() => {
  const id = location.pathname.match(/status\/(\d+)/)?.[1];
  for (const c of document.querySelectorAll('[data-testid="cellInnerDiv"]')) {
    const art = c.querySelector("article");
    if (!art) continue;
    if ([...art.querySelectorAll("a[href] time")].some((t) => (t.closest("a").getAttribute("href") || "").includes("/" + id))) continue;
    const link = [...art.querySelectorAll("a[href] time")].map((t) => t.closest("a")).find(Boolean);
    if (!link) continue;
    const r = link.getBoundingClientRect();
    if (r.top > 0 && r.bottom < innerHeight) return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), href: link.getAttribute("href") };
  }
  return null;
});
if (replyLink) {
  await page.mouse.click(replyLink.x, replyLink.y, { label: "点击右栏回复切到帖子B" });
  await sleep(6000);
  out.quickSwitch.b = await page.evaluate(() => ({
    path: location.pathname.slice(0, 44),
    state: document.documentElement.getAttribute("data-peek-lad-state"),
    focalCount: document.querySelectorAll("article[data-peek-lad-focal]").length,
    focalMarked: Boolean(document.querySelector("article[data-peek-lad-focal]")),
  }));
  await page.evaluate(() => history.back()); await sleep(5000); // session-history traversal (same entry as the browser back button)
  out.quickSwitch.back = await page.evaluate(() => ({
    path: location.pathname.slice(0, 44),
    state: document.documentElement.getAttribute("data-peek-lad-state"),
    focalCount: document.querySelectorAll("article[data-peek-lad-focal]").length,
  }));
  await page.evaluate(() => history.forward()); await sleep(5000); // session-history traversal (same entry as the browser forward button)
  out.quickSwitch.forward = await page.evaluate(() => ({
    path: location.pathname.slice(0, 44),
    state: document.documentElement.getAttribute("data-peek-lad-state"),
    focalCount: document.querySelectorAll("article[data-peek-lad-focal]").length,
  }));
}
console.log("quickSwitch:", j(out.quickSwitch));

// --- check 11: simulated structural mismatch (delete the wrapped method) —
// the adapter must exit safely and the native single column must be readable ---
out.mismatch = {};
out.mismatch.before = await page.evaluate(() => ({
  state: document.documentElement.getAttribute("data-peek-lad-state"), style: Boolean(document.getElementById("peek-lad-style")),
}));
out.mismatch.deleted = await page.evaluate(() => {
  const id = location.pathname.match(/status\/(\d+)/)?.[1];
  const cell = [...document.querySelectorAll("article[data-testid=tweet]")].find((x) => [...x.querySelectorAll("a[href] time")].some((t) => (t.closest("a").getAttribute("href") || "").includes("/" + id)))?.closest('[data-testid="cellInnerDiv"]');
  if (!cell) return "no-cell";
  const fiberKey = Object.keys(cell).find((k) => k.startsWith("__reactFiber"));
  let fiber = cell[fiberKey];
  while (fiber && !(fiber.stateNode && typeof fiber.stateNode._getFinalRenderedItems === "function")) fiber = fiber.return;
  const inst = fiber?.stateNode;
  if (!inst) return "no-virtualizer";
  const wasOwn = Object.prototype.hasOwnProperty.call(inst, "_getFinalRenderedItems");
  delete inst._getFinalRenderedItems; // X "replaced" the method — worst-case drift
  return { deleted: wasOwn };
});
await sleep(4000); // health interval is 1500ms — exit must land within two ticks
out.mismatch.after = await page.evaluate(() => ({
  state: document.documentElement.getAttribute("data-peek-lad-state"),
  style: Boolean(document.getElementById("peek-lad-style")),
  failedAttr: document.documentElement.getAttribute("data-peek-lad-failed"),
  htmlAttr: document.documentElement.getAttribute("data-peek-lad"),
  nativeReadable: Boolean([...document.querySelectorAll("article[data-testid=tweet]")].find((x) => [...x.querySelectorAll("a[href] time")].some((t) => (t.closest("a").getAttribute("href") || "").includes("/" + (location.pathname.match(/status\/(\d+)/)?.[1] ?? ""))) && x.querySelector('[data-testid="tweetText"]')?.textContent?.trim())),
}));
console.log("mismatch:", j(out.mismatch));

// --- check 12/13: X Article / GIF / poll (read-only presence) ---
// poll: find a poll post via search (read-only), verify it renders in the focal pane
await page.goto("https://x.com/search?q=filter%3Afollows%20filter%3Alegacy_verified%20poll&src=typed_query&f=top", { timeout: 30000 }).catch(() => {});
await sleep(4000);
out.pollSearch = await page.evaluate(() => {
  // direct nav to a known poll-bearing account timeline instead if search fails
  return { cells: document.querySelectorAll('[data-testid="cellInnerDiv"]').length };
});
await page.goto("https://x.com/ruanyf", { timeout: 30000 }).catch(() => {});
await sleep(4000);
out.pollHunt = await page.evaluate(() => {
  const cells = [...document.querySelectorAll('[data-testid="cellInnerDiv"]')];
  for (const c of cells.slice(0, 8)) {
    const a = [...c.querySelectorAll("a[href] time")].map((t) => t.closest("a")).find((x) => x && !x.closest('div[role="link"]'));
    if (a && c.querySelector('[data-testid="poll"], [role="group"] [data-testid="vote"]')) return { href: a.getAttribute("href"), poll: true };
  }
  return { poll: false };
});
console.log("pollHunt:", j(out.pollHunt));

import { writeFileSync } from "node:fs";
writeFileSync("/Users/devon/claude/peek-main/docs/m2-b1-r/evidence/mv3r-checks.json", JSON.stringify(out, null, 1));
console.log("DONE");
