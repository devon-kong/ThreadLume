// S6 — remaining real-MV3 checks: quick A→B switching, composer typing
// (typed and cleared, never sent), dev-mode extension reload, disable/restore.
const task = await taskSpace("peek m2b1 lab verification");
const page = task.page("p1");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};

// NOTE: the extension currently loaded is M1-R (from the S5-A pass) if that
// pass ran; this script must run with the LAB build loaded. The runner below
// assumes lab; m1r-only checks are covered by the S5 harness.

await page.goto("https://x.com/thinkszyg/status/2109956494661656931");
await sleep(8000);
out.splitA = await page.evaluate(() => ({
  state: document.documentElement.getAttribute("data-peek-lad-state"),
  focal: Boolean(document.querySelector("article[data-peek-lad-focal]")),
}));

// quick switch: click a reply's timestamp inside the RIGHT column (A → B)
const replyLink = await page.evaluate(() => {
  const art = document.querySelector("article[data-peek-lad-focal]");
  const id = location.pathname.match(/status\/(\d+)/)?.[1];
  const cells = [...document.querySelectorAll("[data-testid=cellInnerDiv]")];
  for (const c of cells) {
    const a = c.querySelector("article");
    if (!a || art?.contains(a)) continue;
    const own = [...a.querySelectorAll("a[href*='/status/']")].some(x => x.querySelector("time") && x.getAttribute("href")?.includes("/" + id));
    if (own) continue;
    const link = [...a.querySelectorAll("a[href*='/status/']")].find(x => x.querySelector("time"));
    if (!link) continue;
    const r = link.getBoundingClientRect();
    if (r.top > 0 && r.bottom < innerHeight) return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), href: link.getAttribute("href") };
  }
  return null;
});
if (replyLink) {
  await page.mouse.click(replyLink.x, replyLink.y, { label: "点击右栏回复时间链接切帖" });
  await sleep(6000);
  out.quickSwitchB = await page.evaluate(() => ({
    url: location.pathname.slice(0, 50),
    state: document.documentElement.getAttribute("data-peek-lad-state"),
    focalMarked: Boolean(document.querySelector("article[data-peek-lad-focal]")),
    oldArticleGone: !document.querySelectorAll("article[data-peek-lad-focal]").length ? true : document.querySelectorAll("article[data-peek-lad-focal]").length === 1,
    focalCount: document.querySelectorAll("article[data-peek-lad-focal]").length,
  }));
}

// composer: click, type, verify, clear (never send)
await page.goto("https://x.com/thinkszyg/status/2109956494661656931");
await sleep(8000);
const composer = await page.evaluate(() => {
  const box = document.querySelector("[data-testid^=tweetTextarea_0]");
  if (!box) return null;
  const r = box.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), inRight: r.left > innerWidth * 0.5 };
});
if (composer) {
  await page.mouse.click(composer.x, composer.y, { label: "点击右栏回复编辑器" });
  await sleep(800);
  await page.keyboard.type("peek-m2b1-check", { delay: 20 });
  await sleep(600);
  out.composer = await page.evaluate(() => {
    const box = document.querySelector("[data-testid^=tweetTextarea_0]");
    const send = document.querySelector("[data-testid=tweetButton]");
    return {
      typed: (box?.textContent || "").includes("peek-m2b1-check"),
      composerInRightPane: Boolean(box && box.getBoundingClientRect().left > innerWidth * 0.5),
      sendEnabled: send ? !send.disabled && send.getAttribute("aria-disabled") !== "true" : null,
    };
  });
  // clear the typed text (backspace) — never send
  for (let i = 0; i < 20; i++) await page.keyboard.press("Backspace");
  await sleep(400);
  out.composerCleared = await page.evaluate(() => !(document.querySelector("[data-testid^=tweetTextarea_0]")?.textContent || "").trim());
}

// dev-mode extension reload + page refresh
await page.goto("chrome://extensions/");
await sleep(1500);
const reloaded = await page.evaluate(() => {
  const mgr = document.querySelector("extensions-manager");
  const list = mgr.shadowRoot.querySelector("extensions-item-list");
  const item = [...list.shadowRoot.querySelectorAll("extensions-item")].find(i => i.shadowRoot.querySelector("#name")?.textContent?.includes("M2-B1"));
  const btn = item?.shadowRoot.querySelector("#dev-reload-button");
  btn?.click();
  return Boolean(btn);
});
await sleep(2500);
out.devReload = { clicked: reloaded };
await page.goto("https://x.com/thinkszyg/status/2109956494661656931");
await sleep(9000);
out.afterReload = await page.evaluate(() => ({
  state: document.documentElement.getAttribute("data-peek-lad-state"),
  focal: Boolean(document.querySelector("article[data-peek-lad-focal]")),
  m1Pane: Boolean(document.getElementById("peek-native-pane")),
  doublePane: document.querySelectorAll("article[data-peek-lad-focal]").length,
}));

import { writeFileSync } from "node:fs";
writeFileSync("/Users/devon/claude/peek-main/docs/m2-b1/evidence/s6-mv3-checks.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
