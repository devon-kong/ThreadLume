// M1 harness shared helpers (ego-browser session, L3 = CDP-equivalent injection,
// same mechanism as R4's perf/verification rounds). No account writes anywhere.
import { readFile } from "node:fs/promises";

export const ROOT = "/Users/devon/claude/peek-main";
export const NATIVE_EXT_ID = "hdlpejdgfeejjghejfcgncihlhmfamlj"; // real-loaded PoC v5 (disable during M1 runs, restore after)

// Register the Native build as an isolated-world auto-inject on the page.
export async function registerNative(page, { armTestHook = true } = {}) {
  const css = await readFile(`${ROOT}/dist-extension-native/content.css`, "utf8");
  const js = await readFile(`${ROOT}/dist-extension-native/content.js`, "utf8");
  const brand = `globalThis.TuzaiBrandIconDataUrl = "data:image/gif;base64,R0lGODlhAQABAAAAACw=AAAAAA==";\n`;
  const cssBoot = `(function(){function inj(){if(document.querySelector("style[data-peek-native-css]"))return;var s=document.createElement("style");s.setAttribute("data-peek-native-css","1");s.textContent=${JSON.stringify(css)};(document.head||document.documentElement||document).appendChild(s);}if(document.head||document.documentElement){inj();}else{document.addEventListener("DOMContentLoaded",inj,{once:true});}})();\n`;
  const boot = armTestHook ? `(function(){window.__PEEK_NATIVE_TEST__=true;})();\n` : "";
  await page.cdp("Page.addScriptToEvaluateOnNewDocument", {
    source: boot + brand + cssBoot + js,
    worldName: "peek-native-m1",
    runImmediately: true,
  });
}

// Register the Legacy build (isolated world only; its page-bridge MAIN-world
// part is injected separately by callers that need full legacy parity).
export async function registerLegacy(page) {
  const css = await readFile(`${ROOT}/dist-extension/content.css`, "utf8");
  const cssBoot = `(function(){function inj(){if(document.querySelector("style[data-tuzai-css]"))return;var s=document.createElement("style");s.setAttribute("data-tuzai-css","1");s.textContent=${JSON.stringify(css)};(document.head||document.documentElement||document).appendChild(s);}if(document.head||document.documentElement){inj();}else{document.addEventListener("DOMContentLoaded",inj,{once:true});}})();\n`;
  let iso = cssBoot;
  for (const f of ["vendor/phosphor/icons.js", "vendor/brand/icon.js", "vendor/hls/hls.min.js", "core.js", "content.js"]) {
    iso += (await readFile(`${ROOT}/dist-extension/${f}`, "utf8")) + "\n;\n";
  }
  await page.cdp("Page.addScriptToEvaluateOnNewDocument", { source: iso, worldName: "peek-legacy-m1", runImmediately: true });
}

export async function registerLegacyBridge(page) {
  const bridge = await readFile(`${ROOT}/dist-extension/page-bridge.js`, "utf8");
  await page.cdp("Page.addScriptToEvaluateOnNewDocument", { source: bridge, runImmediately: true });
}

// Read-only probe of the native reading state (MAIN world).
export async function nativeProbe(page, statusId) {
  const r = await page.cdp("Runtime.evaluate", {
    expression: `(() => {
      const pane = document.getElementById("peek-native-pane");
      const nativeFocal = ${statusId ? `[...document.querySelectorAll('[data-testid="cellInnerDiv"]')].find(c => c.querySelector('a[href*="/status/${statusId}"] time'))` : `document.querySelector('[data-testid="cellInnerDiv"]')`};
      return {
        path: location.pathname,
        urlId: (location.pathname.match(/\\/status\\/(\\d+)/) || [])[1] || null,
        paneBuilt: Boolean(pane),
        paneStatusId: pane?.dataset.statusId || null,
        paneAuthor: pane ? pane.querySelector(".peek-native-author b")?.innerText : null,
        paneHandle: pane ? pane.querySelector(".peek-native-author span")?.innerText : null,
        paneTextLen: pane ? (pane.querySelector(".peek-native-text")?.innerText || "").length : null,
        paneTextHead: pane ? (pane.querySelector(".peek-native-text")?.innerText || "").slice(0, 40) : null,
        paneCounts: pane ? pane.querySelector(".peek-native-counts")?.innerText : null,
        panePhotos: pane ? pane.querySelectorAll(".peek-native-photo").length : null,
        paneQuote: pane ? Boolean(pane.querySelector(".peek-native-quote")) : null,
        richNote: pane ? pane.querySelector(".peek-native-note")?.innerText?.slice(0, 50) : null,
        actionLabels: pane ? [...pane.querySelectorAll(".peek-native-act")].map(b => b.textContent) : null,
        brand: pane ? pane.querySelector(".peek-native-brand")?.innerText : null,
        brandIcon: pane ? Boolean(pane.querySelector(".peek-native-brand-icon")) : null,
        htmlAttr: document.documentElement.getAttribute("data-peek-native"),
        routeChangeAt: parseFloat(document.documentElement.getAttribute("data-peek-native-route-change-at")) || -1,
        closeDecision: document.documentElement.getAttribute("data-peek-close-decision"),
        nativeFocalMounted: Boolean(nativeFocal),
        nativeFocalTop: nativeFocal ? Math.round(nativeFocal.getBoundingClientRect().top) : null,
        cellCount: document.querySelectorAll('[data-testid="cellInnerDiv"]').length,
        paneCount: document.querySelectorAll("#peek-native-pane").length,
        scrollY: Math.round(scrollY),
      };
    })()`,
    returnByValue: true,
  });
  if (r.exceptionDetails) throw new Error(`probe: ${r.exceptionDetails.exception?.description}`);
  return r.result.value;
}

export async function trustedClick(page, { x, y }) {
  await page.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await page.cdp("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await page.cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

export async function trustedKey(page, { key, code, vk, type = "keyDown" }) {
  const t = type === "keydown" ? "keyDown" : type === "keyup" ? "keyUp" : type;
  await page.cdp("Input.dispatchKeyEvent", { type: t, key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
}
