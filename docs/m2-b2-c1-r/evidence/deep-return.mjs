// Same two public profile targets as the C1 audit. One pointer click each;
// records the actual capture-phase hit, route and relative anchor position.
const task = await taskSpace(25);
const page = task.page("p2");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ids = ["2110226552957149518", "2110193769618575536"];
const results = [];
for (const id of ids) {
  await page.goto("https://x.com/gefei55", { timeout: 30000 }).catch(() => {});
  await sleep(1500);
  await page.mouse.move(650, 500, { label: "定位公开资料流帖子" });
  await page.mouse.wheel(0, 5400, { label: "滚动至深度资料流" });
  let pick = null;
  for (let i = 0; i < 10 && !pick; i++) {
    pick = await page.evaluate((target) => {
      const a = [...document.querySelectorAll('[data-testid="cellInnerDiv"] a[href] time')]
        .map((time) => time.closest('a[href]'))
        .find((link) => link && !link.closest('div[role="link"]') &&
          new RegExp('/status/' + target + '(?:$|[?#])').test(link.getAttribute('href') || ''));
      if (!a) return null;
      a.scrollIntoView({ block: 'center' });
      const r = a.getBoundingClientRect();
      return { scrollY, anchorY: Math.round(r.top), x: r.left + r.width / 2, y: r.top + r.height / 2,
        href: a.getAttribute('href') };
    }, id);
    if (!pick) await page.mouse.wheel(0, 650, { label: "寻找指定时间链接" });
  }
  if (!pick) { results.push({ id, outcome: "TARGET_NOT_FOUND" }); continue; }
  await page.evaluate((target) => {
    window.__deepC1R = { target, event: null };
    window.addEventListener('click', function capture(e) {
      if (!window.__deepC1R || window.__deepC1R.event) return;
      const a = e.target?.closest?.('a[href]');
      window.__deepC1R.event = { tag: e.target?.tagName || null, href: a?.getAttribute('href') || null,
        reachedTarget: !!a?.getAttribute('href')?.includes('/status/' + target),
        pathAtCapture: location.pathname };
    }, { capture: true, once: true });
  }, id);
  const hit = await page.evaluate(({ x, y, target }) => {
    const node = document.elementFromPoint(x, y);
    return { tag: node?.tagName || null, href: node?.closest('a[href]')?.getAttribute('href') || null,
      target: !!node?.closest('a[href]')?.getAttribute('href')?.includes('/status/' + target) };
  }, { ...pick, target: id });
  // X may recycle the cell between the coordinate probe and the click. Use
  // the current semantic time link for the real pointer action; the capture
  // event below records what was actually hit after the browser scrolls it.
  const clicked = await page.click(`a[href="/gefei55/status/${id}"] time`,
    { label: "打开深度公开帖子" }).then(() => true).catch(() => false);
  if (!clicked) { results.push({ id, pick, hit, outcome: "TARGET_RECYCLED_BEFORE_CLICK" }); continue; }
  const actual = await page.evaluate(() => window.__deepC1R?.event || null);
  const start = Date.now();
  while (Date.now() - start < 2800 && !(await page.evaluate((target) => location.pathname.includes('/status/' + target), id))) await sleep(100);
  const detail = await page.evaluate(() => ({ path: location.pathname,
    state: document.documentElement.getAttribute('data-peek-lad-state'), scrollY }));
  if (!detail.path.includes('/status/' + id)) {
    results.push({ id, pick, hit, actual, detail, outcome: "NAVIGATION_FAILED" }); continue;
  }
  await sleep(1100);
  await page.mouse.move(1000, 500, { label: "阅读右侧评论" });
  await page.mouse.wheel(0, 1500, { label: "滚动原生评论" });
  const close = await page.evaluate(() => {
    const b = document.querySelector('#peek-reader-topbar .pk-tb-btn');
    if (!b) return false;
    b.click(); return true;
  });
  if (!close) { results.push({ id, pick, hit, actual, detail, outcome: "NO_CLOSE_BUTTON" }); continue; }
  const backStart = Date.now();
  while (Date.now() - backStart < 8000 && !(await page.evaluate(() => location.pathname === '/gefei55'))) await sleep(100);
  await sleep(800);
  const returned = await page.evaluate((target) => {
    const t = [...document.querySelectorAll('a[href] time')].find((x) =>
      (x.closest('a')?.getAttribute('href') || '').includes('/status/' + target));
    return { path: location.pathname, scrollY, anchorY: t ? Math.round(t.getBoundingClientRect().top) : null,
      state: document.documentElement.getAttribute('data-peek-lad-state') };
  }, id);
  await page.mouse.move(650, 500, { label: "返回后继续资料流" });
  await page.mouse.wheel(0, 400, { label: "用户主动继续滚动" });
  const immediateY = await page.evaluate(() => scrollY);
  await sleep(600);
  const settledY = await page.evaluate(() => scrollY);
  results.push({ id, pick: { scrollY: pick.scrollY, anchorY: pick.anchorY }, hit, actual, detail, returned,
    anchorDeltaY: returned.anchorY == null ? null : returned.anchorY - pick.anchorY,
    userScroll: { immediateY, settledY, accepted: immediateY > returned.scrollY,
      correctedBackwards: settledY < immediateY - 50 }, outcome: "OPENED_AND_RETURNED" });
}
const output = { variant: "c1r-final", artifact: await page.evaluate(() =>
  document.documentElement.getAttribute('data-peek-artifact')),
  browser: await page.evaluate(() => (navigator.userAgent.match(/Chrome\/([\d.]+)/) || [])[1] || null),
  viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight })), results };
(await import('node:fs')).writeFileSync('docs/m2-b2-c1-r/evidence/deep-return-final.json', JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
