// Releasing the fixed focal pane changes native cell measurements. X can
// compensate one paint later, moving the viewport before the next user input.
// Correct that first displacement ONCE; never keep forcing a scroll position.
// Presentation only: no MAIN/virtualizer access and no cross-route ownership.
export function releasePreservingScroll(release) {
  const x = window.scrollX || 0, y = window.scrollY, href = location.href;
  release();
  let done = false, frame = 0, expiry = 0;
  const raf = typeof window.requestAnimationFrame === "function";
  const request = raf ? window.requestAnimationFrame.bind(window) : fn => setTimeout(fn, 16);
  const cancel = raf ? window.cancelAnimationFrame.bind(window) : clearTimeout;
  const events = ["wheel", "touchmove", "keydown", "pointerdown", "popstate", "pagehide"];
  const opts = { capture: true, passive: true };
  const stop = () => {
    if (done) return;
    done = true;
    cancel(frame); clearTimeout(expiry);
    for (const type of events) window.removeEventListener(type, stop, opts);
    document.removeEventListener("visibilitychange", visibility);
  };
  const visibility = () => { if (document.hidden) stop(); };
  const step = () => {
    if (done) return;
    if (location.href !== href || document.documentElement.getAttribute("data-peek-lad") === "on") { stop(); return; }
    if (Math.abs(window.scrollY - y) > 1 || Math.abs((window.scrollX || 0) - x) > 1) {
      stop();
      window.scrollTo({ left: x, top: y, behavior: "instant" });
      return;
    }
    frame = request(step);
  };
  for (const type of events) window.addEventListener(type, stop, opts);
  document.addEventListener("visibilitychange", visibility);
  // Also expires in a background tab where animation frames can be suspended.
  expiry = setTimeout(stop, 300);
  frame = request(step);
}
