// M2-B1 S3 — viewport matrix: 1440×900, 1280×800 (split usable) and 960×800
// (below the 980px guard → safe degradation to native single column).
const FOCAL_URL = "https://x.com/thinkszyg/status/2109309251533570509";
const task = await taskSpace(1);
const page = task.page("p1");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = {};
for (const [w, h] of [[1440, 900], [1280, 800], [960, 800]]) {
  await page.cdp("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await page.goto(FOCAL_URL);
  await sleep(8000);
  out[`${w}x${h}`] = await page.evaluate(() => {
    const art = document.querySelector("article[data-peek-lad-focal]");
    const cell = art?.closest("[data-testid=cellInnerDiv]");
    const rightCell = [...document.querySelectorAll("[data-testid=cellInnerDiv]")].find(c => {
      const r = c.getBoundingClientRect();
      return r.left > innerWidth * 0.5 && r.width > 0;
    });
    return {
      ladState: document.documentElement.getAttribute("data-peek-lad-state"),
      fixedArticle: art ? { position: getComputedStyle(art).position, w: Math.round(art.getBoundingClientRect().width), h: Math.round(art.getBoundingClientRect().height) } : null,
      rightCellLeft: rightCell ? Math.round(rightCell.getBoundingClientRect().left) : null,
      videoPresent: Boolean(art?.querySelector("video")),
      bannerDisplay: (() => { const b = document.querySelector("header[role=banner]"); return b ? getComputedStyle(b).display : "absent"; })(),
    };
  });
  await page.screenshot({ path: `/Users/devon/claude/peek-main/docs/m2-b1/evidence/s3-vp-${w}x${h}.png` });
}
await page.cdp("Emulation.clearDeviceMetricsOverride", {});
import { writeFileSync } from "node:fs";
writeFileSync("/Users/devon/claude/peek-main/docs/m2-b1/evidence/s3-viewports.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
