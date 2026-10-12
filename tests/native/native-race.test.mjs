// M1 Native race & lifecycle tests (R4 P0-B4 semantics preserved through the
// engineering re-packaging), plus the M1-B4 interaction-semantics contract:
// the pane's action row LOCATES native controls and never performs writes.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeEnv, makeStatusId, mountCell, buildCell, buildAuthor, buildTweetText,
  buildActionBar,
} from "./native-env.mjs";

const waitMs = 20_000;

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
  const env = makeEnv();
  env.boot();
  const idA = makeStatusId();
  await env.navigate(`/somebody/status/${idA}`);
  await env.timers.advance(200);
  await env.navigate("/home");
  await env.timers.advance(waitMs + 80_000);
  assert.equal(env.panes(), 0, "no pane after leaving the detail page");
  assert.equal(env.style(), null, "no style residue");
  assert.equal(env.document.documentElement.getAttribute("data-peek-native"), null);
  await env.timers.advance(waitMs);
  assert.equal(env.panes(), 0);
});

test("B4-2 A 的 DOM 延迟出现：水合后面板建立一次且数据正确", async () => {
  const env = makeEnv();
  env.boot();
  const idA = makeStatusId();
  await env.navigate(`/somebody/status/${idA}`);
  await env.timers.advance(3_000);
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
  await env.navigate(`/other/status/${idB}`);
  mountCell(env, focalFixture(idB, "B 的正文"));
  await env.timers.advance(1_500);
  const pane = env.pane();
  assert.ok(pane && pane.dataset.statusId === idB, "B is mounted");
  assert.match(pane.textContent, /B 的正文/);
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
  await env.timers.advance(700);
  assert.equal(clicks, 1, "one display expansion started");
  await env.navigate("/home");
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
  await openAndWait(env, idA);
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
  await env.timers.advance(waitMs);
  assert.equal(env.panes(), 0, "no pane while DOM is missing");
  mountCell(env, focalFixture(idA, "超时后水合"));
  await env.timers.advance(4_000);
  const pane = env.pane();
  assert.ok(pane, "recovery rebuilds the reader after hydration");
  assert.equal(pane.dataset.statusId, idA);
  assert.equal(env.panes(), 1);
  await env.timers.advance(120_000);
  assert.equal(env.panes(), 1);
});

test("B4-8 扩展重复注入：幂等，路由观察链只有一条", async () => {
  const env = makeEnv();
  env.boot();
  const pendingAfterFirst = env.timers.pendingCount;
  env.boot();
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
  await env.timers.advance(180_000);
  assert.equal(env.panes(), 0);
  assert.equal(env.timers.pendingCount <= 2, true, "only the route-watch chain remains");
});

test("B4-10 左栏焦点 ID 与 URL 始终一致（含 stale 守卫强制重建）", async () => {
  const env = makeEnv();
  env.boot();
  const idA = makeStatusId();
  const pane = await openAndWait(env, idA);
  assert.equal(pane.dataset.statusId, idA);
  pane.dataset.statusId = "999";
  await env.timers.advance(700);
  assert.equal(env.panes(), 1);
  assert.equal(env.pane().dataset.statusId, idA, "guard rebuilt with the URL's post");
});

test("互动语义（M1-B4）：按钮文案如实表达“定位”而非执行", async () => {
  const env = makeEnv();
  env.boot();
  const idA = makeStatusId();
  const pane = await openAndWait(env, idA);
  const acts = [...pane.querySelectorAll(".peek-native-act")];
  const byAct = Object.fromEntries(acts.map((b) => [b.dataset.act, b]));
  for (const name of ["reply", "retweet", "like", "bookmark"]) {
    assert.match(byAct[name].textContent, /定位/, `“${name}”按钮明示定位语义`);
    assert.match(byAct[name].getAttribute("title") ?? "", /亲自|由你/, `“${name}”按钮提示说明由用户亲自操作`);
  }
  assert.equal(byAct.share.textContent, "复制链接", "share keeps its real semantics");
  assert.match(pane.querySelector('[role="toolbar"]').getAttribute("aria-label"), /不会代替你执行/, "toolbar aria-label is honest");
  const note = pane.querySelector(".peek-native-note");
  assert.match(note.textContent, /不会代替你点击/, "static note states the locate-only contract");
  assert.match(note.textContent, /不会构造任何账号写入/, "static note states no constructed writes");
});

test("互动语义（M1-B4）：点赞按钮只定位高亮，绝不代替用户点击；反馈如实", async () => {
  const env = makeEnv();
  env.boot();
  const idA = makeStatusId();
  await openAndWait(env, idA);
  const like = env.document.querySelector('[data-testid="like"]');
  let nativeClicks = 0;
  like.addEventListener("click", () => { nativeClicks++; });
  const noteEl = env.pane().querySelector(".peek-native-note");
  const staticBefore = noteEl.textContent;
  env.pane().querySelector('[data-act="like"]').click();
  await env.timers.flushMicrotasks();
  assert.equal(like.__scrollIntoViewCalls, 1, "native control scrolled into view");
  assert.match(like.style.outline, /2px solid/, "highlight applied");
  assert.match(noteEl.textContent, /已.*定位原生点赞控件/, "feedback says what Peek did");
  assert.match(noteEl.textContent, /亲自点击决定/, "feedback says the user decides");
  assert.doesNotMatch(noteEl.textContent, /已点赞/, "feedback never claims the like happened");
  await env.timers.advance(2_500);
  assert.equal(like.style.outline, "", "highlight restored by an owned timer");
  assert.equal(noteEl.textContent, staticBefore, "static note restored after the feedback window");
  assert.equal(noteEl.dataset.staticText, undefined, "feedback state cleaned up");
  assert.equal(nativeClicks, 0, "no synthetic write on the native control");
});

test("互动语义（M1-B4）：定位回复聚焦原生输入框，但不发送任何内容", async () => {
  const env = makeEnv();
  env.boot();
  const idA = makeStatusId();
  await openAndWait(env, idA);
  const composer = env.document.createElement("div");
  composer.setAttribute("data-testid", "tweetTextarea_0");
  composer.setAttribute("tabindex", "0");
  let focused = 0;
  composer.addEventListener("focus", () => { focused++; });
  const cell = env.document.querySelector('[data-testid="cellInnerDiv"]');
  cell.appendChild(composer);
  env.pane().querySelector('[data-act="reply"]').click();
  await env.timers.advance(600);
  assert.ok(cell.__scrollIntoViewCalls >= 1, "the native cell scrolled into view");
  assert.equal(focused, 1, "composer focused for the user to type");
  const note = env.pane().querySelector(".peek-native-note");
  assert.match(note.textContent, /亲自输入并发送/, "feedback says the user types and sends");
});

test("互动语义（M1-B4）：复制链接写入剪贴板且不触发布局行为", async () => {
  const env = makeEnv();
  env.boot();
  const idA = makeStatusId();
  await openAndWait(env, idA);
  let copied = null;
  env.window.navigator.clipboard = { writeText: async (t) => { copied = t; } };
  env.pane().querySelector('[data-act="share"]').click();
  await env.timers.flushMicrotasks();
  assert.equal(copied, `https://x.com/somebody/status/${idA}`);
  const note = env.pane().querySelector(".peek-native-note");
  assert.match(note.textContent, /链接已复制/);
});

test("互动语义（M1-B4）：找不到原生控件时给中性提示，不伪装成功", async () => {
  const env = makeEnv();
  env.boot();
  const idA = makeStatusId();
  await openAndWait(env, idA);
  env.document.querySelector('[data-testid="like"]').closest('[role="group"]').remove();
  env.pane().querySelector('[data-act="like"]').click();
  await env.timers.flushMicrotasks();
  const note = env.pane().querySelector(".peek-native-note");
  assert.match(note.textContent, /未能.*找到|手动滚动/, "neutral guidance, no false success");
});
