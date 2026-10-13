// M2-A comments-first (option C) — right column opens on the replies for
// posts the left pane fully duplicates (text / photos / quote); rich posts
// (video / poll / card / article) keep the native focal cell in view.
//
// Under test: exactly ONE bounded scroll, gated by
//   - content type (rich → never scroll),
//   - focal size (small focal → duplication is minor, keep native layout),
//   - user priority (any input or prior scrolling → never scroll),
//   - liveness (route moved / reader removed → never scroll),
//   - bounded wait (no replies in 6s → give up silently).
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
  const detail = cell.ownerDocument.createElement("div");
  detail.setAttribute("data-testid", "inline_reply_offscreen");
  cell.appendChild(detail);
  const h = height;
  cell.getBoundingClientRect = () => ({ top: focalTop, bottom: focalTop + h, height: h });
  const { cell: replyCell } = buildCell({ statusId: makeStatusId(), articleChildren: [buildAuthor(), buildTweetText("回复")] });
  replyCell.getBoundingClientRect = () => ({ top: replyTop ?? focalTop + h, bottom: (replyTop ?? focalTop + h) + 200, height: 200 });
  return { cell, replyCell };
}

function nativeList(env) {
  let list = env.document.querySelector('[data-testid="primaryColumn"] > div');
  if (!list) {
    const primary = env.document.createElement("main");
    primary.setAttribute("data-testid", "primaryColumn");
    list = env.document.createElement("div");
    primary.appendChild(list);
    env.document.body.appendChild(primary);
  }
  return list;
}

async function openSimplePost(env, statusId, opts) {
  const { cell, replyCell } = tallFocal(statusId, opts);
  nativeList(env).appendChild(cell);
  await env.pushNavigate(`/somebody/status/${statusId}`);
  await env.timers.advance(1_200); // fast first paint; comments-first armed
  return { cell, replyCell };
}

test("C-1 纯文本长焦点帖：回复格出现后一次滚动把评论带到右栏顶部", async () => {
  const env = makeEnv();
  const poc = env.boot();
  const idA = makeStatusId();
  const { cell, replyCell } = await openSimplePost(env, idA, { height: 560 });
  nativeList(env).appendChild(replyCell); // replies hydrate after mount
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
    nativeList(env).appendChild(replyCell);
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
  nativeList(env).appendChild(replyCell);
  await env.timers.advance(4_000);
  assert.equal(env.scroll.y, 300, "no scroll on top of the user's position");
  assert.equal(poc.diag().commentsFirst.why, "user-scrolled");
});

test("C-5 短焦点帖（<60% 视口）：重复感轻微，保持原生布局", async () => {
  const env = makeEnv();
  const poc = env.boot();
  const idA = makeStatusId();
  const { replyCell } = await openSimplePost(env, idA, { height: 300 });
  nativeList(env).appendChild(replyCell);
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
  nativeList(env).appendChild(replyCell);
  await env.timers.advance(4_000);
  assert.equal(env.scroll.y, 0, "stale arming never scrolls");
  assert.equal(env.panes(), 0, "reader torn down with the route");
});

test("C-7 回复一直不出现：有界窗口安静放弃（零滚动）", async () => {
  const env = makeEnv();
  const poc = env.boot();
  const idA = makeStatusId();
  await openSimplePost(env, idA, { height: 560 });
  await env.timers.advance(7_000); // past the 6s bounded window
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
  nativeList(env).appendChild(replyCell);
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
    nativeList(env).appendChild(cell);
    nativeList(env).appendChild(replyCell);
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
    nativeList(env).appendChild(cell);
    nativeList(env).appendChild(replyCell);
    await env.pushNavigate(`/somebody/status/${idA}`);
    await env.timers.advance(1_200);
    await env.timers.advance(600);
    assert.equal(env.scroll.y, 560, "text post opens on the replies");
    assert.equal(env.poc.diag().commentsFirst.applied, true);
  }
});

test("C-10 迟到媒体水合（滚动前）：海报占位换成播放器 → 滚动被取消，原生格保持在视野", async () => {
  // full page loads render video posts as a poster first (found live);
  // the scroll-time rich check is the authoritative gate
  const env = makeEnv();
  const poc = env.boot();
  const idA = makeStatusId();
  const { cell, replyCell } = tallFocal(idA, { height: 1_100 });
  nativeList(env).appendChild(cell);
  await env.pushNavigate(`/somebody/status/${idA}`);
  await env.timers.advance(1_200);
  assert.equal(env.scroll.y, 0);
  // the video player hydrates before any reply cell exists
  const player = env.document.createElement("div");
  player.setAttribute("data-testid", "videoPlayer");
  cell.querySelector("article").appendChild(player);
  nativeList(env).appendChild(replyCell);
  await env.timers.advance(1_000);
  assert.equal(env.scroll.y, 0, "late-hydrated player cancels the scroll");
  assert.equal(poc.diag().commentsFirst.why, "rich-native-kept-late");
});

test("C-11 迟到媒体水合（滚动后，用户未动）：一次有界回滚把原生格带回视野", async () => {
  const env = makeEnv();
  const poc = env.boot();
  const idA = makeStatusId();
  const { cell, replyCell } = tallFocal(idA, { height: 560 });
  nativeList(env).appendChild(cell);
  nativeList(env).appendChild(replyCell);
  await env.pushNavigate(`/somebody/status/${idA}`);
  await env.timers.advance(1_200);
  await env.timers.advance(600);
  assert.equal(env.scroll.y, 560, "comments-first applied (no media yet)");
  // the video player hydrates after the scroll, the user has not moved
  const player = env.document.createElement("div");
  player.setAttribute("data-testid", "videoPlayer");
  cell.querySelector("article").appendChild(player);
  await env.timers.advance(1_500); // one late-watch poll tick
  assert.equal(env.scroll.y, 0, "one bounded return to the native cell");
  assert.equal(poc.diag().commentsFirst.why, "late-media-return");
  // and it never loops
  await env.timers.advance(20_000);
  assert.equal(env.scroll.y, 0);
});

test("C-11b 迟到媒体水合（滚动后，用户已滚动）：绝不与用户竞争视口", async () => {
  const env = makeEnv();
  const poc = env.boot();
  const idA = makeStatusId();
  const { cell, replyCell } = tallFocal(idA, { height: 560 });
  nativeList(env).appendChild(cell);
  nativeList(env).appendChild(replyCell);
  await env.pushNavigate(`/somebody/status/${idA}`);
  await env.timers.advance(1_200);
  await env.timers.advance(600);
  assert.equal(env.scroll.y, 560);
  env.scroll.y = 1_400; // the user read on; then the player hydrates
  const player = env.document.createElement("div");
  player.setAttribute("data-testid", "videoPlayer");
  cell.querySelector("article").appendChild(player);
  await env.timers.advance(20_000);
  assert.equal(env.scroll.y, 1_400, "the user's position is never overridden");
});

// Regression: the late-media phase must retain input ownership, even if the
// input did not change window.scrollY (typing, clicking, or scrolling back).
test("C-12 迟到回看期间任意用户输入永久取消回滚", async () => {
  for (const type of ["pointerdown", "keydown", "wheel", "touchmove"]) {
    const env = makeEnv();
    env.boot();
    const id = makeStatusId();
    const { cell, replyCell } = await openSimplePost(env, id, { height: 560 });
    nativeList(env).appendChild(replyCell);
    await env.timers.advance(400);
    assert.equal(env.scroll.y, 560);
    env.window.dispatchEvent(new env.window.Event(type));
    // Return to the same coordinate before the next watch tick.
    env.scroll.y = 900;
    env.scroll.y = 560;
    const player = env.document.createElement("video");
    cell.querySelector("article").appendChild(player);
    await env.timers.advance(20_000);
    assert.equal(env.scroll.y, 560, `${type} transfers ownership permanently`);
  }
});

test("C-13 非帖子区块不应触发评论定位", async () => {
  for (const text of ["Discover more", "Reply composer", "Loading spinner"]) {
    const env = makeEnv();
    env.boot();
    const { replyCell } = await openSimplePost(env, makeStatusId(), { height: 560 });
    replyCell.replaceChildren(env.document.createTextNode(text));
    nativeList(env).appendChild(replyCell);
    await env.timers.advance(8_000);
    assert.equal(env.scroll.y, 0, `${text} is not a reply`);
  }
});

test("C-14 迟到 Article 标题和正文保留原生承载区", async () => {
  for (const testid of ["twitter-article-title", "twitterArticleRichTextView"]) {
    for (const afterScroll of [false, true]) {
      const env = makeEnv();
      env.boot();
      const { cell, replyCell } = await openSimplePost(env, makeStatusId(), { height: 560 });
      if (afterScroll) {
        nativeList(env).appendChild(replyCell);
        await env.timers.advance(400);
        assert.equal(env.scroll.y, 560);
      }
      const article = env.document.createElement("div");
      article.setAttribute("data-testid", testid);
      article.textContent = "Article content";
      cell.querySelector("article").appendChild(article);
      if (!afterScroll) nativeList(env).appendChild(replyCell);
      await env.timers.advance(2_000);
      assert.equal(env.scroll.y, 0, `${testid}, afterScroll=${afterScroll}`);
    }
  }
});


test("C-15 仅跳过已确认的零高空分隔格，定位可读帖子", async () => {
  const env = makeEnv();
  env.boot();
  const { replyCell } = await openSimplePost(env, makeStatusId(), { height: 560 });
  const spacer = env.document.createElement("div");
  spacer.setAttribute("data-testid", "cellInnerDiv");
  nativeList(env).appendChild(spacer);
  nativeList(env).appendChild(replyCell);
  await env.timers.advance(400);
  assert.equal(env.scroll.y, 560);
});

test("C-16 不跨列表、不跨推荐标题、不定位广告或仅有引用身份的帖子", async () => {
  for (const kind of ["other-list", "heading", "non-cell-heading", "unknown-sibling", "ad", "quote-only", "same-id", "unreadable"]) {
    const env = makeEnv();
    env.boot();
    const id = makeStatusId();
    const { replyCell } = await openSimplePost(env, id, { height: 560 });
    const art = replyCell.querySelector("article");
    if (["heading", "non-cell-heading", "unknown-sibling"].includes(kind)) {
      const header = env.document.createElement("div");
      if (kind === "heading") header.setAttribute("data-testid", "cellInnerDiv");
      header.innerHTML = kind === "unknown-sibling" ? "<span>Unknown module</span>" : "<h2>Discover more</h2>";
      nativeList(env).appendChild(header);
    }
    if (kind === "ad") art.setAttribute("data-testid", "placementTracking");
    if (kind === "quote-only") {
      const quote = env.document.createElement("div");
      quote.setAttribute("role", "link");
      quote.appendChild(art.querySelector("a:has(time)"));
      art.appendChild(quote);
    }
    if (kind === "same-id") art.querySelector("a:has(time)").setAttribute("href", `/somebody/status/${id}`);
    if (kind === "unreadable") art.querySelector('[data-testid="tweetText"]').textContent = "";
    (kind === "other-list" ? env.document.body : nativeList(env)).appendChild(replyCell);
    await env.timers.advance(8_000);
    assert.equal(env.scroll.y, 0, kind);
  }
});


test("C-17 URL先变化但详情DOM未水合：旧列表下一帖不能当回复", async () => {
  const env = makeEnv(); env.boot();
  const id = makeStatusId();
  const { cell, replyCell } = tallFocal(id);
  const detail = cell.querySelector('[data-testid="inline_reply_offscreen"]');
  detail.remove();
  nativeList(env).appendChild(cell); nativeList(env).appendChild(replyCell);
  await env.pushNavigate(`/somebody/status/${id}`);
  await env.timers.advance(1_800);
  assert.equal(env.scroll.y, 0, "old timeline must not scroll after URL commit");
  cell.appendChild(detail);
  await env.timers.advance(400);
  assert.equal(env.scroll.y, 560, "confirmed detail can position its reply");
});
