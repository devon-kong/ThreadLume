import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

// Exercise the actual browser monitor and classifier saved with C1-R evidence,
// rather than a second copy of their rules. This test never loads X or account
// content; its DOM fixtures model only public post identifiers and geometry.
const source = readFileSync(new URL("../../docs/m2-b2-c1-r/evidence/perf-run.mjs", import.meta.url), "utf8");
const monitorLiteral = source.match(/const MONITOR = (`[\s\S]*?`);/);
const classifySource = source.match(/function classify\(row, last\) \{[\s\S]*?\n\}/);
assert.ok(monitorLiteral && classifySource, "sampled measurement functions must be present");
const monitor = Function(`return ${monitorLiteral[1]}`)();
const classify = Function(`${classifySource[0]}; return classify`)();

test("C1-R T2b null is classified without ever substituting 0ms", () => {
  const row = { navigation: "OPENED", t2b: null, noReplyEvidence: false, loadingVisible: false };
  assert.equal(classify({ ...row, navigation: "FAILED" }, {}), "NAVIGATION_FAILED");
  assert.equal(classify(row, { error: "BUILD_MISMATCH" }), "BUILD_MISMATCH");
  assert.equal(classify(row, { candidates: { visible: 1 } }), "MEASUREMENT_MISS");
  assert.equal(classify(row, { candidates: { count: 1, visible: 0 } }), "OUT_OF_VIEW");
  assert.equal(classify(row, { t1b: null }), "NO_RENDER");
  assert.equal(classify({ ...row, noReplyEvidence: true }, { t1b: 200 }), "NO_REPLY");
  assert.equal(classify({ ...row, loadingVisible: true }, { t1b: 200 }), "TIMEOUT");
  assert.equal(classify(row, { t1b: 200 }), "UNKNOWN");
  assert.equal(classify({ ...row, t2b: 720 }, {}), null);
});

test("C1-R candidate monitor excludes ancestors, quote, ad, skeleton and recommendation", () => {
  const cell = (id, body, extra = "") => `<div data-testid="cellInnerDiv"><article data-testid="tweet" ${extra}>
    <a href="/person/status/${id}"><time>date</time></a>
    ${body == null ? "" : `<div data-testid="tweetText">${body}</div>`}
  </article></div>`;
  const dom = new JSDOM(`<!doctype html><html data-peek-artifact='{"build":"m2a-test-abcdef1234","mode":"m2a"}'><body>
    ${cell("111", "ancestor")}
    <div data-testid="cellInnerDiv"><article data-testid="tweet" data-peek-lad-focal>
      <a href="/person/status/222"><time>date</time></a><div data-testid="tweetText">focal</div>
      <div role="link"><a href="/person/status/777"><time>date</time></a><div data-testid="tweetText">quoted</div></div>
    </article></div>
    ${cell("333", "advertisement", 'data-testid-extra="ad"')}
    ${cell("334", null)}
    ${cell("444", "real candidate")}
    <div data-testid="cellInnerDiv" id="recommendation">Discover more</div>
    ${cell("555", "later recommendation")}
  </body></html>`, { url: "https://x.com/person/status/222", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  Object.defineProperty(window, "innerWidth", { value: 1329 });
  Object.defineProperty(window, "innerHeight", { value: 736 });
  window.HTMLElement.prototype.getBoundingClientRect = () => ({
    left: 760, right: 960, top: 200, bottom: 260, width: 200, height: 60,
  });
  const cells = window.document.querySelectorAll('[data-testid="cellInnerDiv"]');
  cells[2].innerText = "广告";
  window.document.getElementById("recommendation").innerText = "Discover more";
  window.eval(monitor);
  window.__c1rArm({ id: "222", name: "multi-level", hash: "abcdef1234", source: "https://x.com/person" });
  window.document.querySelector('a[href="/person/status/222"]').dispatchEvent(
    new window.MouseEvent("click", { bubbles: true }));
  const result = window.__c1rRead();
  window.close();
  assert.equal(result.identity.build, "m2a-test-abcdef1234");
  assert.deepEqual(Array.from(result.candidates.ids), ["444"]);
  assert.equal(result.candidates.visible, 1);
  assert.equal(result.candidates.excluded.beforeFocal, 1);
  assert.equal(result.candidates.excluded.ad, 1);
  assert.equal(result.candidates.excluded.noBody, 1);
  assert.equal(result.candidates.excluded.recommendation, 1);
  assert.ok(result.t2a >= 0 && result.t2b >= 0);
});
