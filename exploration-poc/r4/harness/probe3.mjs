// R4 G1 probe 3: article sample hunt + original-Peek injection smoke test.
const ROOT = "__PEEK_REPO_ROOT__";
if (ROOT.startsWith("__")) throw new Error("run via exploration-poc/r3/run.sh");

// ---------- 1. hunt an X Article sample (read-only search) ----------
await page.goto("https://x.com/search?q=filter%3Aarticles&f=live");
await page.waitForTimeout(6000);
const art = await page.cdp("Runtime.evaluate", {
  expression: `(() => {
    const out = [];
    for (const cell of document.querySelectorAll('[data-testid="cellInnerDiv"]')) {
      const a = [...cell.querySelectorAll('a[href*="/status/"]')].find(x => x.querySelector("time"));
      if (!a) continue;
      const id = (a.getAttribute("href").match(/status\\/(\\d+)/) || [])[1];
      const artBody = Boolean(cell.querySelector('[data-testid="twitterArticleRichTextView"]'));
      const artTitle = Boolean(cell.querySelector('[data-testid="twitter-article-title"]'));
      const artLink = Boolean(cell.querySelector('a[href*="/article"]'));
      if (artBody || artTitle || artLink) {
        const author = [...cell.querySelectorAll('a[href^="/"]')].map(x => x.getAttribute("href")).find(h => /^\\/[^/]+$/.test(h));
        out.push({ id, author, artBody, artTitle, artLink });
      }
    }
    return { path: location.pathname, found: out.slice(0, 5), cells: document.querySelectorAll('[data-testid="cellInnerDiv"]').length };
  })()`,
  returnByValue: true,
});
console.log("article search:", JSON.stringify(art.result.value));

// also try a long-post (show-more) sample in the same search sweep
await page.goto("https://x.com/search?q=%22显示更多%22%20-filter%3Areplies&f=live");
await page.waitForTimeout(5000);
const longq = await page.cdp("Runtime.evaluate", {
  expression: `(() => {
    const out = [];
    for (const cell of document.querySelectorAll('[data-testid="cellInnerDiv"]')) {
      const more = [...cell.querySelectorAll('button, [role="button"]')].find(b => /^(显示更多|Show more)/.test((b.innerText||"").trim()));
      const a = [...cell.querySelectorAll('a[href*="/status/"]')].find(x => x.querySelector("time"));
      if (more && a) {
        const id = (a.getAttribute("href").match(/status\\/(\\d+)/) || [])[1];
        const author = [...cell.querySelectorAll('a[href^="/"]')].map(x => x.getAttribute("href")).find(h => /^\\/[^/]+$/.test(h));
        out.push({ id, author });
      }
    }
    return out.slice(0, 5);
  })()`,
  returnByValue: true,
});
console.log("long-post candidates:", JSON.stringify(longq.result.value));

// ---------- 2. original Peek injection smoke test ----------
// fresh page; inject page-bridge (MAIN world, document_start equivalent) and
// core.js + content.js + vendor (isolated world) exactly like the MV3 manifest
// order, plus the CSS. Then click a timeline tweet with a trusted CDP click.
const perfPage = await task.newPage();
const files = [
  "dist-extension/page-bridge.js",
  "dist-extension/vendor/phosphor/icons.js",
  "dist-extension/vendor/brand/icon.js",
  "dist-extension/vendor/hls/hls.min.js",
  "dist-extension/core.js",
  "dist-extension/content.js",
];
const css = await readFile(`${ROOT}/dist-extension/content.css`, "utf8");
const cssJson = JSON.stringify(css);
const cssBoot = `(function(){function inj(){if(document.querySelector("style[data-tuzai-css]"))return;var s=document.createElement("style");s.setAttribute("data-tuzai-css","1");s.textContent=${cssJson};(document.head||document.documentElement||document).appendChild(s);}if(document.head||document.documentElement){inj();}else{document.addEventListener("DOMContentLoaded",inj,{once:true});}})();\n`;

// page-bridge in MAIN world first
const bridge = await readFile(`${ROOT}/dist-extension/page-bridge.js`, "utf8");
await perfPage.cdp("Page.addScriptToEvaluateOnNewDocument", { source: bridge, runImmediately: true });
// isolated world: css + vendor + core + content (manifest order)
let isoSource = cssBoot;
for (const f of files.slice(1)) isoSource += (await readFile(`${ROOT}/${f}`, "utf8")) + "\n;\n";
await perfPage.cdp("Page.addScriptToEvaluateOnNewDocument", { source: isoSource, worldName: "peek-r4-orig", runImmediately: true });

await perfPage.goto("https://x.com/home");
await perfPage.waitForTimeout(7000);
const boot = await perfPage.cdp("Runtime.evaluate", {
  expression: `(() => ({
    bridgeMain: Boolean(document.querySelector("script[data-tuzai-bridge], #__tuzai_page_bridge") ) || typeof window.__tuzaiPageBridge !== "undefined",
    icons: Boolean(window.TuzaiPhosphorIcons),
    errors: window.__tuzaiErrors || null,
  }))()`,
  returnByValue: true,
});
console.log("orig boot (main world view):", JSON.stringify(boot.result.value));

// isolated world check
const isoCheck = await perfPage.cdp("Runtime.evaluate", {
  expression: `(() => ({ icons: Boolean(window.TuzaiPhosphorIcons), ready: typeof window.__tuzaiReady !== "undefined" }))()`,
  returnByValue: true,
  worldName: "peek-r4-orig",
});
console.log("orig boot (isolated world view):", JSON.stringify(isoCheck.result.value));

// trusted click on the first timeline status link (center of its bounding box)
const click = await perfPage.cdp("Runtime.evaluate", {
  expression: `(() => {
    const cell = [...document.querySelectorAll('[data-testid="cellInnerDiv"]')].find(c => [...c.querySelectorAll('a[href*="/status/"]')].some(a => a.querySelector("time")));
    if (!cell) return null;
    const a = [...cell.querySelectorAll('a[href*="/status/"]')].find(x => x.querySelector("time"));
    const r = a.getBoundingClientRect();
    return { href: a.getAttribute("href"), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + Math.min(r.height, 300) / 2) };
  })()`,
  returnByValue: true,
});
const tgt = click.result.value;
console.log("click target:", JSON.stringify(tgt));
if (tgt) {
  await perfPage.cdp("Input.dispatchMouseEvent", { type: "mousePressed", x: tgt.x, y: tgt.y, button: "left", clickCount: 1 });
  await perfPage.cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x: tgt.x, y: tgt.y, button: "left", clickCount: 1 });
  await perfPage.waitForTimeout(4000);
  const overlay = await perfPage.cdp("Runtime.evaluate", {
    expression: `(() => {
      const root = document.getElementById("tuzai-x-popover-root");
      return {
        path: location.pathname,
        overlayOpen: Boolean(root),
        overlayText: root ? (root.innerText || "").slice(0, 120) : null,
        hasFocalText: root ? Boolean(root.querySelector('[class*="tweet-text"], [data-tuzai*="text"]')) : null,
      };
    })()`,
    returnByValue: true,
  });
  console.log("orig overlay after trusted click:", JSON.stringify(overlay.result.value));
}
console.log("probe3 done");
