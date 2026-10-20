// Session-local user intent only. No scroll/video observers: automatic native
// updates and synthetic events must never choose an exit destination.
export function trackReaderInteraction(document) {
  let last = { pane: 'left', video: null }, stopped = false;
  const types = ['pointerdown', 'wheel', 'touchstart', 'touchmove', 'keydown'];
  const options = { capture: true, passive: true };
  const keys = new Set(['Enter', ' ', 'Spacebar', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']);
  const onInput = event => {
    if (stopped || !event.isTrusted || document.hidden || document.documentElement.getAttribute('data-peek-lad') !== 'on') return;
    if (event.type === 'keydown' && (!keys.has(event.key) || event.altKey || event.ctrlKey || event.metaKey)) return;
    let target = event.target;
    if (event.type === 'keydown' && (!target?.closest || target === document.body || target === document.documentElement)) target = document.activeElement;
    if (!target?.closest || !target.isConnected || target.closest('#peek-reader-topbar, [data-peek-ai-settings]')) return;
    const focal = document.querySelector('article[data-peek-lad-focal]');
    if (focal?.contains(target)) {
      const player = target.closest('[data-testid="videoPlayer"]');
      const video = target.matches('video') ? target : player?.querySelector('video');
      last = { pane: 'left', video: video && focal.contains(video) ? video : null };
      return;
    }
    const card = target.closest('#peek-ai-card, .pk-ai-map-dialog, #peek-comment-scrollbar');
    // The existing error card's settings link has no data marker. Exclude its
    // fixed, current UI label as well as the marked top-bar settings control.
    const button = target.closest('button');
    if (card && button?.textContent.trim() === '前往设置') return;
    if (card || document.querySelector('[data-testid="primaryColumn"]')?.contains(target)) last = { pane: 'right', video: null };
  };
  for (const type of types) document.addEventListener(type, onInput, options);
  return {
    snapshot: () => ({ ...last }),
    stop() {
      if (stopped) return;
      stopped = true;
      for (const type of types) document.removeEventListener(type, onInput, options);
      last = { pane: 'left', video: null };
    },
  };
}
