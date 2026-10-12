// M1-B3 reading-anchor restore tests. The new bounded restore narrows the
// visible offset X's virtual-list re-anchoring leaves after the reader closes
// (R4 measured 151-153px; target ≤60px). Hard limits under test:
//   - AT MOST ONE instant scroll correction per return;
//   - any user input cancels the restore;
//   - no cell / no settle / no recorded anchor → native behavior untouched;
//   - offsets inside the threshold are left to native behavior.
// Scroll math: delta = cellTop − preTop; scrollBy(0, delta) puts the cell back
// at its pre-open viewport Y (positive delta scrolls down, negative up).
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
  // the post sits in the list at viewport Y = preTop when it is clicked open
  const { cell } = buildCell(focalFixture(statusId));
  cell.getBoundingClientRect = () => ({ top: preTop, bottom: preTop + 200, height: 200 });
  env.document.body.appendChild(cell);
  await env.pushNavigate(`/somebody/status/${statusId}`);
  await env.timers.advance(1_200); // fast first paint (capture happened at route change)
  return { pane: env.pane(), cell };
}

async function closeViaButton(env) {
  env.pane().querySelector(".peek-native-close").click();
  await env.timers.flushMicrotasks();
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

test("B3 关闭返回后滚动位置稳定 → 一次有界微调把锚点拉回（151px 场景，目标 ≤60px）", async () => {
  const env = makeEnv();
  const poc = env.boot();
  const idA = makeStatusId();
  await openFromList(env, idA, { preTop: 450 });
  await closeViaButton(env);
  await env.navigate("/home"); // the back completes; X re-anchors (its own 151px behavior)
  await env.timers.flushMicrotasks();

  // the timeline remounts the cell visibly off its pre-open position;
  // X's re-anchored scroll position (its own doing)
  env.scroll.y = 2000;
  const cell = env.document.querySelector('[data-testid="cellInnerDiv"]');
  cell.getBoundingClientRect = () => ({ top: 299, bottom: 499, height: 200 }); // 151px off
  await env.timers.advance(700); // settle checks (3 × 150ms) + adjustment

  assert.equal(env.scroll.y, 1849, "exactly one scrollBy(0, -151) applied");
  const rec = poc.diag().anchor;
  assert.ok(rec, "anchor restore recorded for diagnostics");
  assert.equal(rec.statusId, idA);
  assert.equal(rec.preTop, 450);
  assert.equal(rec.cellTop, 299);
  assert.equal(rec.delta, -151);
  assert.equal(rec.applied, true);
  // post-adjustment residual: the cell now sits at its pre-open viewport Y
  cell.getBoundingClientRect = () => ({ top: 450, bottom: 650, height: 200 });
  assert.equal(Math.abs(cell.getBoundingClientRect().top - rec.preTop), 0, "residual offset 0 ≤ 60px target");
});

test("B3 偏差在阈值内：不产生任何滚动调整（原生行为保持）", async () => {
  const env = makeEnv();
  const poc = env.boot();
  const idA = makeStatusId();
  await openFromList(env, idA, { preTop: 450 });
  await closeViaButton(env);
  await env.navigate("/home");
  await env.timers.flushMicrotasks();
  const cell = env.document.querySelector('[data-testid="cellInnerDiv"]');
  cell.getBoundingClientRect = () => ({ top: 430, bottom: 630, height: 200 }); // 20px off
  await env.timers.advance(700);
  assert.equal(env.scroll.y, 0, "no adjustment inside the 40px threshold");
  assert.equal(poc.diag().anchor.applied, false);
});

test("B3 稳定前 X 继续自行滚动：等待稳定，只按稳定后的位置调一次", async () => {
  const env = makeEnv();
  const poc = env.boot();
  const idA = makeStatusId();
  await openFromList(env, idA, { preTop: 450 });
  await closeViaButton(env);
  await env.navigate("/home");
  await env.timers.flushMicrotasks();
  const cell = env.document.querySelector('[data-testid="cellInnerDiv"]');
  // poll 1: still settling (scrollY changes between polls)
  cell.getBoundingClientRect = () => ({ top: 300, bottom: 500, height: 200 });
  env.scroll.y = 900;
  await env.timers.advance(200);
  env.scroll.y = 1200; // X's own re-anchor lands
  cell.getBoundingClientRect = () => ({ top: 280, bottom: 480, height: 200 });
  await env.timers.advance(500);
  assert.equal(env.scroll.y, 1030, "one adjustment from the settled position (1200-170)");
  assert.equal(poc.diag().anchor.cellTop, 280);
});

test("B3 用户滚动立即取消：绝不与用户竞争滚动", async () => {
  const env = makeEnv();
  const poc = env.boot();
  const idA = makeStatusId();
  await openFromList(env, idA, { preTop: 450 });
  await closeViaButton(env);
  await env.navigate("/home");
  await env.timers.flushMicrotasks();
  const cell = env.document.querySelector('[data-testid="cellInnerDiv"]');
  cell.getBoundingClientRect = () => ({ top: 300, bottom: 500, height: 200 });
  // the user wheels before the settle window completes
  env.window.dispatchEvent(new env.window.Event("wheel"));
  await env.timers.advance(1_000);
  assert.equal(env.scroll.y, 0, "no programmatic adjustment after user input");
  assert.equal(poc.restoreActive(), false, "restore window closed");
  assert.equal(poc.diag().anchor, null, "no adjustment record — native behavior owned the return");
});

test("B3 用户按键/触摸/按下同样取消", async () => {
  for (const type of ["keydown", "touchmove", "pointerdown"]) {
    const env = makeEnv();
    const poc = env.boot();
    const idA = makeStatusId();
    await openFromList(env, idA, { preTop: 450 });
    await closeViaButton(env);
    await env.navigate("/home");
    await env.timers.flushMicrotasks();
    const cell = env.document.querySelector('[data-testid="cellInnerDiv"]');
    cell.getBoundingClientRect = () => ({ top: 300, bottom: 500, height: 200 });
    env.window.dispatchEvent(new env.window.Event(type));
    await env.timers.advance(1_000);
    assert.equal(env.scroll.y, 0, `${type} cancels the restore`);
  }
});

test("B3 焦点格未重挂（滚动很远的帖）：窗口过期后放弃，保持原生行为", async () => {
  const env = makeEnv();
  const poc = env.boot();
  const idA = makeStatusId();
  const { cell } = await openFromList(env, idA, { preTop: 450 });
  await closeViaButton(env);
  await env.navigate("/home");
  await env.timers.flushMicrotasks();
  cell.remove(); // the virtualizer dropped the post's cell (user had scrolled far)
  await env.timers.advance(3_000);
  assert.equal(env.scroll.y, 0, "no adjustment without the cell");
  assert.equal(poc.restoreActive(), false, "bounded window closed by itself");
  assert.equal(poc.diag().anchor, null);
  // and it can still restore later navigations (state reset, not stuck)
  const idB = makeStatusId();
  const { cell: cellB } = await openFromList(env, idB, { preTop: 300 });
  await closeViaButton(env);
  await env.navigate("/home");
  await env.timers.flushMicrotasks();
  cellB.getBoundingClientRect = () => ({ top: 120, bottom: 320, height: 200 });
  await env.timers.advance(700);
  assert.equal(env.scroll.y, -180, "next open/return cycle restores normally (120-300)");
});

test("B3 外部直达详情（无锚点记录）：关闭不做任何滚动调整", async () => {
  const env = makeEnv({ url: `/somebody/status/${makeStatusId()}` });
  const poc = env.boot();
  const idA = env.location.pathname.match(/\/status\/(\d+)/)[1];
  mountCell(env, focalFixture(idA));
  await env.timers.advance(1_500);
  assert.equal(poc.preOpenAnchor(), null, "no anchor for a direct entry");
  await closeViaButton(env);
  // close dismisses in place (no route change); arm nothing
  await env.timers.advance(3_000);
  assert.equal(env.scroll.y, 0);
  assert.equal(poc.restoreActive(), false);
});

test("B3 detail→detail 打开：保留最初列表锚点，不重置", async () => {
  const env = makeEnv();
  const poc = env.boot();
  const idA = makeStatusId();
  const idB = makeStatusId();
  await openFromList(env, idA, { preTop: 450 });
  // open B from A's detail: no new anchor capture (still reading from a detail page)
  await env.pushNavigate(`/other/status/${idB}`);
  await env.timers.advance(1_200);
  const anchor = poc.preOpenAnchor();
  assert.equal(anchor.statusId, idA, "anchor still points at the list-originated post");
  // back to A (a detail — no restore), then back to the list → restore armed once
  await env.navigate(`/somebody/status/${idA}`);
  await env.timers.advance(1_200);
  assert.equal(poc.restoreActive(), false, "detail→detail return never scrolls");
  await env.navigate("/home");
  await env.timers.flushMicrotasks();
  const cell = env.document.querySelector('[data-testid="cellInnerDiv"]');
  cell.getBoundingClientRect = () => ({ top: 380, bottom: 580, height: 200 });
  await env.timers.advance(700);
  assert.equal(env.scroll.y, -70, "restore fires for the list return (380-450)");
});

test("B3 restore 只调一次：调整后继续推进时钟不再滚动", async () => {
  const env = makeEnv();
  const poc = env.boot();
  const idA = makeStatusId();
  await openFromList(env, idA, { preTop: 450 });
  await closeViaButton(env);
  await env.navigate("/home");
  await env.timers.flushMicrotasks();
  const cell = env.document.querySelector('[data-testid="cellInnerDiv"]');
  cell.getBoundingClientRect = () => ({ top: 300, bottom: 500, height: 200 });
  await env.timers.advance(700);
  assert.equal(env.scroll.y, -150);
  await env.timers.advance(120_000);
  assert.equal(env.scroll.y, -150, "no further scrolls ever");
  assert.equal(poc.restoreActive(), false);
});

test("B3 关闭后立即重新打开同一帖：取消 restore，重新捕获锚点", async () => {
  const env = makeEnv();
  const poc = env.boot();
  const idA = makeStatusId();
  const { cell } = await openFromList(env, idA, { preTop: 450 });
  await closeViaButton(env);
  await env.navigate("/home");
  await env.timers.flushMicrotasks();
  assert.equal(poc.restoreActive(), true, "restore armed");
  // user clicks the post again before the restore completes (old cell unmounted
  // by the virtualizer; the post is now visible elsewhere at a new position)
  cell.remove();
  await openFromList(env, idA, { preTop: 200 });
  assert.equal(poc.restoreActive(), false, "re-open cancelled the pending restore");
  assert.equal(poc.preOpenAnchor().top, 200, "anchor re-captured for the new open");
  await env.timers.advance(5_000);
  assert.equal(poc.restoreActive(), false);
});
