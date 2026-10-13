// M1-R A1 evidence (probe 2, harness transport) — the REAL content-script
// world. An MV3 content script runs in an isolated world created by the
// EXTENSION SYSTEM — a different thing from a CDP-created isolated world
// (probe 1 showed CDP worlds DO get navigate events on this Chrome). This
// probe loads a real unpacked MV3 extension via Chrome for Testing
// (--load-extension) using the same pipe transport as the M1 verification
// harness, and reads the content script's observations from the DOM.
//
// Run: node docs/m1-r/evidence/chrome-real-content-script-navapi-probe.mjs
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchChromeForTesting, attachToPage, evalIn } from "../../../exploration-poc/m1/harness/cft-launch.mjs";

const PORT_HTTP = 18795;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGE = `<!doctype html><html><head><title>t1</title></head><body>
<a id="go" href="/second" onclick="event.preventDefault();history.pushState({},'','/second');document.title='t2'">go</a>
</body></html>`;

const MANIFEST = {
  manifest_version: 3,
  name: "navapi delivery probe",
  version: "1.0",
  content_scripts: [{ matches: [`http://127.0.0.1:${PORT_HTTP}/*`], js: ["cs.js"], run_at: "document_start" }],
};

const CS = `(function(){
  const obs = { navApiPresent: false, listenerOk: false, navEvents: [], popstate: 0 };
  try {
    obs.navApiPresent = typeof window.navigation?.addEventListener === "function";
    window.navigation.addEventListener("navigate", (e) => {
      obs.navEvents.push(e.navigationType + ":" + new URL(e.destination.url).pathname);
      mirror();
    });
    obs.listenerOk = true;
  } catch (err) { obs.listenerError = String(err); }
  window.addEventListener("popstate", () => { obs.popstate++; mirror(); });
  function mirror() {
    document.documentElement.dataset.navapiProbe = JSON.stringify(obs);
  }
  document.addEventListener("DOMContentLoaded", mirror);
  addEventListener("load", mirror);
  mirror();
})();`;

const http = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(PAGE);
});
await new Promise((r) => http.listen(PORT_HTTP, "127.0.0.1", r));

const extDir = mkdtempSync(join(tmpdir(), "peek-navapi-ext-"));
mkdirSync(extDir, { recursive: true });
writeFileSync(join(extDir, "manifest.json"), JSON.stringify(MANIFEST));
writeFileSync(join(extDir, "cs.js"), CS);

const profile = mkdtempSync(join(tmpdir(), "peek-navapi-prof-"));
let cdp;
try {
  cdp = await launchChromeForTesting({
    userDataDir: profile,
    extensions: [extDir],
    url: `http://127.0.0.1:${PORT_HTTP}/`,
    headless: true,
  });
  await sleep(1_200);
  const { sessionId } = await attachToPage(cdp, { urlIncludes: `127.0.0.1:${PORT_HTTP}` });

  const readObs = async () => {
    const raw = await evalIn(cdp, sessionId, `document.documentElement.dataset.navapiProbe || "MISSING"`);
    return raw === "MISSING" ? null : JSON.parse(raw);
  };

  const ua = await evalIn(cdp, sessionId, `navigator.userAgent`);
  await sleep(800);
  const before = await readObs();
  // same-document SPA navigation through the page's own handler
  await evalIn(cdp, sessionId, `document.getElementById("go").click()`);
  await sleep(800);
  const afterPush = await readObs();
  // traverse
  await evalIn(cdp, sessionId, `history.back()`);
  await sleep(800);
  const afterBack = await readObs();

  console.log("Chrome:", ua);
  console.log("content-script world before click:", JSON.stringify(before));
  console.log("after SPA push:", JSON.stringify(afterPush));
  console.log("after history.back():", JSON.stringify(afterBack));

  const verdict = {
    extensionLoaded: Boolean(before),
    navApiObjectInContentScriptWorld: before?.navApiPresent === true,
    listenerRegistrableInContentScriptWorld: before?.listenerOk === true,
    navigateEventDeliveredToContentScriptWorld: (afterPush?.navEvents || []).some((e) => e.startsWith("push:")),
    popstateDeliveredToContentScriptWorld: (afterBack?.popstate ?? 0) > 0,
  };
  console.log("\nVERDICT:", JSON.stringify(verdict, null, 2));
} finally {
  try { cdp?.close(); } catch { /* gone */ }
  await sleep(500);
  try { rmSync(extDir, { recursive: true, force: true }); } catch { /* best effort */ }
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
  http.close();
}
