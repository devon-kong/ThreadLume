// One TaskSpace, one browser/viewport/account, two public profile posts.
// Prepend globalThis.__VARIANT__ = "baseline" or "c1-final" and
// globalThis.__SPACE_ID__ = <current Ego TaskSpace> before running with
// `ego-browser nodejs`. This script performs user-like pointer/wheel actions;
// it does not call X private methods or execute any account write.
const VARIANT = globalThis.__VARIANT__;
const SPACE_ID = globalThis.__SPACE_ID__;
if (!["baseline", "c1-final"].includes(VARIANT) || !Number.isInteger(SPACE_ID)) throw new Error("variant/space required");
const task = await taskSpace(SPACE_ID);
const page = task.page("p1");
const fs = await import("node:fs/promises");
const profile = "https://x.com/gefei55";
const targets = ["2110226552957149518", "2110193769618575536"];
const results = [];
for (const id of targets) {
  await page.goto(profile).catch(() => {});
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="cellInnerDiv"] article').length > 5,
    undefined, { timeout: 12000 }).catch(() => {});
  await page.mouse.move(650, 500, { label: "滚到深度资料流" });
  await page.mouse.wheel(0, 5400, { label: "定位公开帖子" });
  let pick = null;
  for (let i = 0; i < 10 && !pick; i++) {
    pick = await page.evaluate((target) => {
      const a = [...document.querySelectorAll('[data-testid="cellInnerDiv"] a[href] time')]
        .map((t) => t.closest("a"))
        .find((x) => (x?.getAttribute("href") || "").includes("/status/" + target));
      if (!a) return null;
      a.scrollIntoView({ block: "center" });
      const r = a.getBoundingClientRect();
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      return { id: target, scrollY, anchorY: Math.round(r.y), x, y,
        hit: document.elementFromPoint(x, y)?.closest("a") === a };
    }, id);
    if (!pick) await page.mouse.wheel(0, 650, { label: "寻找目标时间链接" });
  }
  // X's virtual list can reflow just after scrollIntoView. Re-resolve the
  // hit target from the current DOM instead of using the earlier rectangle.
  if (pick && !pick.hit) {
    await page.waitForFunction((target) => {
      const a = [...document.querySelectorAll('[data-testid="cellInnerDiv"] a[href] time')]
        .map((t) => t.closest("a"))
        .find((x) => (x?.getAttribute("href") || "").includes("/status/" + target));
      if (!a) return false;
      const r = a.getBoundingClientRect();
      return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest("a") === a;
    }, id, { timeout: 3000 }).catch(() => {});
    pick = await page.evaluate((target) => {
      const a = [...document.querySelectorAll('[data-testid="cellInnerDiv"] a[href] time')]
        .map((t) => t.closest("a"))
        .find((x) => (x?.getAttribute("href") || "").includes("/status/" + target));
      if (!a) return null;
      const r = a.getBoundingClientRect();
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      return { id: target, scrollY, anchorY: Math.round(r.y), x, y,
        hit: document.elementFromPoint(x, y)?.closest("a") === a };
    }, id);
  }
  if (!pick?.hit) { results.push({ id, skipped: "target link not safely hit", pick }); continue; }
  await page.mouse.click(pick.x, pick.y, { label: "打开深度帖子" });
  await page.waitForFunction((target) => location.pathname.includes("/status/" + target), id,
    { timeout: 8000 }).catch(() => {});
  await page.waitForFunction(() => document.documentElement.getAttribute("data-peek-lad-state") === "active",
    undefined, { timeout: 8000 }).catch(() => {});
  const detail = await page.evaluate(() => ({ path: location.pathname,
    state: document.documentElement.getAttribute("data-peek-lad-state"), scrollY }));
  if (detail.state !== "active") { results.push({ id, pick, detail, skipped: "adapter not active" }); continue; }
  await page.mouse.move(1000, 500, { label: "滚动右侧评论" });
  await page.mouse.wheel(0, 1500, { label: "阅读原生评论" });
  await page.click('css=#peek-reader-topbar .pk-tb-btn >> nth=0');
  await page.waitForFunction(() => location.pathname === "/gefei55", undefined, { timeout: 8000 }).catch(() => {});
  await page.waitForFunction((target) => [...document.querySelectorAll("a[href] time")]
    .some((t) => (t.closest("a")?.getAttribute("href") || "").includes("/status/" + target)),
    id, { timeout: 8000 }).catch(() => {});
  const returned = await page.evaluate((target) => {
    const t = [...document.querySelectorAll("a[href] time")]
      .find((x) => (x.closest("a")?.getAttribute("href") || "").includes("/status/" + target));
    return { path: location.pathname, scrollY,
      anchorY: t ? Math.round(t.getBoundingClientRect().y) : null,
      state: document.documentElement.getAttribute("data-peek-lad-state") };
  }, id);
  await page.mouse.move(650, 500, { label: "返回后立即滚动" });
  await page.mouse.wheel(0, 400, { label: "继续阅读资料流" });
  const immediateY = await page.evaluate(() => scrollY);
  await page.waitForTimeout(600);
  const settledY = await page.evaluate(() => scrollY);
  results.push({ id, pick: { id, scrollY: pick.scrollY, anchorY: pick.anchorY }, detail,
    returned, anchorDeltaY: returned.anchorY === null ? null : returned.anchorY - pick.anchorY,
    userScroll: { immediateY, settledY, accepted: immediateY > returned.scrollY,
      correctedBackwards: settledY < immediateY - 50 } });
}
const output = { variant: VARIANT, artifact: await page.evaluate(() => document.documentElement.getAttribute("data-peek-artifact")),
  viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight })), results };
await fs.writeFile(`/Users/devon/claude/peek-main/docs/m2-b2-c1/evidence/deep-return-${VARIANT}.json`, JSON.stringify(output, null, 2));
console.log(JSON.stringify(output));
