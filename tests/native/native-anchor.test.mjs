// Reading-anchor tests — S3 adaptation (2026-10-15).
//
// Anchor CAPTURE stays live in the unified C1-R build (inert bookkeeping that
// feeds diagnostics and a possible future restore), and the scroll-delta math
// is unchanged — both keep their original tests. What retired with the M1
// carrier is the restore EXECUTION: in adapter mode the route observer never
// arms a restore (X's own scroll restoration owns list returns), so the
// precise once-only/adjust/threshold choreography has no runtime path anymore.
// The correct unified-build contract is asserted instead: a list return never
// receives ANY programmatic scroll correction, with or without user input.
// (The restore implementation remains in source, gated off at its only call
// site; its historical behavior is pinned by the archived M1 test suites in
// git history.)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeEnv, makeStatusId, buildCell, buildAuthor, buildTweetText, buildActionBar,
} from "./native-env.mjs";

function focalFixture(statusId, text = "焦点帖正文") {
  return { statusId, articleChildren: [buildAuthor(), buildTweetText(text), buildActionBar()] };
}

async function openFromList(env, statusId, { preTop = 450 } = {}) {
  // the post sits in the list at viewport Y = preTop when it is clicked open
  const { cell } = buildCell(focalFixture(statusId));
  cell.getBoundingClientRect = () => ({ top: preTop, bottom: preTop + 200, height: 200 });
  env.document.body.appendChild(cell);
  await env.pushNavigate(`/somebody/status/${statusId}`);
  await env.timers.advance(1_200); // fast first paint (capture happened at route change)
  return { cell };
}

test("B3 纯函数：超阈值返回滚动差值，阈值内返回 null", async () => {
  const env = makeEnv();
  const poc = env.boot();
  assert.equal(poc.computeAnchorAdjustment({ preTop: 450, cellTop: 299 }), -151);
  assert.equal(poc.computeAnchorAdjustment({ preTop: 450, cellTop: 580 }), 130);
  assert.equal(poc.computeAnchorAdjustment({ preTop: 450, cellTop: 470 }), null, "20px inside threshold");
  assert.equal(poc.computeAnchorAdjustment({ preTop: 450, cellTop: 465, threshold: 20 }), null, "15px inside threshold");
  assert.equal(poc.computeAnchorAdjustment({ preTop: 450, cellTop: 495, threshold: 20 }), 45);
});

test("B3 打开时记录焦点格视口位置（fallback 路径在路由提交时尽力捕获）", async () => {
  const env = makeEnv();
  const poc = env.boot();
  const idA = makeStatusId();
  await openFromList(env, idA, { preTop: 450 });
  const anchor = poc.preOpenAnchor();
  assert.ok(anchor, "anchor captured on open");
  assert.equal(anchor.statusId, idA);
  assert.equal(anchor.top, 450);
});

test("B3（适配器模式）关闭返回列表：绝不施加程序化滚动修正，X 原生滚动恢复接管", async () => {
  const env = makeEnv();
  const poc = env.boot();
  const idA = makeStatusId();
  await openFromList(env, idA, { preTop: 450 });
  await env.navigate("/home"); // the return to the list (any exit path leads here)
  await env.timers.flushMicrotasks();

  // X re-anchors the remounted cell 151px off its pre-open position (its own
  // behavior). The adapter build owns NO correction: no restore was ever armed.
  env.scroll.y = 2000;
  const cell = env.document.querySelector('[data-testid="cellInnerDiv"]');
  cell.getBoundingClientRect = () => ({ top: 299, bottom: 499, height: 200 });
  await env.timers.advance(3_000); // well past the would-be settle + restore window

  assert.equal(env.scroll.y, 2000, "no programmatic scrollBy competes with X's own restoration");
  assert.equal(poc.restoreActive(), false, "no restore session exists in adapter mode");
  assert.equal(poc.diag().anchor, null, "no adjustment record — native behavior owned the return");
});

test("B3（适配器模式）用户输入期间同样零程序化滚动（恢复路径整体休眠）", async () => {
  for (const type of ["wheel", "keydown", "touchmove", "pointerdown"]) {
    const env = makeEnv();
    env.boot();
    const idA = makeStatusId();
    await openFromList(env, idA, { preTop: 450 });
    await env.navigate("/home");
    await env.timers.flushMicrotasks();
    const cell = env.document.querySelector('[data-testid="cellInnerDiv"]');
    cell.getBoundingClientRect = () => ({ top: 300, bottom: 500, height: 200 });
    env.window.dispatchEvent(new env.window.Event(type));
    await env.timers.advance(3_000);
    assert.equal(env.scroll.y, 0, `${type}: no programmatic adjustment, nothing to cancel`);
  }
});

test("B3（适配器模式）焦点格未重挂或窗口过期：零修正，捕获保持惰性记账", async () => {
  const env = makeEnv();
  const poc = env.boot();
  const idA = makeStatusId();
  const { cell } = await openFromList(env, idA, { preTop: 450 });
  await env.navigate("/home");
  await env.timers.flushMicrotasks();
  cell.remove(); // the virtualizer dropped the post's cell (user had scrolled far)
  await env.timers.advance(3_000);
  assert.equal(env.scroll.y, 0, "no adjustment without the cell");
  assert.equal(poc.restoreActive(), false);
  assert.equal(poc.diag().anchor, null);
  // the capture side stays live as inert bookkeeping and is replaced by the
  // next legal list-context capture (ownership semantics: ownership suite)
  const idB = makeStatusId();
  await openFromList(env, idB, { preTop: 300 });
  assert.equal(poc.preOpenAnchor().statusId, idB, "next legal capture replaces the inert anchor");
});
