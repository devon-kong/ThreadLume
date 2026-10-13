// S4 — quote post + website card rendering inside the pinned focal pane.
const task = await taskSpace(1);
const page = task.page("p1");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};

async function inspect(url, label, screenshot) {
  await page.goto(url);
  await sleep(8500);
  const r = await page.evaluate(() => {
    const art = document.querySelector("article[data-peek-lad-focal]");
    if (!art) return { focal: false, state: document.documentElement.getAttribute("data-peek-lad-state") };
    const q = [...art.querySelectorAll("div[role=link]")].find(l => l.querySelector("[data-testid=tweetText], [data-testid=User-Name]"));
    return {
      focal: true,
      state: document.documentElement.getAttribute("data-peek-lad-state"),
      text: (art.querySelector("[data-testid=tweetText]")?.textContent || "").slice(0, 50),
      quoteCardsInFocal: [...art.querySelectorAll("div[role=link]")].filter(l => l.querySelector("[data-testid=tweetText], [data-testid=User-Name]")).length,
      quoteHasMedia: Boolean(q?.querySelector("[data-testid=tweetPhoto], video")),
      cardWrapper: Boolean(art.querySelector("[data-testid=\"card.wrapper\"]")),
      cardDomain: art.querySelector("[data-testid=\"card.wrapper\"]")?.textContent?.slice(0, 60) ?? null,
      actionsPresent: Boolean(art.querySelector("[role=group]")),
      videoOrPhoto: Boolean(art.querySelector("video")) || art.querySelectorAll("[data-testid=tweetPhoto] img").length,
      focalCellCount: document.querySelectorAll("article[data-peek-lad-focal]").length,
    };
  });
  out[label] = r;
  await page.screenshot({ path: `/Users/devon/claude/peek-main/docs/m2-b1/evidence/s4-${screenshot}.png` });
}

await inspect("https://x.com/wangray/status/2109869791431508001", "quotePost", "quote-post");
await inspect("https://x.com/kokosn_5656/status/2109948231660818805", "websiteCard", "website-card");
await inspect("https://x.com/op7418/status/2109839549706969259", "multiPhoto", "multi-photo");
await inspect("https://x.com/xmglab/status/2109889118008394015", "threePhotos", "three-photo");

import { writeFileSync } from "node:fs";
writeFileSync("/Users/devon/claude/peek-main/docs/m2-b1/evidence/s4-rich-content-results.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
