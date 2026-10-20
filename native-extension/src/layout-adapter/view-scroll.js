// Native-view exit restores layout widths, the focal article's document flow
// and section padding together. Native cell measurements can then settle in
// several phases: scrollY alone cannot preserve the selected pane. Map a
// visible left point after the MAIN release boundary; let right comments settle.
// Both paths make at most one correction. Never
// retain/recreate a cell or compete with user input or a new reader session.
const OBSERVE_MS = 600;
const QUIET_MS = 160;
const LIMIT_MS = 1000;
let pendingRelease = null;

export function cancelScrollRelease() {
  pendingRelease?.();
}

function ownPermalink(article) {
  return [...article.querySelectorAll('a[href]')].find(link =>
    link.querySelector('time') && !link.closest('div[role="link"]') &&
    link.closest('article') === article &&
    /^\/[^/]+\/status\/\d+\/?$/.test(link.pathname) && link.origin === window.location.origin
  ) || null;
}

function shown(node) {
  if (!node?.isConnected || node.hidden) return false;
  const style = window.getComputedStyle(node.nodeType === 3 ? node.parentElement : node);
  return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse';
}

export function validAnchor(anchor) {
  return anchor.article.isConnected && anchor.cell.isConnected &&
    anchor.article.closest('[data-testid="cellInnerDiv"]') === anchor.cell &&
    ownPermalink(anchor.article) === anchor.link && anchor.link.href === anchor.href &&
    (!anchor.valid || anchor.valid());
}

export function leftContentPoint(selection) {
  const article = document.querySelector('article[data-peek-lad-focal]');
  const cell = article?.closest('[data-testid="cellInnerDiv"]'), link = article && ownPermalink(article);
  if (!cell || !link || !shown(article) || typeof document.elementFromPoint !== 'function') return null;
  const pane = article.getBoundingClientRect();
  const clip = { left: Math.max(0, pane.left), right: Math.min(window.innerWidth, pane.right), top: Math.max(0, pane.top), bottom: Math.min(window.innerHeight, pane.bottom) };
  if (!Object.values(clip).every(Number.isFinite) || clip.right <= clip.left || clip.bottom <= clip.top) return null;
  const base = { article, cell, link, href: link.href };
  const hit = (node, x, y) => {
    const target = document.elementFromPoint(x, y);
    if (!target || !article.contains(target)) return false;
    return node.contains(target) || (node.matches('video') && target.closest('[data-testid="videoPlayer"]')?.contains(node));
  };
  const mediaPoint = node => {
    if (!node || !article.contains(node) || !shown(node)) return null;
    const box = node.getBoundingClientRect(), left = Math.max(clip.left, box.left), right = Math.min(clip.right, box.right);
    const top = Math.max(clip.top, box.top), bottom = Math.min(clip.bottom, box.bottom);
    if (right <= left || bottom <= top || box.height <= 0) return null;
    const x = (left + right) / 2, y = (top + bottom) / 2;
    if (!hit(node, x, y)) return null;
    // Keep a visible point INSIDE the same video/image across width changes,
    // not the focal box whose inner scroll is being released.
    const fraction = (y - box.top) / box.height;
    return { ...base, top: y, valid: () => article.contains(node) && shown(node), read: () => { const r = node.getBoundingClientRect(); return { top: r.top + r.height * fraction, width: r.width, height: r.height }; } };
  };
  const preferred = mediaPoint(selection.video);
  if (preferred) return preferred;
  // A standard caret Range keeps the SAME visible character when a long
  // paragraph starts above the pane's inner-scroll clipping boundary.
  for (let y = clip.top + Math.min(12, (clip.bottom - clip.top) / 2); y < clip.bottom; y += 32) {
    const x = (clip.left + clip.right) / 2, target = document.elementFromPoint(x, y);
    if (!target || !article.contains(target)) continue;
    const caret = document.caretRangeFromPoint?.(x, y);
    const position = !caret && document.caretPositionFromPoint?.(x, y);
    const node = caret?.startContainer || position?.offsetNode, offset = caret?.startOffset ?? position?.offset;
    if (node?.nodeType !== 3 || !article.contains(node) || !node.data.length || !Number.isInteger(offset)) continue;
    const range = document.createRange(), start = Math.min(offset, node.data.length - 1), text = node.data;
    range.setStart(node, start); range.setEnd(node, start + 1);
    if (typeof range.getBoundingClientRect !== 'function') continue;
    const box = range.getBoundingClientRect();
    // Newlines can have a line-height but zero width. Continue to an actual
    // visible glyph rather than passing an unusable point to the height lease.
    if (![box.top, box.width, box.height].every(Number.isFinite) || box.width <= 0 || box.height <= 0 || box.top < clip.top || box.top >= clip.bottom) continue;
    return { ...base, top: box.top, valid: () => article.contains(node) && shown(node) && node.data === text, read: () => range.getBoundingClientRect() };
  }
  const selector = 'p,h1,h2,h3,li,[data-testid="tweetText"],[data-testid="twitterArticleRichTextView"],video,img';
  const candidates = [...article.querySelectorAll(selector)].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  for (const node of candidates) {
    if (node.matches('video,img')) { const point = mediaPoint(node); if (point) return point; continue; }
    if (!shown(node)) continue;
    const box = node.getBoundingClientRect(), left = Math.max(clip.left, box.left), right = Math.min(clip.right, box.right);
    // The semantic element's top itself must be visible; never substitute the
    // outer focal box or an invisible paragraph start for a scrolled character.
    if (right <= left || box.height <= 0 || box.top < clip.top || box.top >= clip.bottom) continue;
    const y = box.top + Math.min(1, box.height / 2);
    if (!hit(node, (left + right) / 2, y)) continue;
    return { ...base, top: box.top, valid: () => article.contains(node) && shown(node), read: () => node.getBoundingClientRect() };
  }
  return null;
}

function visibleComment() {
  const column = document.querySelector('[data-testid="primaryColumn"]');
  if (!column || typeof document.elementFromPoint !== 'function') return null;
  const bounds = column.getBoundingClientRect();
  // Use actual native geometry, not a presumed window split. Test each live
  // article separately: clipping can leave only a narrow strip between the
  // AI card and the article's bottom, missed by a full-window 32px grid.
  const candidates = [...column.querySelectorAll('article[data-testid="tweet"]')]
    .filter(article => !article.hasAttribute('data-peek-lad-focal'))
    .map(article => ({ article, box: article.getBoundingClientRect() }))
    .sort((a, b) => a.box.top - b.box.top);
  for (const { article, box } of candidates) {
    const left = Math.max(0, bounds.left, box.left), right = Math.min(window.innerWidth, bounds.right, box.right);
    const top = Math.max(0, bounds.top, box.top), bottom = Math.min(window.innerHeight, bounds.bottom, box.bottom);
    if (![left, right, top, bottom].every(Number.isFinite) || right <= left || bottom <= top) continue;
    const link = ownPermalink(article), cell = article.closest('[data-testid="cellInnerDiv"]');
    if (!link || !cell) continue;
    const x = (left + right) / 2, inset = Math.min(1, (bottom - top) / 2);
    const points = [top + inset, (top + bottom) / 2, bottom - inset];
    for (let y = top + 32; y < bottom; y += 32) points.push(y);
    // Hit testing respects fixed chrome, clipping and other native overlays.
    // The article whose own permalink we captured must itself own the hit.
    if (points.some(y => document.elementFromPoint(x, y)?.closest('article[data-testid="tweet"]') === article)) {
      return { article, cell, link, href: link.href, top: box.top, read: () => article.getBoundingClientRect() };
    }
  }
  return null;
}

export function releasePreservingScroll(release, selection = { pane: 'left' }, capturedAnchor) {
  cancelScrollRelease();
  const x = window.scrollX || 0, y = window.scrollY, href = location.href;
  const anchor = capturedAnchor || (selection.pane === 'right' ? visibleComment() : leftContentPoint(selection)), started = Date.now();
  let done = false, frame = 0, expiry = 0, observer = null;
  let last = null, quietSince = started;
  const raf = typeof window.requestAnimationFrame === 'function';
  const request = raf ? window.requestAnimationFrame.bind(window) : fn => setTimeout(fn, 16);
  const cancel = raf ? window.cancelAnimationFrame.bind(window) : clearTimeout;
  const events = ['wheel', 'touchstart', 'touchmove', 'keydown', 'pointerdown', 'popstate', 'hashchange', 'pagehide'];
  const opts = { capture: true, passive: true };
  const stop = () => {
    if (done) return;
    done = true;
    cancel(frame); clearTimeout(expiry); observer?.disconnect();
    for (const type of events) window.removeEventListener(type, stop, opts);
    document.removeEventListener('visibilitychange', visibility);
    if (pendingRelease === stop) pendingRelease = null;
  };
  const visibility = () => { if (document.hidden) stop(); };
  const step = () => {
    if (done) return;
    if (Date.now() - started >= LIMIT_MS || document.hidden || location.href !== href || document.documentElement.getAttribute('data-peek-lad') === 'on') { stop(); return; }
    if (selection.pane !== 'right' && anchor) {
      // Do not map CSS-only geometry while MAIN still owns the render set.
      // The synchronous fixed operation has returned: map before any queued
      // native observer/render work, with no await/Promise/frame boundary.
      const box = validAnchor(anchor) && anchor.read();
      const targetY = box && window.scrollY + box.top - anchor.top;
      const adjust = box && [box.top, box.width, box.height, targetY].every(Number.isFinite) && box.width > 0 && box.height > 0;
      stop();
      if (adjust && (Math.abs(window.scrollY - targetY) > 1 || Math.abs((window.scrollX || 0) - x) > 1)) window.scrollTo({ left: x, top: targetY, behavior: 'instant' });
      return;
    }
    // Identity is strictly the captured native article AND its own timestamp
    // link. No same-href search/rebind after X recycles it (including quotes).
    if (anchor && !validAnchor(anchor)) { stop(); return; }
    const box = anchor?.read();
    const sample = [window.scrollX || 0, window.scrollY, document.documentElement.scrollHeight,
      ...(box ? [box.top, box.width, box.height] : [])];
    if (!sample.every(Number.isFinite) || (box && box.height <= 0)) { stop(); return; }
    const now = Date.now();
    if (!last || sample.some((value, i) => Math.abs(value - last[i]) > 1)) quietSince = now;
    last = sample;
    if (now - started >= OBSERVE_MS && now - quietSince >= QUIET_MS) {
      const targetY = anchor ? window.scrollY + box.top - anchor.top : y;
      const adjust = Math.abs(window.scrollY - targetY) > 1 || Math.abs((window.scrollX || 0) - x) > 1;
      stop(); // release all ownership BEFORE scrolling can trigger native work
      if (adjust) window.scrollTo({ left: x, top: targetY, behavior: 'instant' });
      return;
    }
    frame = request(step);
  };
  pendingRelease = stop;
  for (const type of events) window.addEventListener(type, stop, opts);
  document.addEventListener('visibilitychange', visibility);
  // Arm before release so synchronous input or a throwing teardown cannot
  // leave a recovery behind. A new release supersedes this one immediately.
  let released;
  try { released = release(); } catch (error) { stop(); throw error; }
  if (done) return stop;
  if (released === false) { stop(); return stop; }
  if (document.hidden || location.href !== href || document.documentElement.getAttribute('data-peek-lad') === 'on') { stop(); return stop; }
  if (selection.pane !== 'right' && anchor) { step(); return stop; }
  // Catch even an on/off reopen between animation frames; registration is
  // after our own synchronous removal of data-peek-lad.
  observer = new window.MutationObserver(stop);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-peek-lad'] });
  // Also expires while animation frames are suspended. Unstable geometry at
  // the deadline is left to X, never forced into a guessed position.
  const remaining = LIMIT_MS - (Date.now() - started);
  if (remaining <= 0) { stop(); return stop; }
  expiry = setTimeout(stop, remaining);
  frame = request(step);
  return stop;
}
