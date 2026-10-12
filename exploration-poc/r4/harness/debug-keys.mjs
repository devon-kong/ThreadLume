const p = await task.newPage();
console.log("label:", p.label);
await p.cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
const TRACE = `window.__keyTrace = [];
addEventListener('keydown', (e) => __keyTrace.push(e.key + ':cap'), true);
addEventListener('focus', () => __keyTrace.push('win-focus'), true);
document.addEventListener('visibilitychange', () => __keyTrace.push('vis:' + document.visibilityState));`;
await p.cdp("Page.addScriptToEvaluateOnNewDocument", { source: TRACE, runImmediately: true });
await p.cdp("Page.bringToFront");
await p.goto("https://x.com/gefei55/status/2109450990575611958");
await p.waitForTimeout(7000);
const st = async (tag) => {
  const r = await p.cdp("Runtime.evaluate", { expression: `(() => ({ trace: window.__keyTrace, hasFocus: document.hasFocus(), vis: document.visibilityState, pane: Boolean(document.getElementById('peek-poc-pane')) }))()`, returnByValue: true });
  console.log(tag, JSON.stringify(r.result.value));
};
await st("open:");
await p.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
await p.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
await st("after 'a':");
await p.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await p.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await st("after esc:");
// try bringing to front AGAIN right before dispatch
await p.cdp("Page.bringToFront");
await p.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await p.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await st("after esc2 (re-fronted):");
await p.close();
