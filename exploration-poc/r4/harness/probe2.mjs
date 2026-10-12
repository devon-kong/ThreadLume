// R4 G1 probe 2: login state on x.com + sample discovery for the perf matrix.
const ROOT = "__PEEK_REPO_ROOT__";
if (ROOT.startsWith("__")) throw new Error("run via exploration-poc/r3/run.sh");

await page.goto("https://x.com/home");
await page.waitForTimeout(6000);
const st = await page.cdp("Runtime.evaluate", {
  expression: `(() => ({
    path: location.pathname,
    loggedIn: Boolean(document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]')),
    timelineCells: document.querySelectorAll('[data-testid="cellInnerDiv"]').length,
    primaryColumn: Boolean(document.querySelector('[data-testid="primaryColumn"]')),
    signInPrompt: Boolean(document.querySelector('[data-testid="sheetDialog"]')),
  }))()`,
  returnByValue: true,
});
console.log("x.com state:", JSON.stringify(st.result.value));

// If logged in: discover 3 more sample posts (high-reply, article, media) from
// reachable public timelines — read-only scrolling of the home timeline.
const st2 = st.result.value;
if (st2.loggedIn) {
  console.log("LOGGED IN — discovering samples from the home timeline (read-only)");
  const found = await page.cdp("Runtime.evaluate", {
    expression: `(async () => {
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const seen = new Map();
      const collect = () => {
        for (const cell of document.querySelectorAll('[data-testid="cellInnerDiv"]')) {
          const a = [...cell.querySelectorAll('a[href*="/status/"]')].find(x => x.querySelector("time"));
          if (!a) continue;
          const id = (a.getAttribute("href").match(/status\\/(\\d+)/) || [])[1];
          if (!id || seen.has(id)) continue;
          const art = cell.querySelector("article");
          if (!art) continue;
          const text = art.querySelector('[data-testid="tweetText"]')?.innerText?.length || 0;
          const isArticle = Boolean(art.querySelector('[data-testid="twitterArticleRichTextView"], a[href*="/article"], [data-testid="twitter-article-title"]'));
          const photos = art.querySelectorAll('[data-testid="tweetPhoto"] img').length;
          const video = Boolean(art.querySelector('[data-testid="videoPlayer"], video'));
          const replyAria = art.querySelector('[data-testid="reply"]')?.getAttribute("aria-label") || "";
          const m = replyAria.match(/([\\d.,]+)/);
          const replies = m ? parseFloat(m[1].replace(/,/g, "")) : 0;
          const authorLink = [...art.querySelectorAll('a[href^="/"]')].map(x => x.getAttribute("href")).find(h => /^\\/[^/]+$/.test(h)) || "";
          seen.set(id, { id, author: authorLink, text, isArticle, photos, video, replies });
        }
      };
      for (let i = 0; i < 12; i++) {
        collect();
        window.scrollBy(0, 1200);
        await sleep(900);
      }
      collect();
      const arr = [...seen.values()];
      return {
        total: arr.length,
        articleLike: arr.filter(x => x.isArticle).slice(0, 3),
        videoLike: arr.filter(x => x.video).slice(0, 3),
        photoLike: arr.filter(x => x.photos > 0 && !x.video).slice(0, 3),
        highReply: arr.filter(x => x.replies >= 30).sort((a,b) => b.replies - a.replies).slice(0, 3),
        short: arr.filter(x => !x.isArticle && !x.video && x.photos === 0 && x.text > 0 && x.text < 140).slice(0, 3),
      };
    })()`,
    returnByValue: true,
    awaitPromise: true,
  });
  console.log(JSON.stringify(found.result.value, null, 1));
} else {
  console.log("NOT logged in on x.com — checking what the logged-out view offers");
  const pub = await page.cdp("Runtime.evaluate", {
    expression: `(() => ({
      cells: document.querySelectorAll('[data-testid="cellInnerDiv"]').length,
      timelineItems: document.querySelectorAll('article').length,
      bodyText: document.body.innerText.slice(0, 200),
    }))()`,
    returnByValue: true,
  });
  console.log(JSON.stringify(pub.result.value, null, 1));
}
console.log("probe2 done");
