// M1-R A2 — reading-anchor capture ownership & lifecycle.
//
// M1 left one hole: capturePreOpen overwrote the recorded list anchor on any
// later call, including route-check calls that run AFTER the URL already
// committed to a detail page. On a detail page the "cell" found for the focal
// id is the detail page's own copy — capturing there overwrites the true list
// origin with a meaningless position (reproducible through a non-status
// detour like /search: list → A → /search → B, where B's entry re-captures).
//
// Ownership rules under test:
//   - detail-context captures are REFUSED (never overwrite anything);
//   - only a new legal list-context capture replaces an anchor;
//   - a restore's terminal state CONSUMES the anchor (no stale reuse);
//   - a keyboard re-open with no anchor restores nothing (never guesses).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeEnv, makeStatusId, mountCell, buildCell, buildAuthor, buildTweetText,
  buildActionBar,
} from "./native-env.mjs";

function focalFixture(statusId, text = "焦点帖正文") {
  return { statusId, articleChildren: [buildAuthor(), buildTweetText(text), buildActionBar()] };
}

async function openFromList(env, statusId, { preTop = 450 } = {}) {
  const { cell } = buildCell(focalFixture(statusId));
  cell.getBoundingClientRect = () => ({ top: preTop, bottom: preTop + 200, height: 200 });
  env.document.body.appendChild(cell);
  await env.pushNavigate(`/somebody/status/${statusId}`);
  await env.timers.advance(1_200);
  return { pane: env.pane(), cell };
}

test("A2 列表捕获带来源标记：click-precommit", async () => {
  const env = makeEnv();
  env.boot();
  const idA = makeStatusId();
  await openFromList(env, idA, { preTop: 450 });
  const anchor = env.poc.preOpenAnchor();
  assert.equal(anchor.statusId, idA);
  assert.equal(anchor.top, 450);
  assert.equal(anchor.source, "click-precommit", "capture provenance recorded");
});

test("A2 复现链 列表→A→/search→B：非 status 中转合法结束会话，B 的详情位置绝不入库", async () => {
  const env = makeEnv();
  env.boot();
  const idA = makeStatusId();
  const idB = makeStatusId();
  await openFromList(env, idA, { preTop: 450 });
  assert.equal(env.poc.preOpenAnchor().statusId, idA);

  // X pushes a non-status route (search): the A session ends; the return-to-
  // list restore arms and its bounded window terminates (in real X the
  // timeline is unmounted here; the fixture's remnant cell settles in
  // threshold — either terminal state consumes the anchor legitimately)
  env.location.pathname = "/search";
  env.location.href = "https://x.com/search";
  await env.timers.advance(2_100);
  await env.timers.advance(3_000);
  assert.equal(env.poc.restoreActive(), false, "restore window closed by itself");
  assert.equal(env.poc.preOpenAnchor(), null, "session consumed at its terminal state");

  // a search result opens B. M1's unconditional capture would have STORED
  // B's detail-page position as a fresh garbage anchor here (repro of the
  // overwrite mechanism); the ownership rule refuses any detail-context
  // capture — no anchor is invented for B.
  const { cell: cellB } = buildCell(focalFixture(idB));
  cellB.getBoundingClientRect = () => ({ top: 99, bottom: 299, height: 200 }); // detail-position bait
  env.document.body.appendChild(cellB);
  env.location.pathname = `/other/status/${idB}`;
  env.location.href = `https://x.com/other/status/${idB}`;
  await env.timers.advance(2_100);
  assert.equal(env.poc.preOpenAnchor(), null, "no garbage anchor from the detail page");

  // closing B returns to /search: nothing to restore → no scrolling at all
  env.scroll.y = 1_500;
  await env.timers.advance(3_000);
  assert.equal(env.scroll.y, 1_500, "no guess-based correction on the search page");
});

test("A2 详情页直接调用 capturePreOpen（route-check 语义）：绝不记录详情位置", async () => {
  const env = makeEnv();
  env.boot();
  const idA = makeStatusId();
  await openFromList(env, idA, { preTop: 450 });
  // detail page of A carries its own focal cell at a different viewport spot
  const detailCell = env.document.querySelector('[data-testid="cellInnerDiv"]');
  detailCell.getBoundingClientRect = () => ({ top: 12, bottom: 212, height: 200 });
  const refused = env.poc.capturePreOpen(idA, "route-check");
  assert.equal(refused.statusId, idA);
  assert.equal(refused.top, 450, "refusal keeps the list anchor, not the detail position");
});

test("A2 浏览器前进直接进入详情（无点击）：无锚点，关闭不做任何滚动猜测", async () => {
  const env = makeEnv();
  env.boot();
  const idA = makeStatusId();
  // popstate into a detail (forward button) — no click capture ever ran
  await env.navigate(`/somebody/status/${idA}`);
  mountCell(env, focalFixture(idA));
  await env.timers.advance(1_500);
  assert.equal(env.poc.preOpenAnchor(), null, "no anchor without a pre-commit capture");
  env.pane().querySelector(".peek-native-close").click();
  await env.timers.flushMicrotasks();
  await env.navigate("/home");
  env.scroll.y = 800;
  await env.timers.advance(3_000);
  assert.equal(env.scroll.y, 800, "native behavior untouched");
});

test("A2 restore 终态消费锚点（adjusted）：随后的键盘重开不再复用旧位置", async () => {
  const env = makeEnv();
  env.boot();
  const idA = makeStatusId();
  const { cell } = await openFromList(env, idA, { preTop: 450 });
  env.pane().querySelector(".peek-native-close").click();
  await env.timers.flushMicrotasks();
  await env.navigate("/home");
  await env.timers.flushMicrotasks();
  cell.getBoundingClientRect = () => ({ top: 300, bottom: 500, height: 200 });
  await env.timers.advance(700);
  assert.equal(env.scroll.y, -150, "restore applied normally");
  assert.equal(env.poc.preOpenAnchor(), null, "anchor consumed by the terminal restore");

  // keyboard re-open of the same post (no click → no capture) after the user
  // scrolled elsewhere: closing restores NOTHING instead of guessing
  cell.getBoundingClientRect = () => ({ top: 60, bottom: 260, height: 200 });
  await env.programmaticNavigate(`/somebody/status/${idA}`);
  await env.timers.advance(1_200);
  env.pane().querySelector(".peek-native-close").click();
  await env.timers.flushMicrotasks();
  await env.navigate("/home");
  env.scroll.y = 5_000;
  await env.timers.advance(3_000);
  assert.equal(env.scroll.y, 5_000, "no stale-anchor correction for a keyboard re-open");
});

test("A2 restore 终态消费锚点（within-threshold / window-expired / user-input）", async () => {
  // within-threshold
  {
    const env = makeEnv();
    env.boot();
    const idA = makeStatusId();
    const { cell } = await openFromList(env, idA, { preTop: 450 });
    env.pane().querySelector(".peek-native-close").click();
    await env.timers.flushMicrotasks();
    await env.navigate("/home");
    await env.timers.flushMicrotasks();
    cell.getBoundingClientRect = () => ({ top: 430, bottom: 630, height: 200 }); // 20px off
    await env.timers.advance(700);
    assert.equal(env.poc.preOpenAnchor(), null, "within-threshold also consumes");
  }
  // window-expired
  {
    const env = makeEnv();
    env.boot();
    const idA = makeStatusId();
    const { cell } = await openFromList(env, idA, { preTop: 450 });
    env.pane().querySelector(".peek-native-close").click();
    await env.timers.flushMicrotasks();
    await env.navigate("/home");
    await env.timers.flushMicrotasks();
    cell.remove(); // virtualizer dropped the cell — window expires
    await env.timers.advance(3_000);
    assert.equal(env.poc.preOpenAnchor(), null, "window-expired consumes");
  }
  // user-input cancel
  {
    const env = makeEnv();
    env.boot();
    const idA = makeStatusId();
    await openFromList(env, idA, { preTop: 450 });
    env.pane().querySelector(".peek-native-close").click();
    await env.timers.flushMicrotasks();
    await env.navigate("/home");
    await env.timers.flushMicrotasks();
    env.window.dispatchEvent(new env.window.Event("wheel")); // the user takes over
    await env.timers.advance(500);
    assert.equal(env.poc.preOpenAnchor(), null, "user-input cancel consumes");
  }
});

test("A2 恢复窗口中被新会话取代：restore 取消，锚点换新（另一帖）", async () => {
  const env = makeEnv();
  env.boot();
  const idA = makeStatusId();
  const idB = makeStatusId();
  const { cell } = await openFromList(env, idA, { preTop: 450 });
  env.pane().querySelector(".peek-native-close").click();
  await env.timers.flushMicrotasks();
  await env.navigate("/home");
  await env.timers.flushMicrotasks();
  assert.equal(env.poc.restoreActive(), true, "restore armed");
  // before the restore completes, the user opens a DIFFERENT post: the new
  // legal session cancels the pending restore and captures its own anchor
  cell.getBoundingClientRect = () => ({ top: 300, bottom: 500, height: 200 }); // A remounted off-position
  await env.timers.advance(200);
  const { cell: cellB } = buildCell(focalFixture(idB));
  cellB.getBoundingClientRect = () => ({ top: 260, bottom: 460, height: 200 });
  env.document.body.appendChild(cellB);
  await env.pushNavigate(`/other/status/${idB}`);
  await env.timers.advance(1_200);
  assert.equal(env.poc.restoreActive(), false, "new open cancelled the pending restore");
  assert.equal(env.scroll.y, 0, "A's restore never scrolled");
  const anchor = env.poc.preOpenAnchor();
  assert.equal(anchor.statusId, idB, "anchor replaced by the new session");
  assert.equal(anchor.top, 260);
  assert.equal(anchor.source, "click-precommit");
});
