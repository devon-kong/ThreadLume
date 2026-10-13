// M2-A comments-first (option C) — right column opens on the replies for
// posts the left pane fully duplicates (text / photos / quote); rich posts
// (video / poll / card / article) keep the native focal cell in view.
//
// Under test: exactly ONE bounded scroll, gated by
//   - content type (rich → never scroll),
//   - focal size (small focal → duplication is minor, keep native layout),
//   - user priority (any input or prior scrolling → never scroll),
//   - liveness (route moved / reader removed → never scroll),
//   - bounded wait (no replies in 3s → give up silently).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeEnv, makeStatusId, mountCell, buildCell, buildAuthor, buildTweetText,
  buildActionBar,
} from "./native-env.mjs";

function focalFixture(statusId, text = "焦点帖正文") {
  return { statusId, articleChildren: [buildAuthor(), buildTweetText(text), buildActionBar()] };
}

// a tall focal (≥60% of the 800px viewport) with a reply cell below it
function tallFocal(statusId, { height = 560, focalTop = 53, replyTop = null } = {}) {
  const { cell } = buildCell(focalFixture(statusId));
  const h = height;
  cell.getBoundingClientRect = () => ({ top: focalTop, bottom: focalTop + h, height: h });
  const { cell: replyCell } = buildCell({ statusId: `${statusId}-reply`, articleChildren: [buildAuthor(), buildTweetText("回复")] });
  replyCell.getBoundingClientRect = () => ({ top: replyTop ?? focalTop + h, bottom: (replyTop ?? focalTop + h) + 200, height: 200 });
  return { cell, replyCell };
}

async function openSimplePost(env, statusId, opts) {
  const { cell, replyCell } = tallFocal(statusId, opts);
  env.document.body.appendChild(cell);
  await env.pushNavigate(`/somebody/status/${statusId}`);
  await env.timers.advance(1_200); // fast first paint; comments-first armed
  return { cell, replyCell };
}

test("C-1 纯文本长焦点帖：回复格出现后一次滚动把评论带到右栏顶部", async () => {
  const env = makeEnv();
  const poc = env.boot();
  const idA = makeStatusId();
  const { cell, replyCell } = await openSimplePost(env, idA, { height: 560 });
  env.document.body.appendChild(replyCell); // replies hydrate after mount
  await env.timers.advance(400);            // one CF poll tick + scroll
  const rec = poc.diag().commentsFirst;
  assert.equal(rec.applied, true, "scroll applied");
  assert.equal(rec.why, undefined);
  // target = replyTop(613) − header(53) = 560
  assert.equal(env.scroll.y, 560, "one scroll to the header offset");
  // and never again
  await env.timers.advance(5_000);
  assert.equal(env.scroll.y, 560, "exactly one scroll ever");
  assert.equal(env.panes(), 1);
  assert.ok(cell.isConnected && replyCell.isConnected, "native focal cell untouched in the DOM");
});

test("C-2 富媒体帖（视频/投票/卡片/文章）：原生焦点帖保持在视野内，绝不滚动", async () => {
  for (const rich of [
    { video: true, poll: false, card: false, article: false },
    { video: false, poll: true, card: false, article: false },
    { video: false, poll: false, card: true, article: false },
    { video: false, poll: false, card: false, article: true },
  ]) {
    const env = makeEnv();
    const poc = env.boot();
    const idA = makeStatusId();
    await openSimplePost(env, idA, { height: 1_100 });
    // arm manually with the rich flags (the build path passes data.rich)
    poc.armCommentsFirst(idA, rich, () => true);
    env.document.querySelectorAll('[data-testid="cellInnerDiv"]')[1]
      ?.getBoundingClientRect; // reply exists in DOM shape below via tallFocal
    await env.timers.advance(4_000);
    assert.equal(env.scroll.y, 0, `no scroll for rich flags ${JSON.stringify(rich)}`);
    assert.equal(poc.diag().commentsFirst.why, "rich-native-kept");
  }
});

test("C-3 等待窗口内用户输入：取消滚动，视口归用户", async () => {
  for (const type of ["wheel", "keydown", "pointerdown", "touchmove"]) {
    const env = makeEnv();
    const poc = env.boot();
    const idA = makeStatusId();
    const { replyCell } = await openSimplePost(env, idA, { height: 560 });
    env.window.dispatchEvent(new env.window.Event(type));
    env.document.body.appendChild(replyCell);
    await env.timers.advance(4_000);
    assert.equal(env.scroll.y, 0, `${type} cancels the comments-first scroll`);
    assert.equal(poc.diag().commentsFirst.why, "user-input");
  }
});

test("C-4 用户在回复渲染前已滚动：不与用户竞争", async () => {
  const env = makeEnv();
  const poc = env.boot();
  const idA = makeStatusId();
  const { replyCell } = await openSimplePost(env, idA, { height: 560 });
  env.scroll.y = 300; // the user scrolled while replies were still hydrating
  env.document.body.appendChild(replyCell);
  await env.timers.advance(4_000);
  assert.equal(env.scroll.y, 300, "no scroll on top of the user's position");
  assert.equal(poc.diag().commentsFirst.why, "user-scrolled");
});

test("C-5 短焦点帖（<60% 视口）：重复感轻微，保持原生布局", async () => {
  const env = makeEnv();
  const poc = env.boot();
  const idA = makeStatusId();
  const { replyCell } = await openSimplePost(env, idA, { height: 300 });
  env.document.body.appendChild(replyCell);
  await env.timers.advance(4_000);
  assert.equal(env.scroll.y, 0, "no scroll for a small focal");
  assert.equal(poc.diag().commentsFirst.why, "focal-small");
});

test("C-6 路由中途离开：不滚动旧目标", async () => {
  const env = makeEnv();
  const poc = env.boot();
  const idA = makeStatusId();
  const { replyCell } = await openSimplePost(env, idA, { height: 560 });
  await env.pushNavigate("/home"); // user navigated away before replies rendered
  env.document.body.appendChild(replyCell);
  await env.timers.advance(4_000);
  assert.equal(env.scroll.y, 0, "stale arming never scrolls");
  assert.equal(env.panes(), 0, "reader torn down with the route");
});

test("C-7 回复一直不出现：有界窗口安静放弃（零滚动）", async () => {
  const env = makeEnv();
  const poc = env.boot();
  const idA = makeStatusId();
  await openSimplePost(env, idA, { height: 560 });
  await env.timers.advance(4_000);
  assert.equal(env.scroll.y, 0);
  assert.equal(poc.diag().commentsFirst.why, "no-reply-in-window");
  assert.equal(poc.commentsFirstArmed(), false, "arming released");
});

test("C-8 关闭阅读器拆除 arming：后续路由不受残留状态影响", async () => {
  const env = makeEnv();
  const poc = env.boot();
  const idA = makeStatusId();
  const { cell, replyCell } = await openSimplePost(env, idA, { height: 560 });
  assert.equal(poc.commentsFirstArmed(), true, "armed while waiting for replies");
  env.pane().querySelector(".peek-native-close").click();
  await env.timers.flushMicrotasks();
  await env.navigate("/home"); // the history.back() the close decision issues
  await env.timers.flushMicrotasks();
  assert.equal(poc.commentsFirstArmed(), false, "torn down with the reader");
  env.document.body.appendChild(replyCell);
  await env.timers.advance(4_000);
  assert.equal(env.scroll.y, 0, "nothing fires after teardown");
});

test("C-9 buildReader 全链路（提取 rich 标记）：视频帖不滚动、文本帖滚动", async () => {
  // video post end-to-end: the extractor must see the player in the cell
  {
    const env = makeEnv();
    env.boot();
    const idA = makeStatusId();
    const { cell, replyCell } = tallFocal(idA, { height: 1_100 });
    const player = env.document.createElement("div");
    player.setAttribute("data-testid", "videoPlayer");
    cell.querySelector("article").appendChild(player);
    env.document.body.appendChild(cell);
    env.document.body.appendChild(replyCell);
    await env.pushNavigate(`/somebody/status/${idA}`);
    await env.timers.advance(4_000);
    assert.equal(env.scroll.y, 0, "video post keeps the native focal in view");
    assert.equal(env.poc.diag().commentsFirst.why, "rich-native-kept");
  }
  // plain text post end-to-end
  {
    const env = makeEnv();
    env.boot();
    const idA = makeStatusId();
    const { cell, replyCell } = tallFocal(idA, { height: 560 });
    env.document.body.appendChild(cell);
    env.document.body.appendChild(replyCell);
    await env.pushNavigate(`/somebody/status/${idA}`);
    await env.timers.advance(1_200);
    await env.timers.advance(600);
    assert.equal(env.scroll.y, 560, "text post opens on the replies");
    assert.equal(env.poc.diag().commentsFirst.applied, true);
  }
});
