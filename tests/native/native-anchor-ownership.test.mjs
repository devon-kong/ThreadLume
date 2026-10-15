// Reading-anchor capture ownership — S3 adaptation (2026-10-15).
//
// The ownership rules are LIVE in the unified C1-R build: capturePreOpen runs
// on every pre-commit click / route entry, refuses detail-context captures,
// and lets only a new legal list-context capture replace the stored anchor.
// What retired with the M1 carrier is the restore EXECUTION and its
// "terminal state consumes the anchor" bookkeeping (restores are never armed
// in adapter mode — X's own scroll restoration owns list returns). Those
// scenarios now assert the unified-build semantics: the anchor survives as
// inert bookkeeping until a legal capture replaces it, and no return path
// ever scrolls programmatically.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeEnv, makeStatusId, buildCell, buildAuthor, buildTweetText, buildActionBar,
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
  return { cell };
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
  const poc = env.boot();
  const idA = makeStatusId();
  const idB = makeStatusId();
  await openFromList(env, idA, { preTop: 450 });
  assert.equal(poc.preOpenAnchor().statusId, idA);

  // X pushes a non-status route (search). In adapter mode no restore arms and
  // the list return never scrolls; the anchor stays as inert bookkeeping.
  env.location.pathname = "/search";
  env.location.href = "https://x.com/search";
  await env.timers.advance(5_100);
  assert.equal(poc.restoreActive(), false, "no restore ever arms in adapter mode");
  assert.equal(env.scroll.y, 0, "no programmatic correction on the search page");

  // a search result opens B (no click → no pre-commit capture). M1's
  // unconditional route-check capture would have STORED B's detail-page
  // position as a fresh garbage anchor here; the ownership rule refuses any
  // detail-context capture.
  const { cell: cellB } = buildCell(focalFixture(idB));
  cellB.getBoundingClientRect = () => ({ top: 99, bottom: 299, height: 200 }); // detail-position bait
  env.document.body.appendChild(cellB);
  env.location.pathname = `/other/status/${idB}`;
  env.location.href = `https://x.com/other/status/${idB}`;
  await env.timers.advance(2_100);
  assert.equal(poc.preOpenAnchor().statusId, idA, "detail-context capture refused — the list anchor survives untouched");

  // closing B back to /search: nothing to restore → no scrolling at all
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

test("A2 浏览器前进直接进入详情（无点击）：无锚点，返回不做任何滚动猜测", async () => {
  const env = makeEnv();
  env.boot();
  const idA = makeStatusId();
  // popstate into a detail (forward button) — no click capture ever ran
  await env.navigate(`/somebody/status/${idA}`);
  await env.timers.advance(1_500);
  assert.equal(env.poc.preOpenAnchor(), null, "no anchor without a pre-commit capture");
  // returning to a list never arms anything and never scrolls
  await env.navigate("/home");
  env.scroll.y = 800;
  await env.timers.advance(3_000);
  assert.equal(env.scroll.y, 800, "native behavior untouched");
});

test("A2（适配器模式）锚点是惰性记账：无终态消费，仅合法新捕获替换", async () => {
  // Collapses the retired restore-terminal-consumption scenarios (adjusted /
  // within-threshold / window-expired / user-input): none of those states can
  // occur in adapter mode, so the anchor persists until a LEGAL new capture.
  {
    const env = makeEnv();
    const poc = env.boot();
    const idA = makeStatusId();
    await openFromList(env, idA, { preTop: 450 });
    await env.navigate("/home"); // return: no restore, no consumption
    await env.timers.flushMicrotasks();
    const cell = env.document.querySelector('[data-testid="cellInnerDiv"]');
    cell.getBoundingClientRect = () => ({ top: 300, bottom: 500, height: 200 });
    await env.timers.advance(3_000); // past any would-be restore window
    assert.equal(poc.preOpenAnchor()?.statusId, idA, "anchor survives as inert bookkeeping");
    assert.equal(env.scroll.y, 0, "no restore-side scrolling");
    // user input (the old cancel trigger) changes nothing either
    env.window.dispatchEvent(new env.window.Event("wheel"));
    await env.timers.advance(500);
    assert.equal(poc.preOpenAnchor()?.statusId, idA, "no cancel-consumption without a restore session");
    // a keyboard re-open of the same post (detail-context) still never overwrites
    await env.programmaticNavigate(`/somebody/status/${idA}`);
    await env.timers.advance(1_200);
    assert.equal(poc.preOpenAnchor()?.statusId, idA, "detail-context refusal keeps the anchor");
  }
  // a new LEGAL list-context capture is the only thing that replaces it
  {
    const env = makeEnv();
    const poc = env.boot();
    const idA = makeStatusId();
    const idB = makeStatusId();
    await openFromList(env, idA, { preTop: 450 });
    await env.navigate("/home");
    await env.timers.flushMicrotasks();
    const { cell: cellB } = buildCell(focalFixture(idB));
    cellB.getBoundingClientRect = () => ({ top: 260, bottom: 460, height: 200 });
    env.document.body.appendChild(cellB);
    await env.pushNavigate(`/other/status/${idB}`);
    await env.timers.advance(1_200);
    const anchor = poc.preOpenAnchor();
    assert.equal(anchor.statusId, idB, "anchor replaced by the new legal session");
    assert.equal(anchor.top, 260);
    assert.equal(anchor.source, "click-precommit");
  }
});
