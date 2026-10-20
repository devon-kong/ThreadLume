// Fixture event objects invoke the actual registered callbacks. They are NOT
// browser-trusted actions and do not replace Root's real-user acceptance.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { trackReaderInteraction } from '../../native-extension/src/layout-adapter/reader-interaction.js';
function fixture() {
  const dom = new JSDOM('<html data-peek-lad="on"><body><div id="peek-reader-topbar"><button>exit</button><button data-peek-ai-settings>settings</button></div><main data-testid="primaryColumn"><article data-peek-lad-focal><p tabindex="0">original</p><div data-testid="videoPlayer"><video></video><button>play</button></div></article><article id="comment"><p tabindex="0">reply</p></article></main><section id="peek-ai-card"><p>summary</p><button>前往设置</button></section><aside>outside</aside></body></html>', { pretendToBeVisual: true });
  const { document } = dom.window, callbacks = new Map();
  const add = document.addEventListener.bind(document), remove = document.removeEventListener.bind(document);
  document.addEventListener = (type, fn, opts) => { callbacks.set(type, fn); add(type, fn, opts); };
  document.removeEventListener = (type, fn, opts) => { if (callbacks.get(type) === fn) callbacks.delete(type); remove(type, fn, opts); };
  const tracker = trackReaderInteraction(document);
  const send = (type, selector, rest = {}) => callbacks.get(type)?.({ type, target: document.querySelector(selector), isTrusted: true, ...rest });
  return { dom, document, tracker, callbacks, send, close() { tracker.stop(); dom.window.close(); } };
}

test('default left; trusted left/right/AI actions switch most recent pane and preserve video intent', () => {
  const f = fixture(); assert.equal(f.tracker.snapshot().pane, 'left');
  f.send('pointerdown', '#comment p'); assert.equal(f.tracker.snapshot().pane, 'right');
  f.send('pointerdown', 'video'); assert.equal(f.tracker.snapshot().pane, 'left'); assert.equal(f.tracker.snapshot().video, f.document.querySelector('video'));
  f.send('wheel', '#peek-ai-card p'); assert.equal(f.tracker.snapshot().pane, 'right');
  f.send('touchstart', 'article[data-peek-lad-focal] p'); assert.equal(f.tracker.snapshot().pane, 'left');
  f.send('touchmove', '#comment p'); assert.equal(f.tracker.snapshot().pane, 'right');
  f.close();
});

test('toolbar, settings, outside, untrusted, idle movement and automatic scrolling never change ownership', () => {
  const f = fixture();
  for (const selector of ['#peek-reader-topbar button', '[data-peek-ai-settings]', '#peek-ai-card button', 'aside']) f.send('pointerdown', selector);
  f.send('wheel', '#comment p', { isTrusted: false });
  f.document.querySelector('#comment p').dispatchEvent(new f.dom.window.Event('pointerdown', { bubbles: true }));
  f.send('mousemove', '#comment p'); f.send('scroll', '#comment p'); f.send('timeupdate', 'video');
  assert.equal(f.tracker.snapshot().pane, 'left');
  f.send('pointerdown', '#comment p'); f.send('pointerdown', '#peek-reader-topbar button');
  assert.equal(f.tracker.snapshot().pane, 'right'); f.close();
});

test('keyboard activation and scroll use actual focused pane; Tab, text and shortcuts do not claim intent', () => {
  const f = fixture();
  f.document.querySelector('#comment p').focus();
  assert.equal(f.tracker.snapshot().pane, 'left', 'programmatic focus alone cannot choose a pane');
  f.send('keydown', 'body', { key: 'PageDown' }); assert.equal(f.tracker.snapshot().pane, 'right');
  for (const key of ['Tab', 'a', 'Escape']) f.send('keydown', 'article[data-peek-lad-focal] p', { key });
  f.send('keydown', 'article[data-peek-lad-focal] p', { key: 'Home', ctrlKey: true }); assert.equal(f.tracker.snapshot().pane, 'right');
  f.send('keydown', '[data-testid="videoPlayer"] button', { key: ' ' }); assert.equal(f.tracker.snapshot().pane, 'left'); assert.ok(f.tracker.snapshot().video);
  f.close();
});

test('stop removes every tracker callback; snapshot before cleanup survives and a new session starts left', () => {
  const f = fixture(); f.send('pointerdown', '#comment p'); const snapshot = f.tracker.snapshot(), late = f.callbacks.get('pointerdown'); f.tracker.stop();
  late({ type: 'pointerdown', target: f.document.querySelector('#comment p'), isTrusted: true });
  assert.equal(snapshot.pane, 'right'); assert.equal(f.callbacks.size, 0); assert.equal(f.tracker.snapshot().pane, 'left');
  const next = trackReaderInteraction(f.document); assert.equal(next.snapshot().pane, 'left'); next.stop(); f.close();
});

test('inactive layout and detached event target cannot choose a pane', () => {
  const f = fixture(); f.document.documentElement.removeAttribute('data-peek-lad'); f.send('wheel', '#comment p'); assert.equal(f.tracker.snapshot().pane, 'left');
  f.document.documentElement.setAttribute('data-peek-lad', 'on'); const target = f.document.querySelector('#comment p'); target.remove();
  f.callbacks.get('pointerdown')({ type: 'pointerdown', target, isTrusted: true }); assert.equal(f.tracker.snapshot().pane, 'left'); f.close();
});
