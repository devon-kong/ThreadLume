// Real presentation module, deterministic standard-DOM geometry. This fixture
// models remeasurement; it does not implement X or prove browser convergence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { makeTimers } from './native-env.mjs';

const source = readFileSync(new URL('../../native-extension/src/layout-adapter/view-scroll.js', import.meta.url), 'utf8');
function fixture({ anchor = true, raf = true } = {}) {
  const dom = new JSDOM('<!doctype html><html data-peek-lad="on"><body><div data-testid="primaryColumn"><div data-testid="cellInnerDiv"><article data-testid="tweet"><a href="/a/status/123"><time>now</time></a><div role="link"><a href="/quoted/status/456"><time>quote</time></a></div><p>reply</p></article></div></div></body></html>', { url: 'https://x.com/a/status/999' });
  const { window } = dom, { document } = window;
  const clock = { now: 0 }, timers = makeTimers(clock), scroll = { x: 12, y: 3401 };
  const column = document.querySelector('[data-testid="primaryColumn"]');
  const art = document.querySelector('article'), link = art.querySelector('a'), writes = [];
  const geometry = { columnLeft: 220, columnRight: 1000, articleLeft: 800, articleRight: 1400, clipTop: 0 };
  let docTop = 3405.71875, height = 20000, hidden = false;
  Object.defineProperties(window, { scrollX: { get: () => scroll.x }, scrollY: { get: () => scroll.y }, innerWidth: { value: 1451 }, innerHeight: { value: 813 } });
  Object.defineProperties(document, { hidden: { get: () => hidden } });
  Object.defineProperty(document.documentElement, 'scrollHeight', { get: () => height });
  column.getBoundingClientRect = () => ({ left: geometry.columnLeft, right: geometry.columnRight, top: -scroll.y, bottom: height - scroll.y, width: geometry.columnRight - geometry.columnLeft, height });
  art.getBoundingClientRect = () => ({ top: docTop - scroll.y, bottom: docTop - scroll.y + 300, left: geometry.articleLeft, right: geometry.articleRight, width: geometry.articleRight - geometry.articleLeft, height: 300 });
  document.elementFromPoint = (x, y) => {
    const box = art.getBoundingClientRect();
    return anchor && art.isConnected && x >= Math.max(geometry.columnLeft, box.left) && x <= Math.min(geometry.columnRight, box.right) && y >= Math.max(geometry.clipTop, box.top) && y <= box.bottom ? art.querySelector('p') : null;
  };
  window.scrollTo = ({ left, top }) => { scroll.x = left; scroll.y = top; writes.push({ x: left, y: top }); };
  const listeners = new Set();
  for (const target of [window, document]) {
    const add = target.addEventListener.bind(target), remove = target.removeEventListener.bind(target);
    target.addEventListener = (type, fn, opts) => { listeners.add(fn); add(type, fn, opts); };
    target.removeEventListener = (type, fn, opts) => { remove(type, fn, opts); listeners.delete(fn); };
  }
  if (raf) {
    window.requestAnimationFrame = fn => timers.setTimeout(fn, 16);
    window.cancelAnimationFrame = timers.clearTimeout;
  }
  const context = { window, document, location: window.location, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, Date: { now: () => clock.now }, MutationObserver: window.MutationObserver };
  const api = vm.runInNewContext(source.replace(/^export /gm, '') + '\n({ release: releasePreservingScroll, captureLeft: leftContentPoint });', context);
  const release = api.release;
  const teardown = () => document.documentElement.removeAttribute('data-peek-lad');
  const arm = (fn = teardown, selection = { pane: 'right' }) => release(fn, selection);
  const event = type => window.dispatchEvent(new window.Event(type));
  const assertClean = () => { assert.equal(timers.pendingCount, 0, 'no frame or expiry remains'); assert.equal(listeners.size, 0, 'all own listeners removed'); };
  return { window, document, column, geometry, art, link, scroll, clock, timers, writes, arm, event, teardown, assertClean, captureLeft: api.captureLeft,
    shift({ y = scroll.y, x = scroll.x, top, documentHeight = height } = {}) { scroll.y = y; scroll.x = x; if (top !== undefined) docTop = y + top; height = documentHeight; },
    hide() { hidden = true; document.dispatchEvent(new window.Event('visibilitychange')); },
    close() { window.close(); },
  };
}

test('exit restores the same visible own-permalink article after two native measurement phases', async () => {
  const f = fixture();
  f.arm();
  await f.timers.advance(60);
  f.shift({ y: 3375, top: -350 });
  await f.timers.advance(83);
  f.shift({ y: 4448.5, top: -350, documentHeight: 21000 });
  await f.timers.advance(1100);
  assert.equal(f.art.getBoundingClientRect().top, 4.71875, 'reading position, not obsolete scrollY');
  assert.equal(f.scroll.y, 4093.78125);
  assert.deepEqual(f.writes, [{ x: 12, y: 4093.78125 }], 'one correction after convergence');
  f.assertClean(); f.close();
});

test('exit coalesces an early movement and another at 500ms instead of correcting the first paint', async () => {
  const f = fixture({ anchor: false });
  f.arm(); f.shift({ y: 3300 });
  await f.timers.advance(500);
  assert.equal(f.writes.length, 0, 'do not provoke another native measure before teardown settles');
  f.shift({ y: 2600, documentHeight: 21000 });
  await f.timers.advance(600);
  assert.deepEqual(f.writes, [{ x: 12, y: 3401 }]);
  f.assertClean(); f.close();
});

test('late first movement, horizontal offset and timeout-frame fallback remain bounded', async () => {
  const f = fixture({ anchor: false, raf: false });
  f.arm(); await f.timers.advance(500); f.shift({ y: 2600, x: 80 });
  await f.timers.advance(600);
  assert.deepEqual(f.writes, [{ x: 12, y: 3401 }]);
  f.assertClean(); f.close();
});

test('a comment can move while scrollY stays unchanged; pixels alone cannot preserve reading', async () => {
  const f = fixture(); f.arm(); f.shift({ top: 600 });
  await f.timers.advance(1100);
  assert.equal(f.art.getBoundingClientRect().top, 4.71875);
  assert.equal(f.writes.length, 1);
  f.assertClean(); f.close();
});

for (const invalidation of ['remove', 'replace', 'own-link-change']) test(`captured comment ${invalidation}: never rebind to another same-href article or quote`, async () => {
  const f = fixture(); f.arm();
  if (invalidation === 'remove') f.art.remove();
  if (invalidation === 'replace') f.art.replaceWith(f.art.cloneNode(true));
  if (invalidation === 'own-link-change') f.link.setAttribute('href', '/a/status/777');
  f.shift({ y: 2600, top: 600 }); await f.timers.advance(1100);
  assert.equal(f.writes.length, 0);
  f.assertClean(); f.close();
});

test('shallow unchanged exit never writes; a later unrelated scroll is left alone', async () => {
  const f = fixture(); f.shift({ y: 680, top: 100 }); f.arm();
  await f.timers.advance(1100); assert.equal(f.writes.length, 0); f.assertClean();
  f.shift({ y: 720 }); await f.timers.advance(1100); assert.equal(f.scroll.y, 720); f.close();
});

for (const interruption of ['wheel', 'touchstart', 'touchmove', 'keydown', 'pointerdown', 'popstate', 'pagehide', 'hidden', 'route', 'reopen']) test(`${interruption} cancels pending recovery before any corrective scroll`, async () => {
  const f = fixture(); f.arm();
  await f.timers.advance(50);
  if (interruption === 'hidden') f.hide();
  else if (interruption === 'route') f.window.history.pushState({}, '', '/b/status/888');
  else if (interruption === 'reopen') f.document.documentElement.setAttribute('data-peek-lad', 'on');
  else f.event(interruption);
  f.shift({ y: 2600, top: 600 }); await f.timers.advance(1100);
  assert.equal(f.writes.length, 0); f.assertClean(); f.close();
});

test('a second release supersedes the first snapshot', async () => {
  const f = fixture({ anchor: false }); f.arm(); await f.timers.advance(50);
  f.shift({ y: 800, x: 3 }); f.arm(); f.shift({ y: 900 });
  await f.timers.advance(1100);
  assert.deepEqual(f.writes, [{ x: 3, y: 800 }]); f.assertClean(); f.close();
});

test('release exception and synchronous user input leave no recovery behind', async () => {
  for (const scenario of ['throw', 'input']) {
    const f = fixture({ anchor: false });
    if (scenario === 'throw') assert.throws(() => f.arm(() => { throw new Error('release failed'); }), /release failed/);
    else f.arm(() => { f.teardown(); f.event('wheel'); });
    f.shift({ y: 2600 }); await f.timers.advance(1100);
    assert.equal(f.writes.length, 0); f.assertClean(); f.close();
  }
});

test('continuous native measurement changes exhaust the window without forced scrolling', async () => {
  const f = fixture(); f.arm();
  for (let i = 0; i < 12; i++) { f.shift({ top: 100 + i * 30 }); await f.timers.advance(100); }
  assert.equal(f.writes.length, 0); f.assertClean(); f.close();
});


test('already hidden release cleans synchronously and still performs teardown', async () => {
  const f = fixture(); f.hide(); f.arm();
  assert.equal(f.document.documentElement.hasAttribute('data-peek-lad'), false);
  f.assertClean(); f.shift({ y: 2600 }); await f.timers.advance(1100);
  assert.equal(f.writes.length, 0); f.close();
});

test('transient on/off reopen between frames cancels the old recovery', async () => {
  const f = fixture(); f.arm();
  f.document.documentElement.setAttribute('data-peek-lad', 'on'); f.teardown();
  f.shift({ y: 2600, top: 600 }); await f.timers.advance(1100);
  assert.equal(f.writes.length, 0); f.assertClean(); f.close();
});

test('background expiry releases listeners even when animation frames never run', async () => {
  const f = fixture();
  f.window.requestAnimationFrame = () => 123;
  f.window.cancelAnimationFrame = () => {};
  f.arm(); await f.timers.advance(1100);
  assert.equal(f.writes.length, 0); f.assertClean(); f.close();
});

for (const excluded of ['focal', 'quote-only']) test(`${excluded} is not captured as a visible comment anchor`, async () => {
  const f = fixture();
  if (excluded === 'focal') f.art.setAttribute('data-peek-lad-focal', '');
  else f.link.remove();
  f.arm(); f.shift({ y: 2600, top: 600 }); await f.timers.advance(1100);
  assert.deepEqual(f.writes, [{ x: 12, y: 3401 }], 'no eligible comment: bounded pixel fallback');
  f.assertClean(); f.close();
});

test('a failed corrective scroll also leaves no frame, observer or input listeners', async () => {
  const f = fixture({ anchor: false }); f.arm(); f.shift({ y: 2600 });
  f.window.scrollTo = () => { throw new Error('scroll failed'); };
  await assert.rejects(f.timers.advance(1100), /scroll failed/);
  f.assertClean(); f.close();
});


test('anchor hit point follows actual column/article intersection instead of a window percentage', async () => {
  const f = fixture();
  assert.equal(f.document.elementFromPoint(1451 * .75, 65), null, 'old assumed x is outside actual column');
  assert.ok(f.document.elementFromPoint(900, 65));
  f.arm(); f.shift({ y: 4448.5, top: -350 }); await f.timers.advance(1100);
  assert.equal(f.art.getBoundingClientRect().top, 4.71875);
  assert.deepEqual(f.writes, [{ x: 12, y: 4093.78125 }]);
  f.assertClean(); f.close();
});

test('hit testing finds the same partially clipped article only inside the visible column area', async () => {
  const f = fixture(); f.geometry.clipTop = 200;
  assert.equal(f.document.elementFromPoint(900, 65), null, 'covered region is not a visible anchor');
  f.arm(); f.shift({ y: 4448.5, top: -350 }); await f.timers.advance(1100);
  assert.equal(f.art.getBoundingClientRect().top, 4.71875);
  f.assertClean(); f.close();
});

test('a visible strip under 32px is captured even when full-window grid points all miss', async () => {
  const f = fixture();
  f.geometry.columnLeft = 0; f.geometry.columnRight = 1451;
  f.geometry.articleLeft = 762.5; f.geometry.articleRight = 1434.99;
  f.geometry.clipTop = 300;
  for (let y = 1; y < 813; y += 32) assert.equal(f.document.elementFromPoint(1088, y), null);
  assert.ok(f.document.elementFromPoint(1088, 303));
  f.arm(); f.shift({ y: 4448.5, top: -350 }); await f.timers.advance(1100);
  assert.equal(f.art.getBoundingClientRect().top, 4.71875);
  f.assertClean(); f.close();
});

test('current live geometry captures the partially visible last article below the AI card', async () => {
  const f = fixture();
  f.geometry.columnLeft = 0; f.geometry.columnRight = 1451;
  f.geometry.articleLeft = 762.5; f.geometry.articleRight = 1434.99;
  f.geometry.clipTop = 435;
  f.shift({ y: 3464, top: 380.71875 });
  f.arm(); f.shift({ y: 4484.5, top: 53 }); await f.timers.advance(1100);
  assert.equal(f.art.getBoundingClientRect().top, 380.71875);
  assert.equal(f.writes.length, 1);
  f.assertClean(); f.close();
});


// Last-pane fixtures: trusted input is tested separately; these exercise the
// real geometry mapper with explicit per-session snapshots.
function leftFixture(kind = 'video') {
  const f = fixture(); f.shift({ y: 680 });
  const focal = f.document.createElement('article'); focal.setAttribute('data-peek-lad-focal', ''); focal.setAttribute('data-testid', 'tweet');
  focal.innerHTML = '<a href="/a/status/999"><time>original</time></a>';
  const cell = f.document.createElement('div'); cell.setAttribute('data-testid', 'cellInnerDiv'); cell.append(focal); f.column.prepend(cell);
  const point = f.document.createElement(kind === 'video' ? 'video' : 'p'); point.textContent = 'A stable visible original paragraph'; focal.append(point); focal.scrollTop = 400;
  let flow = false;
  focal.getBoundingClientRect = () => ({ left: 16, right: 730, top: flow ? 200 - f.scroll.y : 68, bottom: flow ? 1800 - f.scroll.y : 797, width: 714, height: flow ? 1600 : 729 });
  point.getBoundingClientRect = () => ({ left: 32, right: 700, top: flow ? 700 - f.scroll.y : 568 - focal.scrollTop, bottom: (flow ? 700 - f.scroll.y : 568 - focal.scrollTop) + (kind === 'video' ? 300 : 24), width: 668, height: kind === 'video' ? 300 : 24 });
  const hitRight = f.document.elementFromPoint;
  f.document.elementFromPoint = (x, y) => { const r = point.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom ? point : hitRight(x, y); };
  const releaseLeft = () => { f.teardown(); flow = true; };
  return { ...f, focal, point, releaseLeft };
}

for (const kind of ['video', 'text']) test(`left ${kind} maps the visible inner-scroll content point synchronously into native flow`, async () => {
  const f = leftFixture(kind);
  assert.equal(f.point.getBoundingClientRect().top, 168);
  f.arm(f.releaseLeft, { pane: 'left', video: kind === 'video' ? f.point : null });
  assert.equal(f.point.getBoundingClientRect().top, 168, 'same task mapping prevents a delayed left jump');
  assert.deepEqual(f.writes, [{ x: 12, y: 532 }], 'neither stale window680 nor focal outer box is the target');
  await f.timers.advance(1200); assert.equal(f.writes.length, 1); f.assertClean(); f.close();
});

test('default left target is independent from the visible right comment', () => {
  const f = leftFixture('text');
  f.arm(f.releaseLeft, { pane: 'left' });
  assert.equal(f.point.getBoundingClientRect().top, 168);
  f.assertClean(); f.close();
});

for (const invalid of ['detached', 'replaced', 'hidden']) test(`left captured point ${invalid} during release: no stale correction or right-pane substitution`, async () => {
  const f = leftFixture();
  f.arm(() => {
    f.releaseLeft();
    if (invalid === 'detached') f.point.remove();
    if (invalid === 'replaced') f.point.replaceWith(f.point.cloneNode(true));
    if (invalid === 'hidden') f.point.style.display = 'none';
    f.shift({ y: 2000 });
  }, { pane: 'left', video: f.point });
  await f.timers.advance(1200);
  assert.equal(f.writes.length, 0); f.assertClean(); f.close();
});


test('left video keeps its visible internal point when native width changes media height', () => {
  const f = leftFixture(); const rect = f.point.getBoundingClientRect;
  f.point.getBoundingClientRect = () => { const r = rect(); return f.document.documentElement.hasAttribute('data-peek-lad') ? r : { ...r, height: 240, bottom: r.top + 240 }; };
  f.point.play = f.point.pause = () => { throw new Error('must never force playback'); };
  f.arm(f.releaseLeft, { pane: 'left', video: f.point });
  const r = f.point.getBoundingClientRect();
  assert.equal(r.top + r.height / 2, 318, 'same visible center point before and after aspect-preserving resize');
  assert.deepEqual(f.writes, [{ x: 12, y: 502 }]); f.assertClean(); f.close();
});

test('left scrolled long paragraph maps the same visible character Range, not its invisible outer top', () => {
  const f = leftFixture('text'), text = f.point.firstChild;
  f.focal.scrollTop = 800;
  f.point.getBoundingClientRect = () => { const top = f.document.documentElement.hasAttribute('data-peek-lad') ? -232 : 700 - f.scroll.y; return { left: 32, right: 700, top, bottom: top + 1000, width: 668, height: 1000 }; };
  const create = f.document.createRange.bind(f.document);
  f.document.caretRangeFromPoint = () => ({ startContainer: text, startOffset: 7 });
  f.document.createRange = () => { const r = create(); r.getBoundingClientRect = () => ({ top: f.document.documentElement.hasAttribute('data-peek-lad') ? 80 : 1012 - f.scroll.y, width: 8, height: 16 }); return r; };
  f.arm(f.releaseLeft, { pane: 'left' });
  assert.deepEqual(f.writes, [{ x: 12, y: 932 }]);
  assert.equal(1012 - f.scroll.y, 80, 'same character stays at the clipped viewport position');
  f.assertClean(); f.close();
});

for (const width of [0, -1, NaN, Infinity]) test(`left caret skips invalid character width ${width} and captures the next visible glyph`, () => {
  const f = leftFixture('text');
  f.point.textContent = 'x'.repeat(44) + '\n' + 'x'.repeat(51) + 'o'.repeat(40);
  const text = f.point.firstChild; f.focal.scrollTop = 800;
  f.point.getBoundingClientRect = () => ({ left: 32, right: 700, top: -232, bottom: 768, width: 668, height: 1000 });
  let caret = 0; const create = f.document.createRange.bind(f.document);
  f.document.caretRangeFromPoint = () => ({ startContainer: text, startOffset: caret++ === 0 ? 44 : 96 });
  f.document.createRange = () => { const r = create(); r.getBoundingClientRect = () => ({ top: r.startOffset === 44 ? 72.5 : 96.5, width: r.startOffset === 44 ? width : 9.265625, height: 20 }); return r; };
  const anchor = f.captureLeft({ pane: 'left' });
  assert.equal(anchor.top, 96.5); assert.equal(anchor.read().width, 9.265625);
  f.close();
});

test('left content point becoming zero-width in native flow is abandoned without correction', () => {
  const f = leftFixture('text'), rect = f.point.getBoundingClientRect;
  f.point.getBoundingClientRect = () => { const box = rect(); return f.document.documentElement.hasAttribute('data-peek-lad') ? box : { ...box, width: 0 }; };
  f.arm(f.releaseLeft, { pane: 'left' });
  assert.deepEqual(f.writes, []); f.assertClean(); f.close();
});

test('left mapping honors a synchronous user-input cancellation during release', async () => {
  const f = leftFixture();
  f.arm(() => { f.releaseLeft(); f.event('wheel'); }, { pane: 'left', video: f.point });
  assert.equal(f.writes.length, 0); await f.timers.advance(1200); f.assertClean(); f.close();
});

test('failed synchronous left release stops immediately without pixel fallback or late correction', async () => {
  const f = leftFixture();
  f.arm(() => { f.releaseLeft(); return false; }, { pane: 'left', video: f.point });
  assert.equal(f.writes.length, 0); f.assertClean();
  await f.timers.advance(1200); assert.equal(f.writes.length, 0); f.close();
});

test('left mapping reads final geometry only after synchronous release returns', async () => {
  const f = leftFixture(), rect = f.point.getBoundingClientRect; let nativeReleased = false;
  f.point.getBoundingClientRect = () => { const r = rect(); return nativeReleased ? { ...r, top: r.top + 400, bottom: r.bottom + 400 } : r; };
  f.arm(() => { f.releaseLeft(); nativeReleased = true; return true; }, { pane: 'left', video: f.point });
  assert.deepEqual(f.writes, [{ x: 12, y: 932 }]); assert.equal(f.point.getBoundingClientRect().top, 168);
  f.assertClean(); await f.timers.advance(1200); assert.equal(f.writes.length, 1); f.close();
});

for (const interruption of ['wheel', 'route', 'hidden', 'reopen', 'node-recycled']) test(`synchronous left release ${interruption} cannot map or rebind`, () => {
  const f = leftFixture();
  f.arm(() => {
    f.releaseLeft();
    if (interruption === 'wheel') f.event('wheel');
    if (interruption === 'route') f.window.history.replaceState({}, '', '/b/status/888');
    if (interruption === 'hidden') f.hide();
    if (interruption === 'reopen') f.document.documentElement.setAttribute('data-peek-lad', 'on');
    if (interruption === 'node-recycled') f.point.replaceWith(f.point.cloneNode(true));
    return true;
  }, { pane: 'left', video: f.point });
  assert.equal(f.writes.length, 0); f.assertClean(); f.close();
});
