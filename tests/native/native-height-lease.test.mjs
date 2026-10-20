// Real source + public DOM geometry. No X algorithm/browser acceptance claim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { makeTimers } from './native-env.mjs';
const source = readFileSync(new URL('../../native-extension/src/layout-adapter/native-height-lease.js', import.meta.url), 'utf8');
function fixture({ contentBox = false, prior = '', nativeHeight = 1138, probeThrows = false, raf = true } = {}) {
  const dom = new JSDOM('<html data-peek-lad="on"><body><button><span>原生视图</span></button><section role="region"><div><article><video></video></article></div></section></body></html>', { url: 'https://x.com/a/status/123' });
  const { window } = dom, { document } = window, root = document.documentElement;
  const article = document.querySelector('article'), cell = article.parentElement, control = document.querySelector('button');
  const clock = { now: 0 }, timers = makeTimers(clock), scroll = { y: 2796 };
  const state = { valid: true, hidden: false, ready: 0, cancelled: [], readError: probeThrows, original: article, width: 598 };
  const callbacks = new Map(), listeners = new Set();
  for (const target of [window, document]) {
    const add = target.addEventListener.bind(target), remove = target.removeEventListener.bind(target);
    target.addEventListener = (type, fn, opts) => { listeners.add(fn); if (!callbacks.has(type)) callbacks.set(type, new Set()); callbacks.get(type).add(fn); add(type, fn, opts); };
    target.removeEventListener = (type, fn, opts) => { listeners.delete(fn); callbacks.get(type)?.delete(fn); remove(type, fn, opts); };
  }
  Object.defineProperty(document, 'hidden', { get: () => state.hidden });
  Object.defineProperties(window, { innerWidth: { value: 1719, configurable: true }, innerHeight: { value: 949 }, scrollY: { get: () => scroll.y }, scrollX: { value: 0 } });
  Object.defineProperty(root, 'scrollHeight', { get: () => 15000 });
  window.scrollTo = () => { throw new Error('lease must never scroll window'); };
  article.play = article.pause = () => { throw new Error('lease must never control playback'); };
  article.scrollTop = 124; article.scrollLeft = 7;
  cell.style.boxSizing = contentBox ? 'content-box' : 'border-box';
  if (contentBox) { cell.style.padding = '5px'; cell.style.border = '2px solid black'; }
  if (prior) cell.style.setProperty('min-height', prior, 'important');
  const on = () => root.getAttribute('data-peek-lad') === 'on';
  cell.getBoundingClientRect = () => {
    if (!on()) { article.scrollTop = article.scrollLeft = 0; if (state.readError) throw new Error('probe'); }
    const height = on() ? Math.max(85, (parseFloat(cell.style.minHeight) || 0) + (contentBox && cell.style.minHeight ? 14 : 0)) : nativeHeight;
    return { left: 0, top: -scroll.y, width: state.width, height, right: state.width, bottom: height - scroll.y };
  };
  article.getBoundingClientRect = () => ({ left: 0, top: on() ? 68 : -scroll.y, width: state.width, height: on() ? 865 : 1053 });
  const anchor = { article, cell, top: 526, read: () => ({ top: 650 - article.scrollTop, width: 400, height: 300 }) };
  if (raf) { window.requestAnimationFrame = fn => timers.setTimeout(fn, 16); window.cancelAnimationFrame = timers.clearTimeout; }
  const begin = vm.runInNewContext(source.replace(/^export /gm, '') + '\nbeginNativeHeightLease;', { Date: { now: () => clock.now }, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout });
  const arm = (ready = release => { state.ready++; root.removeAttribute('data-peek-lad'); release(); }) => begin({ document, anchor, control, ownsLayout: () => state.valid, valid: () => state.valid && state.original === article && article.isConnected && cell.isConnected, onReady: ready, onCancel: reason => state.cancelled.push(reason) });
  const send = (type, rest = {}) => { for (const fn of [...(callbacks.get(type) || [])]) fn({ type, target: document.body, isTrusted: true, ...rest }); };
  return { window, document, root, article, cell, control, clock, timers, state, scroll, arm, send, clean() { assert.equal(timers.pendingCount, 0); assert.equal(listeners.size, 0); }, close() { window.close(); } };
}

test('same-stack native probe restores marker and both inner axes, then bounded height lease precedes ready', async () => {
  const f = fixture(); f.arm();
  assert.equal(f.root.getAttribute('data-peek-lad'), 'on'); assert.equal(f.article.scrollTop, 124); assert.equal(f.article.scrollLeft, 7);
  assert.equal(f.cell.style.minHeight, '1138px'); assert.equal(f.control.textContent, '切换中…');
  await f.timers.advance(110); f.scroll.y += 1054; f.send('scroll');
  await f.timers.advance(500); assert.equal(f.state.ready, 0);
  await f.timers.advance(100); assert.equal(f.state.ready, 1); assert.equal(f.cell.style.minHeight, '');
  f.clean(); f.close();
});

test('content-box conversion includes padding/border and restores prior value and priority', async () => {
  const f = fixture({ contentBox: true, prior: '17px' }); const cancel = f.arm();
  assert.equal(f.cell.style.minHeight, '1124px'); cancel();
  assert.equal(f.cell.style.minHeight, '17px'); assert.equal(f.cell.style.getPropertyPriority('min-height'), 'important');
  assert.equal(f.root.getAttribute('data-peek-lad'), 'on'); f.clean(); f.close();
});

for (const reason of ['input', 'hidden', 'resize', 'route', 'node', 'inner-scroll', 'content-size', 'cell-height', 'state', 'style-owner']) test(`height lease cancellation: ${reason}`, async () => {
  const f = fixture(); f.arm();
  if (reason === 'input') f.send('wheel');
  if (reason === 'hidden') { f.state.hidden = true; f.send('visibilitychange'); }
  if (reason === 'resize') f.send('resize');
  if (reason === 'route') f.state.valid = false;
  if (reason === 'node') { f.state.original = null; f.article.replaceWith(f.article.cloneNode(true)); }
  if (reason === 'inner-scroll') f.article.scrollTop++;
  if (reason === 'content-size') Object.defineProperty(f.article, 'scrollHeight', { value: 20 });
  if (reason === 'cell-height') { const rect = f.cell.getBoundingClientRect; f.cell.getBoundingClientRect = () => ({ ...rect(), height: 2000 }); }
  if (reason === 'state') f.root.setAttribute('data-peek-lad-state', 'failed');
  if (reason === 'style-owner') f.cell.style.setProperty('min-height', '2200px');
  await f.timers.advance(1200);
  assert.equal(f.state.ready, 0); assert.equal(f.state.cancelled.length, 1);
  assert.equal(f.cell.style.minHeight, reason === 'style-owner' ? '2200px' : '');
  assert.equal(f.root.getAttribute('data-peek-lad'), 'on'); f.clean(); f.close();
});

for (const options of [{ probeThrows: true }, { nativeHeight: NaN }, { nativeHeight: 0 }]) test(`failed native probe restores reader and inner scroll (${JSON.stringify(options)})`, () => {
  const f = fixture(options); f.arm();
  assert.equal(f.state.ready, 0); assert.deepEqual(f.state.cancelled, ['measurement']);
  assert.equal(f.root.getAttribute('data-peek-lad'), 'on'); assert.equal(f.article.scrollTop, 124); assert.equal(f.article.scrollLeft, 7);
  assert.equal(f.cell.style.minHeight, ''); f.clean(); f.close();
});

test('continuous native movement reaches hard deadline, preserves reader and offers explicit retry', async () => {
  const f = fixture(); f.arm();
  for (let i = 0; i < 10; i++) { await f.timers.advance(90); f.scroll.y++; f.send('scroll'); }
  await f.timers.advance(200);
  assert.deepEqual(f.state.cancelled, ['timeout']); assert.equal(f.root.getAttribute('data-peek-lad'), 'on'); assert.equal(f.control.textContent, '重试切换');
  f.clean(); f.close();
});

test('deadline also cleans when frames are suspended', async () => {
  const f = fixture(); f.window.requestAnimationFrame = () => 999; f.window.cancelAnimationFrame = () => {};
  f.arm(); await f.timers.advance(1100); assert.deepEqual(f.state.cancelled, ['timeout']); f.clean(); f.close();
});

test('duplicate exit activation does not cancel/extend; other trusted keys cancel, synthetic input ignored', async () => {
  const f = fixture(); f.arm();
  f.send('wheel', { isTrusted: false }); f.send('pointerdown', { target: f.control }); f.send('touchstart', { target: f.control }); f.send('keydown', { target: f.control, key: 'Enter' });
  await f.timers.advance(500); assert.equal(f.state.cancelled.length, 0);
  f.send('keydown', { target: f.control, key: 'ArrowDown' }); assert.deepEqual(f.state.cancelled, ['input']); f.clean(); f.close();
});

test('throwing final handoff still releases lease; cancellation is idempotent', async () => {
  const f = fixture(); const cancel = f.arm(() => { throw new Error('handoff'); });
  await assert.rejects(f.timers.advance(700), /handoff/); cancel(); cancel(); assert.equal(f.cell.style.minHeight, ''); f.clean(); f.close();
});
