// S4 — author hover card + native "more" menu (read-only: menu is opened,
// never actioned; Esc/click-away dismisses).
const task = await taskSpace(1);
const page = task.page("p1");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};

await page.goto("https://x.com/thinkszyg/status/2109309251533570509");
await sleep(9000);

// 1) author hover card: hover the display name in the LEFT pane
const nameBox = await page.evaluate(() => {
  const art = document.querySelector("article[data-peek-lad-focal]");
  const name = [...art.querySelectorAll("a")].find(a => a.getAttribute("href")?.startsWith("/thinkszyg") && a.querySelector("span"));
  if (!name) return null;
  const r = name.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
});
if (nameBox) {
  await page.mouse.move(nameBox.x, nameBox.y, { label: "悬停作者名" });
  await sleep(2000);
  out.hoverCard = await page.evaluate(() => {
    const hc = document.querySelector("[data-testid=HoverCard], [data-testid=hover-card]");
    const dlg = [...document.querySelectorAll("div[role=dialog]")].find(d => d.querySelector("[data-testid=UserCell], [data-testid=UserName]"));
    const node = hc || dlg;
    return {
      present: Boolean(node),
      hasFollow: Boolean(node && [...node.querySelectorAll("button, [role=button]")].some(b => /关注|Follow/i.test(b.textContent || b.getAttribute("aria-label") || ""))),
      hasStats: Boolean(node && /\d/.test(node.textContent || "")),
    };
  });
  await page.screenshot({ path: "/Users/devon/claude/peek-main/docs/m2-b1/evidence/s4-hover-card.png" });
  await page.mouse.move(700, 400, { label: "移开鼠标" });
  await sleep(1500);
  out.hoverCardGone = await page.evaluate(() => !document.querySelector("[data-testid=HoverCard], [data-testid=hover-card]"));
}

// 2) native "more" menu on the focal post (open + screenshot + dismiss, no item click)
const moreBox = await page.evaluate(() => {
  const art = document.querySelector("article[data-peek-lad-focal]");
  const more = art?.querySelector("[data-testid=caret]");
  if (!more) return null;
  const r = more.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
});
if (moreBox) {
  await page.mouse.click(moreBox.x, moreBox.y, { label: "打开原帖更多菜单" });
  await sleep(1500);
  out.menu = await page.evaluate(() => {
    const menu = document.querySelector("div[role=menu]");
    return { open: Boolean(menu), items: menu ? menu.querySelectorAll("[role=menuitem]").length : 0 };
  });
  await page.screenshot({ path: "/Users/devon/claude/peek-main/docs/m2-b1/evidence/s4-native-menu.png" });
  await page.keyboard.press("Escape");
  await sleep(1200);
  out.menuClosed = await page.evaluate(() => !document.querySelector("div[role=menu]"));
}

// 3) scan the home timeline for rich-content sample posts
await page.goto("https://x.com/home");
await sleep(6000);
out.samples = await page.evaluate(() => {
  const found = { poll: null, card: null, quote: null, article: null, video: null, photos: null };
  for (const cell of document.querySelectorAll("[data-testid=cellInnerDiv]")) {
    const art = cell.querySelector("article[data-testid=tweet]");
    if (!art) continue;
    const link = [...art.querySelectorAll("a[href*='/status/']")].find(a => a.querySelector("time") && !a.closest("div[role=link]"));
    const href = link?.getAttribute("href");
    if (!href) continue;
    const abs = "https://x.com" + href;
    if (!found.poll && (art.querySelector("[data-testid=poll]") || [...art.querySelectorAll("[data-testid=vote]")].length)) found.poll = abs;
    if (!found.card && art.querySelector("[data-testid^=card]")) found.card = abs;
    if (!found.quote && [...art.querySelectorAll("div[role=link]")].some(l => l.querySelector("[data-testid=tweetText]"))) found.quote = abs;
    if (!found.article && art.querySelector("[data-testid=article]")) found.article = abs;
    if (!found.video && art.querySelector("video")) found.video = abs;
    if (!found.photos && art.querySelectorAll("[data-testid=tweetPhoto] img").length >= 2) found.photos = abs;
  }
  return found;
});

import { writeFileSync } from "node:fs";
writeFileSync("/Users/devon/claude/peek-main/docs/m2-b1/evidence/s4-hovercard-menu-results.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
