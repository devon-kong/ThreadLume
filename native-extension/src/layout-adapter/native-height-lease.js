// A bounded, cancellable lease on ONE original native cell's min-height.
// No window scrolling, playback, DOM moves or list-internal access here.
const OBSERVE_MS = 650, QUIET_MS = 160, LIMIT_MS = 1000;

export function beginNativeHeightLease({ document, anchor, valid, ownsLayout = valid, control, onReady, onCancel }) {
  const win = document.defaultView, root = document.documentElement;
  const { article, cell } = anchor, started = Date.now();
  const viewport = [win.innerWidth, win.innerHeight];
  const originalTop = article.scrollTop, originalLeft = article.scrollLeft;
  const originalAttr = root.getAttribute('data-peek-lad');
  const originalState = root.getAttribute('data-peek-lad-state');
  const prior = { value: cell.style.getPropertyValue('min-height'), priority: cell.style.getPropertyPriority('min-height') };
  let owned = null, done = false, frame = 0, expiry = 0, last = null, quietSince = started;
  let innerHeight = 0;
  const request = win.requestAnimationFrame?.bind(win) || (fn => setTimeout(fn, 16));
  const cancelFrame = win.cancelAnimationFrame?.bind(win) || clearTimeout;
  const opts = { capture: true, passive: true };
  const inputTypes = ['pointerdown', 'wheel', 'touchstart', 'touchmove', 'keydown'];
  const stopTypes = ['popstate', 'hashchange', 'pagehide', 'resize'];
  const label = control?.querySelector('span');
  const priorLabel = label?.textContent, priorBusy = control?.getAttribute('aria-busy');
  const restoreHeight = () => {
    if (!owned) return;
    if (cell.style.getPropertyValue('min-height') === owned.value && cell.style.getPropertyPriority('min-height') === owned.priority) {
      if (prior.value) cell.style.setProperty('min-height', prior.value, prior.priority);
      else cell.style.removeProperty('min-height');
    }
    owned = null;
  };
  const restoreControl = reason => {
    if (control?.getAttribute('aria-busy') === 'true') {
      if (priorBusy === null) control.removeAttribute('aria-busy'); else control.setAttribute('aria-busy', priorBusy);
    }
    if (label && (label.textContent === '切换中…' || label.textContent === priorLabel)) label.textContent = reason === 'timeout' || reason === 'measurement' ? '重试切换' : priorLabel;
  };
  const detach = () => {
    cancelFrame(frame); clearTimeout(expiry);
    for (const type of inputTypes) win.removeEventListener(type, input, opts);
    for (const type of stopTypes) win.removeEventListener(type, stopEvent, opts);
    win.removeEventListener('scroll', scroll, opts);
    document.removeEventListener('visibilitychange', visibility);
  };
  const stop = (reason = 'cancelled') => {
    if (done) return;
    done = true; detach(); restoreHeight(); restoreControl(reason); onCancel(reason);
  };
  const input = event => {
    if (!event.isTrusted) return;
    // A second activation of this same exit is idempotent, never a new lease.
    if (control && (event.target === control || control.contains(event.target)) &&
        (event.type === 'pointerdown' || event.type === 'touchstart' ||
          (event.type === 'keydown' && !event.altKey && !event.ctrlKey && !event.metaKey && ['Enter', ' ', 'Spacebar'].includes(event.key)))) return;
    stop('input');
  };
  const stopEvent = () => stop('navigation');
  const visibility = () => { if (document.hidden) stop('hidden'); };
  const scroll = () => { quietSince = Date.now(); };
  const current = () => !done && !document.hidden && valid() && root.getAttribute('data-peek-lad') === 'on' &&
    root.getAttribute('data-peek-lad-state') === originalState &&
    viewport[0] === win.innerWidth && viewport[1] === win.innerHeight;
  const boxValid = box => [box.top, box.left, box.width, box.height].every(Number.isFinite) && box.width > 0 && box.height > 0;
  const pointValid = point => [point.top, point.width, point.height].every(Number.isFinite) && point.width > 0 && point.height > 0;
  const step = () => {
    if (done) return;
    if (Date.now() - started >= LIMIT_MS) { stop('timeout'); return; }
    if (!current() || article.scrollTop !== originalTop || article.scrollLeft !== originalLeft || article.scrollHeight !== innerHeight ||
        cell.style.getPropertyValue('min-height') !== owned?.value || cell.style.getPropertyPriority('min-height') !== owned?.priority) { stop('invalidated'); return; }
    const box = cell.getBoundingClientRect(), point = anchor.read();
    if (!boxValid(box) || Math.abs(box.height - nativeBox.height) > 1 || !pointValid(point) || Math.abs(point.top - anchor.top) > 1) { stop('invalidated'); return; }
    const section = cell.closest('section[role="region"]')?.getBoundingClientRect();
    const sample = [win.scrollX || 0, win.scrollY, root.scrollHeight, box.top, box.width, box.height, point.top, point.width, point.height, section?.height || 0];
    if (!sample.every(Number.isFinite)) { stop('invalidated'); return; }
    const now = Date.now();
    if (!last || sample.some((value, i) => Math.abs(value - last[i]) > 1)) quietSince = now;
    last = sample;
    if (now - started >= OBSERVE_MS && now - quietSince >= QUIET_MS) {
      done = true; detach(); restoreControl();
      try { onReady(restoreHeight); } finally { restoreHeight(); }
      return;
    }
    frame = request(step);
  };

  for (const type of inputTypes) win.addEventListener(type, input, opts);
  for (const type of stopTypes) win.addEventListener(type, stopEvent, opts);
  win.addEventListener('scroll', scroll, opts);
  document.addEventListener('visibilitychange', visibility);
  let nativeBox, nativeArticle;
  try {
    if (originalAttr !== 'on' || !current()) throw new Error('invalid');
    // A single synchronous public-layout probe. Removing overflow can reset
    // inner scroll; both axes and the layout marker MUST be restored before
    // any event loop boundary, including the failure path.
    try {
      root.removeAttribute('data-peek-lad');
      nativeBox = cell.getBoundingClientRect(); nativeArticle = article.getBoundingClientRect();
    } finally {
      if (ownsLayout() && root.getAttribute('data-peek-lad') === null) root.setAttribute('data-peek-lad', originalAttr);
      if (valid() && root.getAttribute('data-peek-lad') === originalAttr) { article.scrollTop = originalTop; article.scrollLeft = originalLeft; }
    }
    if (!current() || !boxValid(nativeBox) || !boxValid(nativeArticle) || nativeBox.height < nativeArticle.height || nativeBox.width > win.innerWidth + 1) throw new Error('invalid');
    const css = win.getComputedStyle(cell);
    const extras = css.boxSizing === 'border-box' ? 0 : ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'].reduce((sum, key) => sum + (parseFloat(css[key]) || 0), 0);
    const height = nativeBox.height - extras;
    if (!Number.isFinite(height) || height <= 0 || article.scrollTop !== originalTop || article.scrollLeft !== originalLeft) throw new Error('invalid');
    cell.style.setProperty('min-height', `${height}px`, 'important');
    owned = { value: cell.style.getPropertyValue('min-height'), priority: cell.style.getPropertyPriority('min-height') };
    if (Math.abs(cell.getBoundingClientRect().height - nativeBox.height) > 1 || !pointValid(anchor.read()) || Math.abs(anchor.read().top - anchor.top) > 1) throw new Error('invalid');
    innerHeight = article.scrollHeight;
    if (control) control.setAttribute('aria-busy', 'true');
    if (label) label.textContent = '切换中…';
  } catch { stop('measurement'); return stop; }
  const remaining = LIMIT_MS - (Date.now() - started);
  if (remaining <= 0) { stop('timeout'); return stop; }
  expiry = setTimeout(() => stop('timeout'), remaining);
  frame = request(step);
  return stop;
}
