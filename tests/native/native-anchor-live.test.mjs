// M1-B3 live-Chrome parity tests: Chromium does NOT deliver Navigation API
// "navigate" events to the isolated world (verified live in M1-C diagnosis —
// the listener registers but never fires). The pre-commit anchor capture must
// therefore work through the capture-phase click listener, and close-decision
// must keep working through navigation.entries() (which IS readable live).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeEnv, makeStatusId, buildCell, buildAuthor, buildTweetText, buildActionBar,
} from "./native-env.mjs";

function fakeNavigation({ entries, index }) {
  const handlers = {};
  const state = {
    handlers,
    fire(type, destinationUrl) {
      handlers.navigate?.({ navigationType: type, destination: { url: destinationUrl } });
    },
  };
  const nav = {
    addEventListener: (t, fn) => { handlers[t] = fn; },
    entries: () => entries.map((url) => ({ url })),
    currentEntry: { get index() { return typeof index === "function" ? index() : index; } },
  };
  return { nav, state };
}

function focalFixture(statusId, text = "焦点帖正文") {
  return { statusId, articleChildren: [buildAuthor(), buildTweetText(text), buildActionBar()] };
}

test("B3-live：NAV_API 存在但 navigate 事件不投递（真实 Chrome 行为）——点击捕获仍记录锚点", async () => {
  const { nav } = fakeNavigation({
    entries: ["https://x.com/gefei55", "https://x.com/gefei55/status/1"],
    index: () => 1,
  });
  const env = makeEnv({ url: "/gefei55" });
  env.window.navigation = nav; // armed BEFORE boot → NAV_API path active
  const poc = env.boot();
  assert.equal(poc.navApi(), true, "Navigation API path armed");
  const idA = makeStatusId();
  // the post sits in the list at viewport Y 450; X pushes the detail route via
  // pushState WITHOUT firing any navigate event into this world (the fake's
  // fire() is never called — that is the point of this scenario)
  const { cell } = buildCell(focalFixture(idA));
  cell.getBoundingClientRect = () => ({ top: 450, bottom: 650, height: 200 });
  env.document.body.appendChild(cell);
  await env.clickLink(`/gefei55/status/${idA}`); // capture-phase click fires
  env.location.pathname = `/gefei55/status/${idA}`;
  env.location.href = `https://x.com/gefei55/status/${idA}`;
  await env.timers.advance(600); // cascade confirms the route
  const anchor = poc.preOpenAnchor();
  assert.ok(anchor, "anchor captured by the click listener despite no navigate event");
  assert.equal(anchor.statusId, idA);
  assert.equal(anchor.top, 450);
});

test("B3-live：点击捕获 → 打开 → 返回列表 → 零程序化滚动（端到端，NAV_API 配置）", async () => {
  const { nav } = fakeNavigation({
    entries: ["https://x.com/gefei55", "https://x.com/gefei55/status/1"],
    index: () => 1,
  });
  const env = makeEnv({ url: "/gefei55" });
  env.window.navigation = nav;
  const poc = env.boot();
  const idA = makeStatusId();
  const { cell } = buildCell(focalFixture(idA));
  cell.getBoundingClientRect = () => ({ top: 450, bottom: 650, height: 200 });
  env.document.body.appendChild(cell);
  await env.clickLink(`/gefei55/status/${idA}`);
  env.location.pathname = `/gefei55/status/${idA}`;
  env.location.href = `https://x.com/gefei55/status/${idA}`;
  await env.timers.advance(1_200); // route + adapter session start
  assert.ok(poc.preOpenAnchor(), "anchor captured end-to-end by the click listener");
  await env.navigate("/gefei55"); // the return to the list
  await env.timers.flushMicrotasks();
  // X re-anchors: cell lands 151px off. The unified build owns NO correction —
  // X's own scroll restoration owns the list return (restore path dormant).
  env.scroll.y = 2000;
  cell.getBoundingClientRect = () => ({ top: 299, bottom: 499, height: 200 });
  await env.timers.advance(3_000); // past the would-be settle + restore window
  assert.equal(env.scroll.y, 2000, "no scrollBy competes with X's own restoration");
  assert.equal(poc.restoreActive(), false, "no restore armed in adapter mode");
});

test("B3-live：detail→detail 点击不重置锚点（点击捕获仅限列表页发起）", async () => {
  const { nav } = fakeNavigation({
    entries: ["https://x.com/gefei55", "https://x.com/gefei55/status/1", "https://x.com/other/status/2"],
    index: () => 2,
  });
  const env = makeEnv({ url: "/gefei55" });
  env.window.navigation = nav;
  env.boot();
  const idA = makeStatusId();
  const idB = makeStatusId();
  const { cell } = buildCell(focalFixture(idA));
  cell.getBoundingClientRect = () => ({ top: 450, bottom: 650, height: 200 });
  env.document.body.appendChild(cell);
  await env.clickLink(`/gefei55/status/${idA}`);
  env.location.pathname = `/gefei55/status/${idA}`;
  env.location.href = `https://x.com/gefei55/status/${idA}`;
  await env.timers.advance(1_200);
  assert.equal(env.poc.preOpenAnchor()?.statusId, idA);
  // from the detail page, click a link to another status (detail → detail):
  // no new capture — the list anchor survives
  await env.clickLink(`/other/status/${idB}`);
  env.location.pathname = `/other/status/${idB}`;
  env.location.href = `https://x.com/other/status/${idB}`;
  await env.timers.advance(1_200);
  assert.equal(env.poc.preOpenAnchor()?.statusId, idA, "anchor still the list-originated post");
});
