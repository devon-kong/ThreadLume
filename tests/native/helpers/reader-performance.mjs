// Preserved production measurement monitor and classifier, extracted from acceptance evidence.
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
