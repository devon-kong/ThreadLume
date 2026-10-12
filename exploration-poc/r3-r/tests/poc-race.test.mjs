// R3-R race & lifecycle regression tests (P0-B4).
// Drives the REAL production content.js through the shared jsdom harness with
// controlled timers: every scenario below is deterministic (no real X page,
// no network, no account). Scenario numbering follows the R3-R task B4 list.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeEnv, makeStatusId, mountCell, buildCell, buildAuthor, buildTweetText,
  buildPhoto, buildActionBar,
} from "./poc-env.mjs";

const waitMs = 20_000; // longer than one full build round (30 × 500ms)

function focalFixture(statusId, text = "焦点帖正文") {
  return { statusId, articleChildren: [buildAuthor(), buildTweetText(text), buildActionBar()] };
}

async function openAndWait(env, statusId, opts) {
  await env.navigate(`/somebody/status/${statusId}`);
  mountCell(env, opts ?? focalFixture(statusId));
  await env.timers.advance(1_500);
  return env.pane();
}

test("B4-1 进入 A 后立即返回首页：旧构建任务立即失效，永不挂载面板", async () => {
  const env = makeEnv(); // /home
  env.boot();
  const idA = makeStatusId();
  await env.navigate(`/somebody/status/${idA}`); // build starts, DOM absent
  await env.timers.advance(200);
  await env.navigate("/home");                    // teardown must invalidate the build
  await env.timers.advance(waitMs + 80_000);      // run out every pending timer incl. recovery
  assert.equal(env.panes(), 0, "no pane after leaving the detail page");
  assert.equal(env.style(), null, "no style residue");
  assert.equal(env.document.documentElement.getAttribute("data-peek-poc"), null);
  // keep advancing: nothing may mount later (stale task would do exactly this)
  await env.timers.advance(waitMs);
  assert.equal(env.panes(), 0);
});

test("B4-2 A 的 DOM 延迟出现：水合后面板建立一次且数据正确", async () => {
  const env = makeEnv();
  env.boot();
  const idA = makeStatusId();
  await env.navigate(`/somebody/status/${idA}`);
  await env.timers.advance(3_000); // DOM still missing → keep polling
  assert.equal(env.panes(), 0);
  mountCell(env, focalFixture(idA, "迟到水合的正文"));
  await env.timers.advance(1_000);
  const pane = env.pane();
  assert.ok(pane, "pane mounts once the focal DOM appears");
  assert.equal(pane.dataset.statusId, idA);
  assert.match(pane.textContent, /迟到水合的正文/);
  assert.equal(env.panes(), 1);
});

test("B4-3 A 尚未构建完就切换 B：只有 B 挂载，A 的迟到 DOM 不能抢占", async () => {
  const env = makeEnv();
  env.boot();
  const idA = makeStatusId();
  const idB = makeStatusId();
  await env.navigate(`/somebody/status/${idA}`);
  await env.timers.advance(200);
  await env.navigate(`/other/status/${idB}`);      // switch while A is still waiting
  mountCell(env, focalFixture(idB, "B 的正文"));
  await env.timers.advance(1_500);
  const pane = env.pane();
  assert.ok(pane && pane.dataset.statusId === idB, "B is mounted");
  assert.match(pane.textContent, /B 的正文/);
  // A hydrates late — its dead build must not update or remount anything
  mountCell(env, focalFixture(idA, "A 的正文"));
  await env.timers.advance(60_000);
  assert.equal(env.panes(), 1);
  assert.equal(env.pane().dataset.statusId, idB, "pane still shows B");
  assert.ok(!env.pane().textContent.includes("A 的正文"), "no stale A content");
});

test("B4-4 展开全文未完成就关闭：不残留过期挂载，展开点击不重复", async () => {
  const env = makeEnv();
  env.boot();
  const idA = makeStatusId();
  await env.navigate(`/somebody/status/${idA}`);
  const { cell, art } = buildCell({ statusId: idA, articleChildren: [buildAuthor(), buildTweetText("长帖"), buildActionBar()] });
  env.document.body.appendChild(cell);
  let clicks = 0;
  const more = env.document.createElement("button");
  more.setAttribute("role", "button");
  more.textContent = "显示更多";
  more.addEventListener("click", () => { clicks++; });
  art.appendChild(more);
  await env.timers.advance(700);  // attempt 2 (t≈500ms): clicks show-more, waits 700ms
  assert.equal(clicks, 1, "one display expansion started");
  await env.navigate("/home");    // close while the 700ms expansion wait is pending
  await env.timers.advance(60_000);
  assert.equal(env.panes(), 0, "no stale pane after close");
  assert.equal(clicks, 1, "the dead build never clicks again");
});

test("B4-5 连续快速打开 A、B、C：最终只挂载 C", async () => {
  const env = makeEnv();
  env.boot();
  const ids = [makeStatusId(), makeStatusId(), makeStatusId()];
  await env.navigate(`/somebody/status/${ids[0]}`);
  await env.timers.advance(100);
  await env.navigate(`/somebody/status/${ids[1]}`);
  await env.timers.advance(100);
  await env.navigate(`/somebody/status/${ids[2]}`);
  mountCell(env, focalFixture(ids[2], "C 的正文"));
  await env.timers.advance(waitMs);
  assert.equal(env.panes(), 1);
  assert.equal(env.pane().dataset.statusId, ids[2]);
  assert.ok(env.pane().textContent.includes("C 的正文"));
});

test("B4-6 后退、前进、再次进入：面板跟随路由出现与消失", async () => {
  const env = makeEnv();
  env.boot();
  const idA = makeStatusId();
  await openAndWait(env, idA);
  assert.ok(env.pane(), "pane on detail");
  await env.navigate("/home");
  assert.equal(env.panes(), 0, "back to list: pane gone");
  await openAndWait(env, idA);    // forward / re-enter
  assert.ok(env.pane(), "pane rebuilt on re-enter");
  assert.equal(env.panes(), 1);
  await env.navigate("/home");
  assert.equal(env.panes(), 0);
});

test("B4-7 DOM 等待超时后水合恢复：有界恢复重建阅读器且不重复", async () => {
  const env = makeEnv();
  env.boot();
  const idA = makeStatusId();
  await env.navigate(`/somebody/status/${idA}`);
  await env.timers.advance(waitMs);            // first build round times out (30 × 500ms)
  assert.equal(env.panes(), 0, "no pane while DOM is missing");
  mountCell(env, focalFixture(idA, "超时后水合"));
  await env.timers.advance(4_000);             // recovery round ≥3s later
  const pane = env.pane();
  assert.ok(pane, "recovery rebuilds the reader after hydration");
  assert.equal(pane.dataset.statusId, idA);
  assert.equal(env.panes(), 1);
  await env.timers.advance(120_000);           // recovery must not stack rounds
  assert.equal(env.panes(), 1);
});

test("B4-8 扩展重复注入：幂等，路由观察链只有一条", async () => {
  const env = makeEnv();
  env.boot();
  const pendingAfterFirst = env.timers.pendingCount;
  env.boot();                                  // re-registration / reload
  assert.equal(env.timers.pendingCount, pendingAfterFirst, "no second observation chain");
  const idA = makeStatusId();
  await openAndWait(env, idA);
  assert.equal(env.panes(), 1, "exactly one pane");
});

test("B4-9 卸载后无旧计时任务重新挂载 UI", async () => {
  const env = makeEnv();
  env.boot();
  const idA = makeStatusId();
  await openAndWait(env, idA);
  await env.navigate("/home");
  await env.timers.advance(180_000); // every timer the page will ever fire
  assert.equal(env.panes(), 0);
  assert.equal(env.timers.pendingCount <= 2, true, "only the route-watch chain remains");
});

test("B4-10 左栏焦点 ID 与 URL 始终一致（含 stale 守卫强制重建）", async () => {
  const env = makeEnv();
  env.boot();
  const idA = makeStatusId();
  const pane = await openAndWait(env, idA);
  assert.equal(pane.dataset.statusId, idA);
  // simulate a stale pane slipping through, then let the maintenance tick enforce the invariant
  pane.dataset.statusId = "999";
  await env.timers.advance(700);
  assert.equal(env.panes(), 1);
  assert.equal(env.pane().dataset.statusId, idA, "guard rebuilt with the URL's post");
});

test("关闭语义：会话内关闭走 history.back，直达进入仅拆除", async () => {
  const env = makeEnv(); // boot on /home, then SPA into detail → sessionNavigated
  env.boot();
  const idA = makeStatusId();
  await env.navigate("/home");
  await env.timers.advance(100);
  await openAndWait(env, idA);
  env.pane().querySelector(".peek-poc-close").click();
  await env.timers.flushMicrotasks();
  assert.equal(env.history._backCalls, 1, "in-session close goes back");
  await env.navigate("/home"); // the browser completes the back; observers react
  assert.equal(env.panes(), 0);

  const direct = makeEnv({ url: `/somebody/status/${makeStatusId()}` }); // direct entry
  direct.boot();
  mountCell(direct, focalFixture(direct.location.pathname.match(/\/status\/(\d+)/)[1]));
  await direct.timers.advance(1_500);
  assert.ok(direct.pane(), "direct-entry pane built");
  direct.pane().querySelector(".peek-poc-close").click();
  await direct.timers.flushMicrotasks();
  assert.equal(direct.history._backCalls, 0, "direct close never hijacks history");
  assert.equal(direct.location.pathname.includes("/status/"), true, "stays on X");
  assert.equal(direct.panes(), 0);
});

test("互动定位：面板按钮滚动并高亮原生控件，绝不代替用户点击", async () => {
  const env = makeEnv();
  env.boot();
  const idA = makeStatusId();
  await openAndWait(env, idA);
  const like = env.document.querySelector('[data-testid="like"]');
  let nativeClicks = 0;
  like.addEventListener("click", () => { nativeClicks++; });
  env.pane().querySelector('[data-act="like"]').click();
  await env.timers.flushMicrotasks();
  assert.equal(like.__scrollIntoViewCalls, 1, "native control scrolled into view");
  assert.match(like.style.outline, /2px solid/, "highlight applied");
  await env.timers.advance(1_700);
  assert.equal(like.style.outline, "", "highlight restored by an owned timer");
  assert.equal(nativeClicks, 0, "no synthetic write on the native control");
});
