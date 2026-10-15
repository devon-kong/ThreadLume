// Run with: ego-browser nodejs -e 'globalThis.__C1R_RUN__={variant:"b2b",round:1,hash:"3abb7ea0aa"};await import("./docs/m2-b2-c1-r/evidence/perf-run.mjs")'
// Browser-only observations; no X request bodies, headers, credentials or post text are saved.
import { writeFileSync } from "node:fs";

const config = globalThis.__C1R_RUN__;
if (!config || !["b2b", "c1r"].includes(config.variant) || ![1, 2].includes(config.round) || !/^[a-f0-9]{10}$/.test(config.hash)) {
  throw new Error("Set __C1R_RUN__ with variant, round and expected 10-character content hash");
}
const task = await taskSpace(25);
const page = task.page("p2");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const samples = [
  { name: "ordinary-video", id: "2109309251533570509", source: "https://x.com/thinkszyg" },
  { name: "high-comment", id: "2100757389112938573", source: "https://x.com/ruanyf" },
  { name: "multi-level", id: "2100789252204490926", source: "https://x.com/ruanyf/status/2100757389112938573" },
];

// This monitor is armed BEFORE the browser dispatches the real pointer click.
// Its identity rules mirror focal-extractor's public DOM rule: the time link
// must be the article's own, outside a semantic quote card.
const MONITOR = `(() => {
  if (window.__c1rPerfInstalled) return;
  window.__c1rPerfInstalled = true;
  const ownId = (art) => {
    if (!art) return null;
    for (const time of art.querySelectorAll('a[href] time')) {
      const link = time.closest('a[href]');
      if (link?.closest('div[role="link"]')) continue;
      const m = (link?.getAttribute('href') || '').match(/\\/status\\/(\\d+)(?:$|[?#])/);
      if (m) return m[1];
    }
    return null;
  };
  const focus = (id) => [...document.querySelectorAll('article[data-peek-lad-focal]')]
    .find((a) => ownId(a) === id) || null;
  const visible = (node) => {
    const r = node.getBoundingClientRect();
    const right = Math.min(r.right, innerWidth) - Math.max(r.left, innerWidth * .52);
    return r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0 && right >= 100;
  };
  const scanCandidates = (st, focal) => {
    const cells = [...document.querySelectorAll('[data-testid="cellInnerDiv"]')];
    const focalCell = focal?.closest('[data-testid="cellInnerDiv"]');
    const at = cells.indexOf(focalCell);
    const result = { count: 0, visible: 0, ids: [], excluded: { beforeFocal: Math.max(0, at), noBody: 0, noOwnId: 0, focal: 0, ad: 0, recommendation: 0 } };
    if (at < 0) return result;
    for (let i = at + 1; i < cells.length; i++) {
      const cell = cells[i];
      if (/发现更多|Discover more/i.test(cell.innerText || '')) { result.excluded.recommendation++; break; }
      const art = cell.querySelector('article[data-testid="tweet"]');
      if (!art) continue;
      const id = ownId(art);
      if (!id) { result.excluded.noOwnId++; continue; }
      if (id === st.id) { result.excluded.focal++; continue; }
      if (/广告|Promoted/i.test(cell.innerText || '') || cell.querySelector('[data-testid="placementTracking"]')) {
        result.excluded.ad++; continue;
      }
      const body = [...art.querySelectorAll('[data-testid="tweetText"]')]
        .find((n) => !n.closest('div[role="link"]') && n.textContent?.trim());
      if (!body) { result.excluded.noBody++; continue; }
      result.count++;
      if (result.ids.length < 5) result.ids.push(id);
      if (visible(body)) result.visible++;
    }
    return result;
  };
  const artifact = () => {
    const raw = document.documentElement.getAttribute('data-peek-artifact');
    try { const x = JSON.parse(raw); return Array.isArray(x) ? { conflict: true } : x; }
    catch { return { conflict: true }; }
  };
  const tick = (st) => {
    if (window.__c1rPerf !== st || st.stop) return;
    if (st.t0 != null) {
      const now = performance.now();
      const elapsed = now - st.t0;
      if (elapsed > 14000) { st.stop = true; return; }
      if (!st.identity) st.identity = artifact();
      if (st.identity?.conflict || !String(st.identity?.build || '').endsWith(st.hash)) {
        st.error = 'BUILD_MISMATCH'; st.stop = true; return;
      }
      const preview = document.getElementById('peek-lad-preview');
      if (st.t1a == null && preview?.isConnected && preview.dataset.statusId === st.id && preview.textContent?.trim().length > 8) {
        st.t1a = elapsed;
      }
      const focal = focus(st.id);
      if (focal && (focal.querySelector('[data-testid="tweetText"]')?.textContent?.trim() ||
          focal.querySelector('[data-testid="twitterArticleRichTextView"]')?.textContent?.trim())) {
        if (st.t1b == null) st.t1b = elapsed;
        if (!st.video && st.name === 'ordinary-video') st.video = focal.querySelector('video') || null;
        const candidates = scanCandidates(st, focal);
        st.lastCandidates = candidates;
        if (st.t2a == null && candidates.count) st.t2a = elapsed;
        if (st.t2b == null && candidates.visible) st.t2b = elapsed;
      }
      if (st.t40 != null && st.t4a == null && location.pathname === new URL(st.source).pathname &&
          document.querySelector('[data-testid="cellInnerDiv"] article')) st.t4a = now - st.t40;
      if (st.t4a != null && st.t4b == null) {
        const h = document.documentElement.scrollHeight;
        if (!st.stable || st.stable.h !== h) st.stable = { h, since: now };
        else if (now - st.stable.since >= 500) st.t4b = now - st.t40;
      }
    }
    st.timer = setTimeout(() => tick(st), 4);
  };
  window.addEventListener('click', (event) => {
    const st = window.__c1rPerf;
    if (!st || st.stop) return;
    if (st.closeArmed && st.t40 == null) { st.t40 = performance.now(); return; }
    if (st.t0 != null) return;
    const link = event.target?.closest?.('a[href]');
    if (!link || !new RegExp('/status/' + st.id + '(?:$|[?#])').test(link.getAttribute('href') || '')) return;
    st.t0 = performance.now();
    st.hit = { tag: event.target.tagName, href: link.getAttribute('href'), reached: true };
    tick(st);
  }, true);
  window.__c1rArm = (data) => {
    const old = window.__c1rPerf; if (old?.timer) clearTimeout(old.timer);
    window.__c1rPerf = { ...data, t0: null, t1a: null, t1b: null, t2a: null, t2b: null,
      t40: null, t4a: null, t4b: null, closeArmed: false, lastCandidates: null,
      identity: null, video: null, hit: null, stop: false, error: null, stable: null };
  };
  window.__c1rRead = () => {
    const st = window.__c1rPerf;
    if (!st) return null;
    return { t0Set: st.t0 != null, t1a: st.t1a, t1b: st.t1b, t2a: st.t2a, t2b: st.t2b,
      t4a: st.t4a, t4b: st.t4b, identity: st.identity, hit: st.hit, error: st.error,
      candidates: st.lastCandidates, path: location.pathname, state: document.documentElement.getAttribute('data-peek-lad-state'),
      failed: document.documentElement.getAttribute('data-peek-lad-failed') };
  };
  window.__c1rDeep = () => {
    const v = window.__c1rPerf?.video;
    scrollTo(0, 5000);
    return { tracked: !!v, sameElement: !!v?.isConnected, currentTime: v?.currentTime ?? null, paused: v?.paused ?? null };
  };
})();`;

function classify(row, last) {
  if (row.navigation !== "OPENED") return "NAVIGATION_FAILED";
  if (row.t2b != null) return null;
  if (last?.error === "BUILD_MISMATCH") return "BUILD_MISMATCH";
  if (last?.candidates?.visible) return "MEASUREMENT_MISS";
  if (last?.candidates?.count) return "OUT_OF_VIEW";
  if (last?.t1b == null) return "NO_RENDER";
  if (row.noReplyEvidence) return "NO_REPLY";
  if (row.loadingVisible) return "TIMEOUT";
  return "UNKNOWN";
}

async function findTarget(s) {
  for (let attempt = 0; attempt < 13; attempt++) {
    const hit = await page.evaluate((id) => {
      const time = [...document.querySelectorAll('a[href] time')].find((t) => {
        const a = t.closest('a[href]');
        return a && !a.closest('div[role="link"]') && new RegExp('/status/' + id + '(?:$|[?#])').test(a.getAttribute('href') || '');
      });
      const link = time?.closest('a[href]');
      if (!link) return null;
      link.scrollIntoView({ block: 'center' });
      const r = link.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
      const target = document.elementFromPoint(x, y);
      return { x, y, href: link.getAttribute('href'), hit: !!target?.closest('a[href]')?.getAttribute('href')?.includes('/status/' + id) };
    }, s.id);
    if (hit?.hit) return hit;
    await page.evaluate(() => scrollBy(0, 1000));
    await sleep(500);
  }
  return null;
}

const output = { variant: config.variant, round: config.round, expectedHash: config.hash,
  browser: null, viewport: null, results: [] };
for (const s of samples) {
  await page.goto(s.source, { timeout: 30000 }).catch(() => {});
  await sleep(1700);
  output.browser ??= await page.evaluate(() => (navigator.userAgent.match(/Chrome\/([\d.]+)/) || [])[1] || null);
  output.viewport ??= await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const row = { sample: s.name, targetId: s.id, source: s.source, navigation: null };
  const target = await findTarget(s);
  row.target = target;
  if (!target) { row.navigation = "NAVIGATION_FAILED"; row.nullReason = "NAVIGATION_FAILED"; output.results.push(row); continue; }
  await page.evaluate(MONITOR);
  await page.evaluate((data) => window.__c1rArm(data), { ...s, hash: config.hash });
  await sleep(180);
  const before = await page.evaluate(({ x, y, id }) => {
    const node = document.elementFromPoint(x, y);
    return { tag: node?.tagName || null, href: node?.closest('a[href]')?.getAttribute('href') || null,
      isTarget: !!node?.closest('a[href]')?.getAttribute('href')?.includes('/status/' + id) };
  }, { ...target, id: s.id });
  row.actualHitBefore = before;
  if (!before.isTarget) { row.navigation = "NAVIGATION_FAILED"; row.nullReason = "NAVIGATION_FAILED"; output.results.push(row); continue; }
  await page.mouse.click(target.x, target.y, { label: "打开预注册公开帖子" });
  const openedAt = Date.now();
  while (Date.now() - openedAt < 3000 && !(await page.evaluate((id) => location.pathname.includes('/status/' + id), s.id))) await sleep(80);
  row.navigation = (await page.evaluate((id) => location.pathname.includes('/status/' + id), s.id)) ? "OPENED" : "NAVIGATION_FAILED";
  if (row.navigation === "OPENED") {
    const start = Date.now();
    while (Date.now() - start < 8000) {
      const state = await page.evaluate(() => window.__c1rRead());
      if (state?.t2b != null || state?.error) break;
      await sleep(100);
    }
  }
  const measured = await page.evaluate(() => window.__c1rRead());
  Object.assign(row, { t1a: measured?.t1a ?? null, t1b: measured?.t1b ?? null,
    t2a: measured?.t2a ?? null, t2b: measured?.t2b ?? null, t2bVerified: null,
    verifiedReason: "PARENT_UNPROVEN", identity: measured?.identity ?? null,
    actualHit: measured?.hit ?? null, candidates: measured?.candidates ?? null,
    state: measured?.state ?? null, failed: measured?.failed ?? null });
  row.loadingVisible = await page.evaluate(() => !!document.querySelector('[role="progressbar"], [data-testid="loadingSpinner"]'));
  row.noReplyEvidence = await page.evaluate(() => {
    const focal = document.querySelector('article[data-peek-lad-focal]');
    const label = focal?.querySelector('[data-testid="reply"]')?.getAttribute('aria-label') || '';
    return /^0(?:\s|\b)/.test(label) && !window.__c1rPerf?.lastCandidates?.count;
  }); // only X's explicit zero count plus no candidate, never an empty viewport alone
  row.nullReason = classify(row, measured);
  if (row.navigation === "OPENED") {
    row.deepVideo = await page.evaluate(() => window.__c1rDeep());
    await sleep(350);
    await page.evaluate(() => scrollTo(0, 0));
    await sleep(350);
    const close = await page.evaluate(() => {
      const button = document.querySelector('#peek-reader-topbar .pk-tb-btn');
      if (!button) return false;
      window.__c1rPerf.closeArmed = true;
      button.click(); return true;
    });
    if (close) {
      const start = Date.now();
      while (Date.now() - start < 9000) {
        const state = await page.evaluate(() => window.__c1rRead());
        if (state?.t4b != null) break;
        await sleep(100);
      }
      const after = await page.evaluate(() => window.__c1rRead());
      row.t4a = after?.t4a ?? null; row.t4b = after?.t4b ?? null;
      row.returnPath = after?.path ?? null;
    } else row.closeError = "NO_TOPBAR";
  }
  output.results.push(row);
  console.log(JSON.stringify({ variant: config.variant, round: config.round, sample: row.sample, navigation: row.navigation,
    t1a: row.t1a, t1b: row.t1b, t2a: row.t2a, t2b: row.t2b, reason: row.nullReason,
    t4a: row.t4a, t4b: row.t4b, build: row.identity?.build }));
  await sleep(800);
}
const filename = `docs/m2-b2-c1-r/evidence/perf-${config.variant}-r${config.round}.json`;
writeFileSync(filename, JSON.stringify(output, null, 2));
console.log(filename);
