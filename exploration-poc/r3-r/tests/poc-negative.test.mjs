// R3-R negative-semantics tests (E3): every failure path must degrade to an
// honest "unknown"/no-pane state — never a fabricated success, a stale post,
// or an unbounded retry loop. Uses the real production content.js offline.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, makeStatusId, buildCell, buildAuthor, buildTweetText, buildPhoto, buildActionBar } from "./poc-env.mjs";

test("E3 缺失字段：无作者/正文/计数时渲染未知与未识别，绝不编造", async () => {
  const env = makeEnv();
  env.boot();
  const id = makeStatusId();
  // bare article: only the time anchor, no author/text/count nodes
  await env.navigate(`/somebody/status/${id}`);
  mountCellMinimal(env, id);
  await env.timers.advance(1_500);
  const pane = env.pane();
  assert.ok(pane, "pane still mounts on a skeletal article");
  assert.match(pane.textContent, /未知作者/);
  assert.match(pane.textContent, /正文未识别/);
  assert.match(pane.textContent, /未知/);
  assert.ok(!/\b回复 0\b/.test(pane.textContent), "missing counts never render as 0");
});

test("E3 帖子被删除：占位文章不产生编造的计数或正文", async () => {
  const env = makeEnv();
  env.boot();
  const id = makeStatusId();
  await env.navigate(`/somebody/status/${id}`);
  const line = (t) => { const d = env.document.createElement("div"); d.textContent = t; return d; };
  const { cell } = buildCell({
    statusId: id,
    articleChildren: [line("这个帖子不可用。"), line("了解更多")],
  });
  env.document.body.appendChild(cell);
  await env.timers.advance(1_500);
  const pane = env.pane();
  assert.ok(pane, "deleted-post placeholder still renders honestly");
  assert.match(pane.textContent, /这个帖子不可用/);
  assert.match(pane.textContent, /未知/); // all four counts unknown
});

test("E3 目标帖子不在 DOM / 资源超时 / 离线：有界失败后彻底休眠，永不伪造面板", async () => {
  const env = makeEnv();
  env.boot();
  const id = makeStatusId();
  await env.navigate(`/somebody/status/${id}`);
  // nothing ever mounts in the DOM — models offline, deletion, or a dead link
  await env.timers.advance(100_000); // first round (15s) + all recovery rounds (3×(15s+3s))
  assert.equal(env.panes(), 0, "no pane without data");
  const pendingAfterCycles = env.timers.pendingCount;
  await env.timers.advance(120_000); // prove dormancy: no further attempts
  assert.equal(env.panes(), 0);
  assert.equal(env.timers.pendingCount, pendingAfterCycles, "no accumulating retry work");
  // hydration much later (beyond the bounded budget) may mount via the route tick
  // — but only through a fresh navigation, never from the dead recovery loop
  const line = (t) => { const d = env.document.createElement("div"); d.textContent = t; return d; };
  const { cell } = buildCell({ statusId: id, articleChildren: [buildAuthor(), line("很晚才出现")] });
  env.document.body.appendChild(cell);
  await env.timers.advance(30_000);
  assert.equal(env.panes(), 0, "exhausted budget stays dormant even when DOM lands late");
});

test("E3 URL 已改变 / 代际过期：两种守卫分别可辨，过期提取直接丢弃", async () => {
  const env = makeEnv();
  env.boot(); // gen = 0, liveGen = 0
  const idA = makeStatusId();
  // URL guard: the route no longer matches the requested focalId
  await env.navigate(`/other/status/${makeStatusId()}`);
  assert.equal(await env.poc.extractFocal(idA, 0), null, "mismatched focalId extracts nothing");
  // generation guard: the route matches but the caller's generation is stale
  await env.navigate(`/somebody/status/${idA}`);
  const { cell } = buildCell({ statusId: idA, articleChildren: [buildAuthor(), buildTweetText("正文")] });
  env.document.body.appendChild(cell);
  assert.equal(await env.poc.extractFocal(idA, 999), null, "stale generation extracts nothing");
  assert.ok(await env.poc.extractFocal(idA, env.poc.currentGen()), "a live generation extracts normally on the same DOM");
});

test("E3 评论 DOM 被虚拟化回收：等待期间格被移除 → 结果作废、重试有界", async () => {
  const env = makeEnv();
  env.boot();
  const id = makeStatusId();
  await env.navigate(`/somebody/status/${id}`);
  const { cell, art } = buildCell({
    statusId: id,
    articleChildren: [buildAuthor(), buildTweetText("长帖"), buildActionBar()],
  });
  env.document.body.appendChild(cell);
  const more = env.document.createElement("button");
  more.setAttribute("role", "button");
  more.textContent = "显示更多";
  art.appendChild(more);
  await env.timers.advance(700);       // attempt clicks show-more, waits 700ms
  cell.remove();                        // React virtualization recycles the cell mid-wait
  await env.timers.advance(100_000);   // wake → stale cell discarded → bounded retries
  assert.equal(env.panes(), 0, "stale recycled cell never renders");
});

test("E3 半水合媒体：空 src 不渲染为破图", async () => {
  const env = makeEnv();
  env.boot();
  const id = makeStatusId();
  await env.navigate(`/somebody/status/${id}`);
  const { cell } = buildCell({
    statusId: id,
    articleChildren: [buildAuthor(), buildTweetText("图文帖"), buildPhoto("")],
  });
  env.document.body.appendChild(cell);
  await env.timers.advance(1_500);
  const pane = env.pane();
  assert.ok(pane);
  const paneImgs = [...pane.querySelectorAll("img.peek-poc-photo")];
  assert.equal(paneImgs.length, 0, "empty-src photo skipped, not rendered as a broken image");
});

test("E3 评论数量异常：垃圾文本计数显示未知而非 0 或崩溃", async () => {
  const env = makeEnv();
  env.boot();
  const id = makeStatusId();
  await env.navigate(`/somebody/status/${id}`);
  const bar = buildActionBar({ reply: "赞", retweet: "12.3.4", like: "—", bookmark: "2万" });
  const { cell } = buildCell({
    statusId: id,
    articleChildren: [buildAuthor(), buildTweetText("正文"), bar],
  });
  env.document.body.appendChild(cell);
  await env.timers.advance(1_500);
  const pane = env.pane();
  assert.ok(pane, "pane renders");
  assert.match(pane.textContent, /未知/);
  assert.ok(!/回复 0\b/.test(pane.textContent), "garbage counts never coerce to 0");
});

function mountCellMinimal(env, id) {
  const { cell } = buildCell({ statusId: id, articleChildren: [] });
  env.document.body.appendChild(cell);
  return cell;
}
