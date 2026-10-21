// M2-B2-A S1/S2 tests — the instant reading preview, exercised through the
// REAL built artifacts (MAIN + ISOLATED worlds sharing one jsdom window):
//
//   S1-C invariants: exactly one preview overlay at any time, identity always
//   equals the clicked/target status id, handoff removes the overlay in the
//   same task the split mounts, no overlay survives any exit path, the
//   preview never mounts a video element or blocks interaction.
//
//   S2 lifecycle: list click → PREVIEW_READY → NATIVE_WAITING → HANDOFF, plus
//   route mismatch, route leave, route timeout, superseding click, quote-card
//   rejection, detail-page rejection, adapter failure, default-build inertia.
//
// jsdom has no layout engine: geometry assertions are structural (ids, data
// attributes, style text, marker counts); real-viewport behavior is verified
// separately on a live page (S5/S7).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeEnv, labSource, nativeSource, mainWorldSource,
  buildCell, buildAuthor, buildTweetText, buildPhoto, buildActionBar, makeStatusId,
} from "./native-env.mjs";
import { LAD_KEY, LAD_MARK_ARTICLE } from "../../native-extension/src/layout-adapter/constants.js";

const ORIGIN = "https://x.com";
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PREVIEW_ID = "peek-lad-preview";
const PREVIEW_STYLE_ID = "peek-lad-preview-style";

// ---------- fixtures ----------

function makeVirtualizer() {
  const list = [];
  const cells = new Map();
  let rendered = [];
  const proto = { _getFinalRenderedItems() { return rendered.slice(); } };
  const instance = Object.create(proto);
  Object.defineProperty(instance, "props", { value: { list }, writable: true, enumerable: true, configurable: true });
  instance._cells = cells;
  const entryFor = (item, offset = 0) => ({ item, offset, visible: true, key: item.id, height: 100 });
  return {
    instance, list, cells,
    get rendered() { return rendered; },
    set rendered(v) { rendered = v; },
    showAll() { rendered = list.map((item, i) => entryFor(item, i * 100)); },
    setList(items) { list.length = 0; list.push(...items); },
  };
}

function mountDetailPage(env, { focusId, replyCount = 8 }) {
  const v = makeVirtualizer();
  v.setList([{ id: focusId }, ...Array.from({ length: replyCount }, (_, i) => ({ id: `reply-${i}` }))]);
  const { cell, art } = buildCell({ statusId: focusId });
  env.document.body.appendChild(cell);
  cell.__reactFiber$peekTest = { stateNode: v.instance, return: null };
  v.cells.set(focusId, { getElement: () => cell });
  v.showAll();
  return { v, cell, art };
}

// A timeline cell the way the list renders it: own timestamp link, author,
// body text, one photo, action bar.
function mountListCell(env, statusId, { text = "帖子的可见正文内容", extra = [] } = {}) {
  const author = buildAuthor({});
  const avatar = env.document.createElement("img");
  avatar.src = "https://pbs.twimg.com/profile_images/somebody/abc.jpg";
  author.prepend(avatar);
  const { cell, art } = buildCell({
    statusId,
    articleChildren: [author, buildTweetText(text), buildPhoto("https://pbs.twimg.com/media/abc.jpg"), buildActionBar({}), ...extra],
  });
  env.document.body.appendChild(cell);
  const tsLink = [...art.querySelectorAll("a[href] time")]
    .map((t) => t.closest("a"))
    .find((a) => (a.getAttribute("href") || "").includes(`/status/${statusId}`) && !a.closest('div[role="link"]'));
  return { cell, art, tsLink };
}

function installTransport(env) {
  const sent = [];
  env.window.postMessage = (data) => {
    sent.push(data);
    const ev = new env.window.MessageEvent("message", { source: env.window, origin: ORIGIN, data });
    queueMicrotask(() => env.window.dispatchEvent(ev));
  };
  return sent;
}

function makeLabEnv({ url = "/home", withMain = true } = {}) {
  const env = makeEnv({ url, src: "lab" });
  const sent = installTransport(env);
  if (withMain) env.bootScript(mainWorldSource());
  const poc = env.boot();
  return { env, poc, sent };
}

// A real pointer click on a given element (capture-phase listeners observe it;
// jsdom performs no actual navigation on synthetic clicks).
const clickEl = (env, el) =>
  el.dispatchEvent(new env.window.MouseEvent("click", { bubbles: true, cancelable: true }));

// X's route commit WITHOUT another click: the URL changes after the user's
// click (pushState lands in X's click task); the click cascade timers then
// observe it. The list cells are removed like X does when the detail view
// replaces the timeline, and the detail fixture (if any) mounts in their
// place BEFORE the timers run — the same task order as X's own commit.
async function commitNavigation(env, pathname, { detail = null, keepList = false } = {}) {
  if (!keepList) {
    for (const c of [...env.document.querySelectorAll('[data-testid="cellInnerDiv"]')]) c.remove();
  }
  env.location.pathname = pathname;
  env.location.href = "https://x.com" + pathname;
  if (detail) mountDetailPage(env, detail);
  await env.timers.advance(600); // runs the 0/60/150/350ms click cascade → checkRoute
  await realSleep(5);
}

const overlay = (env) => env.document.getElementById(PREVIEW_ID);
const overlayCount = (env) => env.document.querySelectorAll(`#${PREVIEW_ID}`).length;
const previewStyle = (env) => env.document.getElementById(PREVIEW_STYLE_ID);
const snap = (poc) => poc.preview.snapshot();
const ladStyle = (env) => Boolean(env.document.getElementById("peek-lad-style"));
const stateAttr = (env) => env.document.documentElement.getAttribute("data-peek-lad-state");
const markedArticles = (env) => env.document.querySelectorAll(`article[${LAD_MARK_ARTICLE}]`).length;

// ---------- P. preview lifecycle ----------

test("P1 列表点击 → PREVIEW_READY：身份准确、内容为已可见 DOM、非互动层", async () => {
  const { env, poc } = makeLabEnv({});
  const focusId = makeStatusId();
  const { tsLink } = mountListCell(env, focusId);

  clickEl(env, tsLink);

  const s = snap(poc);
  assert.equal(s.active, true, "preview mounted");
  assert.equal(s.phase, "ready");
  assert.equal(s.statusId, focusId, "identity = clicked post");
  assert.equal(overlayCount(env), 1, "exactly one overlay");
  assert.equal(overlay(env).dataset.statusId, focusId);
  assert.equal(overlay(env).getAttribute("aria-hidden"), "true", "screen readers must not re-read it");
  assert.equal(overlay(env).getAttribute("role"), "presentation");
  assert.ok(previewStyle(env), "preview style mounted");
  assert.ok(previewStyle(env).textContent.includes("pointer-events: none"), "must never intercept input");
  assert.ok(overlay(env).textContent.includes("帖子的可见正文内容"), "visible body text captured");
  assert.ok(overlay(env).querySelector(".ppl-photo"), "already-displayed photo URL shown");
  assert.equal(overlay(env).querySelectorAll("button, a, input, textarea").length, 0, "non-interactive by construction");
  assert.equal(env.pane(), null, "M1 reading copy must never appear in lab mode");
});

test("P2 路由确认 → NATIVE_WAITING：预览保留、等待适配器、无布局挂载", async () => {
  const { env, poc } = makeLabEnv({});
  const focusId = makeStatusId();
  const { tsLink } = mountListCell(env, focusId);
  clickEl(env, tsLink);
  assert.equal(snap(poc).phase, "ready");

  await commitNavigation(env, `/somebody/status/${focusId}`);

  const s = snap(poc);
  assert.equal(s.active, true, "preview survives the route commit");
  assert.equal(s.phase, "waiting", "route confirmed → waiting for the adapter");
  assert.equal(s.statusId, focusId, "identity unchanged");
  assert.equal(s.timerArmed, false, "route timeout disarmed once confirmed");
  assert.equal(overlayCount(env), 1);
  assert.equal(ladStyle(env), false, "split CSS not mounted before a verified ACTIVE");
  assert.equal(stateAttr(env), "installing");
});

test("P3 适配器 ACTIVE → HANDOFF：预览同一拍移除、分栏挂载、焦点标记唯一", async () => {
  const { env, poc, sent } = makeLabEnv({});
  const focusId = makeStatusId();
  const { tsLink } = mountListCell(env, focusId);
  clickEl(env, tsLink);

  await commitNavigation(env, `/somebody/status/${focusId}`, { detail: { focusId } });

  assert.ok(sent.some((m) => m.type === "ACTIVE" && m.focusUrlId === focusId), "adapter went active");
  assert.equal(snap(poc).active, false, "preview released at handoff");
  assert.equal(overlayCount(env), 0, "no overlay survives the takeover");
  assert.equal(previewStyle(env), null, "preview style removed");
  assert.equal(ladStyle(env), true, "split layout live");
  assert.equal(stateAttr(env), "active");
  assert.equal(markedArticles(env), 1, "exactly one native focal article");
  assert.equal(env.document.querySelector(`article[${LAD_MARK_ARTICLE}]`).querySelector("a[href] time")?.closest("a")?.getAttribute("href").includes(`/status/${focusId}`), true, "marker on the URL's article");
  assert.equal(env.pane(), null);
});

test("P4 焦点不匹配 → 立即清除（预览 A、路由去 B）", async () => {
  const { env, poc } = makeLabEnv({});
  const idA = makeStatusId();
  const idB = makeStatusId();
  const { tsLink } = mountListCell(env, idA);
  clickEl(env, tsLink);

  await commitNavigation(env, `/other/status/${idB}`, { detail: { focusId: idB } });

  assert.equal(snap(poc).active, false, "mismatched preview must not linger");
  assert.equal(overlayCount(env), 0);
});

test("P5 等待中离开详情 → 清除（返回列表无残留）", async () => {
  const { env, poc } = makeLabEnv({});
  const focusId = makeStatusId();
  const { tsLink } = mountListCell(env, focusId);
  clickEl(env, tsLink);
  // no detail fixture: the adapter keeps retrying while the preview waits
  await commitNavigation(env, `/somebody/status/${focusId}`);
  assert.equal(snap(poc).phase, "waiting");

  // leave the detail without ever mounting the adapter — via a real TRAVERSE
  // (browser back), which also covers the S2 back/forward scenario
  await env.navigate("/home");

  assert.equal(snap(poc).active, false);
  assert.equal(overlayCount(env), 0);
  assert.equal(previewStyle(env), null);
});

test("P6 无导航超时 → 清除且不复活", async () => {
  const { env, poc } = makeLabEnv({});
  const focusId = makeStatusId();
  const { tsLink } = mountListCell(env, focusId);
  clickEl(env, tsLink);
  assert.equal(snap(poc).active, true);

  await env.timers.advance(1300); // > PREVIEW_ROUTE_TIMEOUT_MS, still on the list
  assert.equal(snap(poc).active, false, "no navigation coming → preview cleared");
  assert.equal(overlayCount(env), 0);
  assert.equal(previewStyle(env), null);

  await env.timers.advance(3000); // route ticks keep firing; nothing may re-mount
  assert.equal(snap(poc).active, false);
  assert.equal(overlayCount(env), 0);
});

test("P7 连续点击 A→B：同一时刻只有一份预览，身份跟随最后点击", async () => {
  const { env, poc } = makeLabEnv({});
  const idA = makeStatusId();
  const idB = makeStatusId();
  const a = mountListCell(env, idA, { text: "A 的正文" });
  const b = mountListCell(env, idB, { text: "B 的正文" });

  clickEl(env, a.tsLink);
  assert.equal(snap(poc).statusId, idA);
  const genA = snap(poc).gen;

  clickEl(env, b.tsLink);
  const s = snap(poc);
  assert.equal(s.active, true);
  assert.equal(s.statusId, idB, "superseding click rebinds identity");
  assert.equal(s.gen, genA + 1, "generation bumped — A's async paths are dead");
  assert.equal(overlayCount(env), 1, "never two previews");
  assert.ok(overlay(env).textContent.includes("B 的正文"));
  assert.equal(overlay(env).dataset.statusId, idB);
});

test("P8 引用卡内时间戳链接 → 不预览（fail open）", async () => {
  const { env, poc } = makeLabEnv({});
  const focusId = makeStatusId();
  const quotedId = makeStatusId();
  const quoteCard = env.document.createElement("div");
  quoteCard.setAttribute("role", "link");
  const qa = env.document.createElement("a");
  qa.setAttribute("href", `/quoted/status/${quotedId}`);
  const qt = env.document.createElement("time");
  qa.appendChild(qt);
  quoteCard.appendChild(qa);
  const { tsLink } = mountListCell(env, focusId, { extra: [quoteCard] });

  clickEl(env, qa); // the quote's own link: the cell is NOT the quoted post
  assert.equal(snap(poc).active, false, "no preview for a quote-card navigation");
  assert.equal(overlayCount(env), 0);

  clickEl(env, tsLink); // the cell's own link still previews normally
  assert.equal(snap(poc).statusId, focusId);
});

test("P9 详情页点击绝不预览（原生阅读器拥有详情页）", async () => {
  const { env, poc } = makeLabEnv({});
  const focusId = makeStatusId();
  const replyId = makeStatusId();
  const { tsLink } = mountListCell(env, focusId);
  clickEl(env, tsLink);

  await commitNavigation(env, `/somebody/status/${focusId}`, { detail: { focusId, replyCount: 4 } });
  assert.equal(snap(poc).active, false, "handoff already released the preview");
  assert.equal(stateAttr(env), "active");

  // a reply cell with its own status link, like the conversation renders
  const reply = mountListCell(env, replyId, { text: "回复内容" });
  clickEl(env, reply.tsLink); // detail → detail navigation

  assert.equal(snap(poc).active, false, "no preview on detail pages");
  assert.equal(overlayCount(env), 0);
  assert.equal(markedArticles(env), 1, "native focal article untouched");
  void tsLink;
});

test("P9b 等待中的预览被无关点击清除（不遮挡用户后续操作）", async () => {
  const { env, poc } = makeLabEnv({});
  const focusId = makeStatusId();
  const { tsLink } = mountListCell(env, focusId);
  clickEl(env, tsLink);
  await commitNavigation(env, `/somebody/status/${focusId}`); // installing, no fixture
  assert.equal(snap(poc).phase, "waiting");

  clickEl(env, env.document.body); // not a status link — nothing navigational
  assert.equal(snap(poc).active, false, "unrelated click → preview stands down");
  assert.equal(overlayCount(env), 0);
});

test("P10 MAIN 缺失 → ack 超时失败：预览与分栏一起退出，回退原生单栏", async () => {
  const { env, poc } = makeLabEnv({ withMain: false }); // controller alone
  const focusId = makeStatusId();
  const { tsLink } = mountListCell(env, focusId);
  clickEl(env, tsLink);
  await commitNavigation(env, `/somebody/status/${focusId}`);
  assert.equal(snap(poc).phase, "waiting");

  await env.timers.advance(1400); // LAD_INSTALL_ACK_MS elapsed

  assert.equal(stateAttr(env), "failed");
  assert.equal(snap(poc).active, false, "adapter stopped → preview must exit");
  assert.equal(overlayCount(env), 0);
  assert.equal(ladStyle(env), false, "native single column, no split, no pane");
  assert.equal(env.pane(), null, "never fall back to the M1 copy");
});

test("P11 视频帖预览：静态海报 + 明确标注，绝不复制 video 节点", async () => {
  const { env, poc } = makeLabEnv({});
  const focusId = makeStatusId();
  const vp = env.document.createElement("div");
  vp.setAttribute("data-testid", "videoPlayer");
  const video = env.document.createElement("video");
  video.setAttribute("poster", "https://pbs.twimg.com/ext_tw_video_thumb/xyz/img/sea.jpg");
  vp.appendChild(video);
  const { tsLink } = mountListCell(env, focusId, { extra: [vp], text: "" });

  clickEl(env, tsLink);

  assert.equal(snap(poc).active, true);
  const ov = overlay(env);
  const poster = ov.querySelector(".ppl-poster");
  assert.ok(poster, "poster frame shown");
  assert.equal(poster.getAttribute("src"), "https://pbs.twimg.com/ext_tw_video_thumb/xyz/img/sea.jpg");
  assert.ok(ov.querySelector(".ppl-video-note"), "labeled as a static preview");
  assert.ok(ov.textContent.includes("playback starts in the native player"), "never presented as playable");
  assert.equal(ov.querySelector("video"), null, "video element never cloned");
  assert.equal(env.document.querySelectorAll("video").length, 1, "X's own player untouched");
});

test("P12 统一默认构建就是预览构建（单一产物规则）", async () => {
  // S3 unification: src:"default" and src:"lab" boot the SAME preview-capable
  // artifact. The retired M1 contract "default build never previews" inverted.
  const env = makeEnv({ url: "/home", src: "default" });
  env.boot(); // nativeSource — the unified build
  const focusId = makeStatusId();
  const { tsLink } = mountListCell(env, focusId);

  clickEl(env, tsLink);

  assert.ok(env.document.getElementById(PREVIEW_ID), "the default build mounts the preview");
  assert.equal(env.poc.preview.snapshot().active, true);
});

test("P13 适配器停止钩子清理 READY 预览（dormant/失败同规则）", async () => {
  const { env, poc } = makeLabEnv({});
  const focusId = makeStatusId();
  const { tsLink } = mountListCell(env, focusId);
  clickEl(env, tsLink);
  assert.equal(snap(poc).active, true);

  poc.preview.stopped("test-dormant");
  assert.equal(snap(poc).active, false);
  assert.equal(overlayCount(env), 0);
  assert.equal(previewStyle(env), null);

  // handoff for a mismatched focus also refuses to keep a wrong overlay
  clickEl(env, tsLink);
  assert.equal(snap(poc).active, true);
  poc.preview.handoff("999999999999999999");
  assert.equal(snap(poc).active, false, "handoff identity mismatch → clear");
  assert.equal(overlayCount(env), 0);
});

test("P14 交接后虚拟列表分页行为不变（焦点项保留 + 回复照常）", async () => {
  const { env, poc } = makeLabEnv({});
  const focusId = makeStatusId();
  const { tsLink } = mountListCell(env, focusId);
  clickEl(env, tsLink);
  await commitNavigation(env, `/somebody/status/${focusId}`, { detail: { focusId, replyCount: 12 } });

  assert.equal(stateAttr(env), "active");
  const wrapped = [...env.document.querySelectorAll("article[data-testid='tweet']")]
    .find((a) => a.closest('[data-testid="cellInnerDiv"]')?.__reactFiber$peekTest);
  void wrapped;
  const fixture = env.document.querySelector('[data-testid="cellInnerDiv"]').__reactFiber$peekTest.stateNode;
  const out = fixture[LAD_KEY]();
  assert.equal(out[0].item.id, focusId, "focal item retained by the wrap");
  assert.equal(out.length, 13, "all reply entries still rendered");
  assert.equal(markedArticles(env), 1);
  void poc;
});

test("P15 预览显示期间 X 原生内容零改动（无标记、无分栏、无 M1 副本）", async () => {
  const { env, poc } = makeLabEnv({});
  const focusId = makeStatusId();
  const { cell, tsLink } = mountListCell(env, focusId);
  clickEl(env, tsLink);

  assert.equal(snap(poc).active, true);
  assert.equal(ladStyle(env), false);
  assert.equal(env.pane(), null);
  assert.equal(markedArticles(env), 0, "no marker before the adapter owns the cell");
  assert.ok(cell.querySelector("video") === null);
  assert.equal(cell.getAttribute("style"), null, "no style writes on X's node");
  void tsLink;
});
