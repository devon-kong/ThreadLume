// Prelude: reconnect to the persistent task space, register the mv3-poc
// content script as an isolated-world auto-inject (same mechanism as round 2),
// and expose helpers. The payload appended after this file may use:
//   task, page, REG_POC()  (call once per invocation before goto/reload),
//   DETAIL_PROBE(statusId) — read-only main-world probe of the reading state.
// Network request census lives in network-census.mjs (CDP Network events;
// performance.getEntriesByType is unusable on X — X clears the buffer).
import { readFile } from "node:fs/promises";

let task;
try {
  task = await taskSpace(14); // persistent R3 space when it still exists
} catch {
  task = await taskSpace("peek r3 harness"); // fresh space after cleanup
}
const page = task.page("p1");

let _registered = false;
async function REG_POC() {
  if (_registered) return;
  // run.sh substitutes the placeholder with this checkout's root (E1)
  const root = "__PEEK_REPO_ROOT__";
  const css = await readFile(`${root}/exploration-poc/mv3-poc/content.css`, "utf8");
  const js = await readFile(`${root}/exploration-poc/mv3-poc/content.js`, "utf8");
  const cssJson = JSON.stringify(css);
  const bootstrap = `(function(){function inject(){if(document.querySelector("style[data-peek-poc-css]"))return;var s=document.createElement("style");s.setAttribute("data-peek-poc-css","1");s.textContent=${cssJson};(document.head||document.documentElement||document).appendChild(s);}if(document.head||document.documentElement){inject();}else{document.addEventListener("DOMContentLoaded",inject,{once:true});}})();\n`;
  await page.cdp("Page.addScriptToEvaluateOnNewDocument", {
    source: bootstrap + js,
    worldName: "peek-poc-r3",
    runImmediately: true,
  });
  _registered = true;
}

// Probe a detail page's native DOM state in the main world (read-only).
async function DETAIL_PROBE(statusId) {
  const res = await page.cdp("Runtime.evaluate", {
    expression: `(() => {
      const pane = document.getElementById("peek-poc-pane");
      const focal = document.querySelector("[data-testid=\\"cellInnerDiv\\"].peek-poc-focal-cell");
      const nativeFocal = [...document.querySelectorAll('[data-testid="cellInnerDiv"]')].find(c => c.querySelector('a[href*="/status/${statusId}"] time'));
      const art = nativeFocal ? nativeFocal.querySelector("article") : null;
      const video = art ? art.querySelector("video") : null;
      const urlId = (location.pathname.match(/\\/status\\/(\\d+)/) || [])[1];
      return {
        path: location.pathname,
        urlId,
        paneBuilt: Boolean(pane),
        paneAuthor: pane ? pane.querySelector(".peek-poc-author b")?.innerText : null,
        paneHandle: pane ? pane.querySelector(".peek-poc-author span")?.innerText : null,
        paneTextLen: pane ? pane.querySelector(".peek-poc-text")?.innerText.length : null,
        paneCounts: pane ? pane.querySelector(".peek-poc-counts")?.innerText : null,
        panePhotos: pane ? pane.querySelectorAll(".peek-poc-photo").length : null,
        paneQuote: pane ? Boolean(pane.querySelector(".peek-poc-quote")) : null,
        paneQuoteAuthor: pane ? pane.querySelector(".peek-poc-quote-author")?.innerText : null,
        richNote: pane ? pane.querySelector(".peek-poc-rich-note")?.innerText : null,
        focalHidden: Boolean(focal),
        nativeFocalMounted: Boolean(nativeFocal),
        videoPresent: Boolean(video),
        videoPlaying: video ? (video.readyState > 2 && !video.paused && video.currentTime > 0) : null,
        videoSize: video ? [video.videoWidth, video.videoHeight] : null,
        nativeFocalTop: nativeFocal ? Math.round(nativeFocal.getBoundingClientRect().top) : null,
        paneWidth: pane ? Math.round(pane.getBoundingClientRect().width) : null,
        totalCells: document.querySelectorAll('[data-testid="cellInnerDiv"]').length,
        htmlAttr: document.documentElement.getAttribute("data-peek-poc")
      };
    })()`,
    returnByValue: true,
  });
  return res.result.value;
}
