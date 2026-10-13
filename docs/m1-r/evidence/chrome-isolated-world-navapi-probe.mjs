// M1-R A1 evidence — re-confirm on CURRENT Chrome: can an isolated world
// (the world MV3 content scripts run in) actually RECEIVE Navigation API
// "navigate" events, given that it can register the listener?
//
// Run: node docs/m1-r/evidence/chrome-isolated-world-navapi-probe.mjs
//
// Method (zero writes, zero accounts, local pages only):
//   1. launch a stock headless Chrome with --remote-debugging-port
//   2. serve a tiny SPA page (pushState on link click)
//   3. install the same probe in the MAIN world and in an ISOLATED world
//      (Page.addScriptToEvaluateOnNewDocument + worldName — the exact
//      mechanism MV3 content scripts are isolated by)
//   4. click the SPA link, then read both worlds' observation flags
//   5. also probe popstate delivery in both worlds (back/forward path)
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT_HTTP = 18777;
const PORT_CDP = 18778;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGE = `<!doctype html><html><head><title>t1</title></head><body>
<a id="go" href="/second" onclick="event.preventDefault();history.pushState({},'','/second');document.title='t2'">go</a>
</body></html>`;

// what each world runs at document start
const PROBE = `(function(){
  window.__probe = { navEvents: [], listenerOk: false, popstate: 0, navApiPresent: false };
  try {
    window.__probe.navApiPresent = typeof window.navigation?.addEventListener === "function";
    window.navigation.addEventListener("navigate", (e) => {
      window.__probe.navEvents.push(e.navigationType + ":" + new URL(e.destination.url).pathname);
    });
    window.__probe.listenerOk = true;
  } catch (err) { window.__probe.listenerError = String(err); }
  window.addEventListener("popstate", () => { window.__probe.popstate++; });
})();`;

const http = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(PAGE);
});
await new Promise((r) => http.listen(PORT_HTTP, "127.0.0.1", r));

const profile = mkdtempSync(join(tmpdir(), "peek-navapi-probe-"));
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", "--no-first-run", "--no-default-browser-check",
  `--remote-debugging-port=${PORT_CDP}`, `--user-data-dir=${profile}`, "about:blank",
], { stdio: "ignore" });

let ws;
class Cdp {
  constructor(socketUrl) { this.socketUrl = socketUrl; this.id = 0; this.pending = new Map(); }
  async connect() {
    ws = new WebSocket(this.socketUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) { this.pending.get(msg.id)(msg); this.pending.delete(msg.id); }
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res) => this.pending.set(id, res));
  }
}

async function evalIn(cdp, expression, contextId) {
  const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, contextId });
  if (!r.result?.result || r.result.exceptionDetails) {
    throw new Error(`evaluate failed: ${JSON.stringify(r).slice(0, 400)}`);
  }
  return r.result.result.value;
}

try {
  // find the page target
  let targets = null;
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT_CDP}/json`);
      targets = await res.json();
      if (targets.some((t) => t.type === "page")) break;
    } catch { /* chrome warming up */ }
    await sleep(250);
  }
  const page = targets.find((t) => t.type === "page");
  const cdp = new Cdp(page.webSocketDebuggerUrl);
  await cdp.connect();

  // MAIN world probe (default context) + ISOLATED world probe (worldName —
  // the content-script isolation mechanism). Page.enable is required first:
  // without it headless Chrome does not arm new-document script injection.
  await cdp.send("Page.enable");
  const reg1 = await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: PROBE });
  const reg2 = await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: PROBE, worldName: "peek-probe-iso" });
  if (reg1.error || reg2.error) throw new Error(`script registration failed: ${JSON.stringify([reg1, reg2])}`);
  await cdp.send("Page.navigate", { url: `http://127.0.0.1:${PORT_HTTP}/` });
  await sleep(1_500);

  // resolve the isolated world's execution context
  const { result: frames } = await cdp.send("Page.getFrameTree");
  const frameId = frames.frameTree.frame.id;
  const iso = await cdp.send("Page.createIsolatedWorld", { frameId, worldName: "peek-probe-iso" });
  const isoCtx = iso.executionContextId;

  const report = {};
  report.main_navApiPresent = await evalIn(cdp, `window.__probe.navApiPresent`);
  report.isolated_navApiPresent = await evalIn(cdp, `window.__probe.navApiPresent`, isoCtx);
  report.main_listenerRegistered = await evalIn(cdp, `window.__probe.listenerOk`);
  report.isolated_listenerRegistered = await evalIn(cdp, `window.__probe.listenerOk`, isoCtx);

  // trigger a same-document SPA navigation (pushState via the page's own handler)
  await evalIn(cdp, `document.getElementById("go").click()`);
  await sleep(800);

  report.main_navEvents = await evalIn(cdp, `JSON.stringify(window.__probe.navEvents)`);
  report.isolated_navEvents = await evalIn(cdp, `JSON.stringify(window.__probe.navEvents)`, isoCtx);

  // back/forward (traverse): popstate delivery in both worlds
  await evalIn(cdp, `history.back()`);
  await sleep(800);
  report.main_popstate = await evalIn(cdp, `window.__probe.popstate`);
  report.isolated_popstate = await evalIn(cdp, `window.__probe.popstate`, isoCtx);

  const chromeVersion = await evalIn(cdp, `navigator.userAgent`);
  console.log("Chrome:", chromeVersion);
  console.log(JSON.stringify(report, null, 2));

  const verdict = {
    navApiObjectInIsolatedWorld: report.isolated_navApiPresent === true,
    listenerRegistrableInIsolatedWorld: report.isolated_listenerRegistered === true,
    navigateEventDeliveredToMainWorld: (report.main_navEvents || "[]").includes("push"),
    navigateEventDeliveredToIsolatedWorld: (report.isolated_navEvents || "[]").includes("push"),
    popstateDeliveredToIsolatedWorld: report.isolated_popstate > 0,
  };
  console.log("\nVERDICT:", JSON.stringify(verdict, null, 2));
  console.log("\nM1-R A1 conclusion: title-watcher co-primary design is",
    verdict.navigateEventDeliveredToIsolatedWorld
      ? "OPTIONAL (events delivered — future-proofing only)"
      : "REQUIRED (events NOT delivered to isolated worlds on this Chrome)");
} finally {
  try { chrome.kill(); } catch { /* already gone */ }
  await sleep(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
  http.close();
}
