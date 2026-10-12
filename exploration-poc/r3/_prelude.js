// Prelude: reconnect to the persistent task space, register the mv3-poc
// content script as an isolated-world auto-inject (same mechanism as round 2),
// and expose helpers. The payload appended after this file may use:
//   task, page, REG_POC()  (call once per invocation before goto/reload),
//   NET_SNAPSHOT() — read-only performance-resource census of /i/api/ calls
//   (URL + timing only; never headers, never bodies, no fetch wrapping).
import { readFile } from "node:fs/promises";

const task = await taskSpace(14);
const page = task.page("p1");

let _registered = false;
async function REG_POC() {
  if (_registered) return;
  const root = "/Users/devon/claude/peek-main";
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

// Read-only request census via the Performance API (no monkey-patching).
async function NET_SNAPSHOT() {
  const res = await page.cdp("Runtime.evaluate", {
    expression: `(() => {
      const out = [];
      for (const e of performance.getEntriesByType("resource")) {
        if (!e.name.includes("/i/api/")) continue;
        const gql = e.name.match(/graphql\\/([a-zA-Z0-9]+)\\/([A-Za-z]+)/);
        if (gql) out.push({ kind: "graphql", op: gql[2], t: Math.round(e.startTime) });
        else {
          const path = e.name.replace(/^https?:\\/\\/[^/]+/, "").split("?")[0];
          out.push({ kind: "rest", op: path.length > 70 ? path.slice(0, 70) : path, t: Math.round(e.startTime) });
        }
      }
      const byOp = {};
      for (const x of out) byOp[x.kind + ":" + x.op] = (byOp[x.kind + ":" + x.op] || 0) + 1;
      return { total: out.length, byOp, first: out[0] ? out[0].t : null, last: out.length ? out[out.length - 1].t : null };
    })()`,
    returnByValue: true,
  });
  return res.result.value;
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
