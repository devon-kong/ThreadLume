// R4 G1 probe: verify the runtime facts the performance harness depends on.
// Run: exploration-poc/r3/run.sh exploration-poc/r4/harness/probe.mjs
// (the r3 prelude provides `task` and `page` — task space 14 reconnect)
const ROOT = "__PEEK_REPO_ROOT__";
if (ROOT.startsWith("__")) throw new Error("run via exploration-poc/r3/run.sh");

console.log("current url:", await page.url());

// 1. chrome version + navigation API facts (main world)
const main = await page.cdp("Runtime.evaluate", {
  expression: `(() => ({
    ua: navigator.userAgent,
    navApi: typeof window.navigation,
    navEntries: typeof window.navigation?.entries,
    navCurrent: (() => { try { return window.navigation?.currentEntry?.index; } catch (e) { return "ERR:" + e.message; } })(),
    entryCount: (() => { try { return window.navigation?.entries?.().length; } catch (e) { return "ERR:" + e.message; } })(),
    firstEntryUrlSample: (() => { try { const es = window.navigation?.entries?.() || []; return es.length ? (es[0].url ? "has-url:" + es[0].url.slice(0, 20) : "redacted-empty") : "none"; } catch (e) { return "ERR:" + e.message; } })(),
  }))()`,
  returnByValue: true,
});
console.log("MAIN world:", JSON.stringify(main.result.value, null, 1));

// 2. isolated world: navigation API exposure
const iso = await page.cdp("Runtime.evaluate", {
  expression: `(() => ({
    navApi: typeof window.navigation,
    navEntries: typeof window.navigation?.entries,
    navCurrent: (() => { try { return window.navigation?.currentEntry?.index; } catch (e) { return "ERR:" + e.message; } })(),
  }))()`,
  returnByValue: true,
  worldName: "peek-poc-probe",
});
console.log("ISOLATED world:", JSON.stringify(iso.result.value, null, 1));

// 3. CDP trusted click check
try {
  await page.cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: 10, y: 10, button: "none" });
  console.log("CDP Input.dispatchMouseEvent: OK");
} catch (e) {
  console.log("CDP Input.dispatchMouseEvent FAILED:", e.message);
}

// 4. login state (read-only)
const login = await page.cdp("Runtime.evaluate", {
  expression: `Boolean(document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]'))`,
  returnByValue: true,
});
console.log("logged in:", login.result.value);

// 5. sample reachability: load the R3 sample status
console.log("probing sample…");
await page.goto("about:blank");
await page.goto("https://x.com/gefei55/status/2109304575786393643");
await page.waitForTimeout(5000);
const sample = await page.cdp("Runtime.evaluate", {
  expression: `(() => {
    const art = document.querySelector("article[data-testid='tweet']");
    return {
      path: location.pathname,
      hasArticle: Boolean(art),
      textSample: art?.querySelector('[data-testid="tweetText"]')?.innerText?.slice(0, 60) || null,
      photoCount: art?.querySelectorAll('[data-testid="tweetPhoto"] img').length || 0,
      video: Boolean(art?.querySelector('[data-testid="videoPlayer"], video')),
      articleTestid: Boolean(art?.querySelector('[data-testid="twitterArticleRichTextView"]')),
      replyCount: document.querySelectorAll('[data-testid="cellInnerDiv"]').length,
    };
  })()`,
  returnByValue: true,
});
console.log("sample:", JSON.stringify(sample.result.value, null, 1));
console.log("probe done");
