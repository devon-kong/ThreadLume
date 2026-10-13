// S4 — photos: multi-image rendering, native lightbox open, Esc close.
const task = await taskSpace(1);
const page = task.page("p1");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};

await page.goto("https://x.com/KinGao476942/status/2109792240776421482");
await sleep(9000);
out.render = await page.evaluate(() => {
  const art = document.querySelector("article[data-peek-lad-focal]");
  return {
    adapterState: document.documentElement.getAttribute("data-peek-lad-state"),
    focalMarked: Boolean(art),
    photos: art ? art.querySelectorAll("[data-testid=tweetPhoto] img").length : 0,
    actionsInFocal: art ? Boolean(art.querySelector("[data-testid=reply], [data-testid=like]")) : false,
  };
});
await page.screenshot({ path: "/Users/devon/claude/peek-main/docs/m2-b1/evidence/s4-photo-post.png" });

// open the native image viewer from the LEFT pane (real click on first photo)
const photoBox = await page.evaluate(() => {
  const art = document.querySelector("article[data-peek-lad-focal]");
  const img = art?.querySelector("[data-testid=tweetPhoto] img");
  if (!img) return null;
  const r = img.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), count: art.querySelectorAll("[data-testid=tweetPhoto] img").length };
});
if (photoBox) {
  await page.mouse.click(photoBox.x, photoBox.y, { label: "点击左栏图片打开查看器" });
  await sleep(2500);
  out.lightbox = await page.evaluate(() => ({
    open: Boolean(document.querySelector("[data-testid=lightbox]")),
    imagesInLightbox: document.querySelectorAll("[data-testid=lightbox] img").length,
  }));
  await page.screenshot({ path: "/Users/devon/claude/peek-main/docs/m2-b1/evidence/s4-photo-lightbox.png" });
  // Esc closes the viewer (X's own Esc — the adapter must NOT steal it)
  await page.keyboard.press("Escape");
  await sleep(1500);
  out.lightboxClosed = await page.evaluate(() => ({
    open: Boolean(document.querySelector("[data-testid=lightbox]")),
    focalStillConnected: Boolean(document.querySelector("article[data-peek-lad-focal]")?.isConnected),
    adapterState: document.documentElement.getAttribute("data-peek-lad-state"),
  }));
}

import { writeFileSync } from "node:fs";
writeFileSync("/Users/devon/claude/peek-main/docs/m2-b1/evidence/s4-photo-results.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
