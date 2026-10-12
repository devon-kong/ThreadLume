const p = await task.newPage();
console.log("label:", p.label);
await p.cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await p.cdp("Page.bringToFront");
await p.goto("https://x.com/thinkszyg/status/2109309251533570509");
await p.waitForTimeout(8000);
const info = await p.cdp("Runtime.evaluate", { expression: `(() => {
  const b = document.querySelector('.peek-poc-actions [data-act="like"]');
  if (!b) return { btn: false };
  const r = b.getBoundingClientRect();
  const topEl = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return { btn: true, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, inViewport: r.y > 0 && r.y < innerHeight, topElement: topEl ? (topEl.className || topEl.tagName) : null, topIsButtonOrChild: Boolean(topEl && (topEl.closest?.('.peek-poc-actions'))) };
})()`, returnByValue: true });
console.log("button info:", JSON.stringify(info.result.value));
if (info.result.value?.btn && info.result.value.inViewport) {
  const { x, y } = { x: Math.round(info.result.value.rect.x + info.result.value.rect.w / 2), y: Math.round(info.result.value.rect.y + info.result.value.rect.h / 2) };
  await p.cdp("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await p.cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  for (const ms of [200, 600, 1200]) {
    await p.waitForTimeout(ms);
    const o = await p.cdp("Runtime.evaluate", { expression: `(() => { const cell = document.querySelector('[data-testid="primaryColumn"] [data-testid="cellInnerDiv"]'); const n = cell && (cell.querySelector('[data-testid="like"]') || cell.querySelector('[data-testid="unlike"]')); return { outlined: n ? (n.style.outline || '').includes('solid') : false, inViewport: n ? (n.getBoundingClientRect().y > 0 && n.getBoundingClientRect().y < innerHeight) : false }; })()`, returnByValue: true });
    console.log(`t+${ms}:`, JSON.stringify(o.result.value));
  }
}
await p.close();
