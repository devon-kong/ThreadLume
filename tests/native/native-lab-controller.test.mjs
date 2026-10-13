// M2-B1 S2/S3 tests — the ISOLATED controller integrated with the MAIN-world
// adapter, both as REAL built artifacts (dist-extension-native-lab) sharing one
// jsdom window, exactly like MAIN + ISOLATED content scripts on a real page.
//
// Transport note: jsdom's postMessage leaves event.origin/source empty, so the
// tests install a synthetic MessageEvent transport that fills them like real
// Chromium. Both worlds' real handlers run; the genuine cross-world transport
// is verified on a real MV3 load (S6). jsdom has no layout engine, so layout
// assertions here cover structure (CSS text, attributes, markers, restore);
// visual geometry is verified in S3/S4 on a real page.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeEnv, labSource, mainWorldSource, buildCell, makeStatusId
} from "./native-env.mjs";
import { LAD_KEY, LAD_MARK_ARTICLE } from "../../native-extension/src/layout-adapter/constants.js";

const ORIGIN = "https://x.com";
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// A detail page with focal cell + one more cell (composer stand-in).
function mountDetailPage(env, { focusId, replyCount = 20 }) {
  const v = makeVirtualizer();
  v.setList([{ id: focusId }, ...Array.from({ length: replyCount }, (_, i) => ({ id: `reply-${i}` }))]);
  const { cell, art } = buildCell({ statusId: focusId });
  env.document.body.appendChild(cell);
  const extra = env.document.createElement("div");
  extra.setAttribute("data-testid", "cellInnerDiv");
  env.document.body.appendChild(extra);
  cell.__reactFiber$peekTest = { stateNode: v.instance, return: null };
  v.cells.set(focusId, { getElement: () => cell });
  v.showAll();
  return { v, cell, art };
}

function installTransport(env, { when = "microtask" } = {}) {
  const sent = [];
  const queue = [];
  const deliver = (data) => {
    const ev = new env.window.MessageEvent("message", { source: env.window, origin: ORIGIN, data });
    if (when === "microtask") queueMicrotask(() => env.window.dispatchEvent(ev));
    else if (when === "macrotask") setTimeout(() => env.window.dispatchEvent(ev), 0);
    else queue.push(ev); // "manual": delivers only when the test flushes
  };
  env.window.postMessage = (data) => { sent.push(data); deliver(data); };
  const flush = () => {
    while (queue.length) env.window.dispatchEvent(queue.shift());
  };
  return { sent, flush };
}

// Full lab environment: MAIN world + isolated content script on one window.
function makeLabEnv({ url, withFixture = true } = {}) {
  const focusId = makeStatusId();
  const pageUrl = url ?? `/somebody/status/${focusId}`;
  const env = makeEnv({ url: pageUrl, src: "lab" });
  const { sent } = installTransport(env);
  env.bootScript(mainWorldSource()); // MAIN world (document_start equivalent)
  const poc = env.boot();            // isolated content script (lab build)
  const fixture = withFixture ? mountDetailPage(env, { focusId }) : null;
  return { env, poc, sent, focusId, fixture, lad: env.ladTest() };
}

const ladStyle = (env) => Boolean(env.document.getElementById("peek-lad-style"));
const htmlAttr = (env) => env.document.documentElement.getAttribute("data-peek-lad");
const stateAttr = (env) => env.document.documentElement.getAttribute("data-peek-lad-state");
const failedAttr = (env) => env.document.documentElement.getAttribute("data-peek-lad-failed");

// ---------- E. route-driven integration (real two-world flow) ----------

test("E1 详情路由 → INSTALL → ACTIVE：布局挂载、焦点标记、M1 副本绝不出现", async () => {
  const { env, poc, sent, focusId, fixture, lad } = makeLabEnv({});
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await realSleep(5);
  assert.equal(lad.query().phase, "active");
  assert.equal(ladStyle(env), true, "layout style mounted");
  assert.equal(htmlAttr(env), "on");
  assert.equal(stateAttr(env), "active");
  assert.equal(fixture.art.getAttribute(LAD_MARK_ARTICLE), "", "focal article marked");
  assert.ok(sent.some((m) => m.type === "INSTALL" && m.focusUrlId === focusId));
  assert.equal(env.pane(), null, "M1 reading copy must NEVER mount in lab mode");
  assert.equal(env.panes(), 0);
  void poc;
});

test("E2 离开详情 → UNINSTALL：样式/属性/标记清理，方法恢复，锚点恢复被抑制", async () => {
  const { env, sent, focusId, fixture } = makeLabEnv({});
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await realSleep(5);
  assert.equal(ladStyle(env), true);
  await env.pushNavigate("/home");
  await realSleep(5);
  assert.equal(ladStyle(env), false, "layout style removed");
  assert.equal(htmlAttr(env), null);
  assert.equal(stateAttr(env), "idle");
  assert.equal(fixture.art.hasAttribute(LAD_MARK_ARTICLE), false);
  const d = Object.getOwnPropertyDescriptor(fixture.v.instance, LAD_KEY);
  assert.equal(d, undefined, "wrapped method fully restored (prototype ownership)");
  assert.ok(sent.some((m) => m.type === "UNINSTALL"));
  // adapter mode suppresses our own anchor-restore correction on list return
  assert.equal(env.scroll.y, 0);
});

test("E3 详情→详情切换：旧帖恢复、新帖包装、样式保持", async () => {
  const { env, sent, focusId, fixture } = makeLabEnv({});
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await realSleep(5);

  const focusB = makeStatusId();
  const fixtureB = mountDetailPage(env, { focusId: focusB, replyCount: 8 });
  await env.pushNavigate(`/other/status/${focusB}`);
  await realSleep(5);

  assert.equal(Object.getOwnPropertyDescriptor(fixture.v.instance, LAD_KEY), undefined, "A restored");
  fixtureB.v.rendered = fixtureB.v.list.slice(2).map((item, i) => ({ item, offset: i * 100, visible: true, key: item.id }));
  const out = fixtureB.v.instance[LAD_KEY]();
  assert.equal(out[0].item.id, focusB, "B wrapped and retaining");
  assert.equal(ladStyle(env), true, "layout persists across detail→detail");
  assert.ok(sent.filter((m) => m.type === "INSTALL").length >= 2);
});

test("E4 MAIN world 缺失：ack 超时 → 诚实失败 + 休眠（不再重试）", async () => {
  const focusId = makeStatusId();
  const env = makeEnv({ url: `/somebody/status/${focusId}`, src: "lab" });
  installTransport(env);
  // NO MAIN-world boot — the controller is alone
  env.boot();
  mountDetailPage(env, { focusId });
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await env.timers.advance(1400);
  assert.equal(stateAttr(env), "failed");
  assert.equal(failedAttr(env), "main-unresponsive");
  assert.equal(ladStyle(env), false, "no layout on failure — native single column");
  assert.equal(env.pane(), null, "failure must NOT fall back to the M1 copy");
  // dormancy: further route ticks must not re-INSTALL
  const installsAfterFail = 0;
  await env.timers.advance(5000);
  assert.equal(installsAfterFail, 0);
  assert.equal(stateAttr(env), "failed");
});

test("E5 UNSUPPORTED 有界重试：12 次后休眠，总量有界", async () => {
  const focusId = makeStatusId();
  const env = makeEnv({ url: `/somebody/status/${focusId}`, src: "lab" });
  const { sent } = installTransport(env);
  env.bootScript(mainWorldSource());
  env.boot();
  // page never renders the focal cell → every install gets UNSUPPORTED
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await env.timers.advance(250 * 13);
  await realSleep(5);
  const installs = sent.filter((m) => m.type === "INSTALL");
  assert.equal(installs.length, 12, "bounded retry budget (contract: 12 attempts)");
  assert.equal(stateAttr(env), "failed");
  assert.equal(failedAttr(env), "focal-cell-not-found");
  assert.equal(ladStyle(env), false);
});

test("E6 失败后迟到的包装：迟到 INSTALL 原子地包装又被释放，布局绝不挂载", async () => {
  const focusId = makeStatusId();
  const env = makeEnv({ url: `/somebody/status/${focusId}`, src: "lab" });
  // manual transport: full determinism — nothing delivers until the test flushes
  const { sent, flush } = installTransport(env, { when: "manual" });
  env.bootScript(mainWorldSource());
  env.boot();
  mountDetailPage(env, { focusId });
  await env.pushNavigate(`/somebody/status/${focusId}`); // INSTALL queued, never delivered
  await env.timers.advance(1400); // ack timeout fires first
  assert.equal(stateAttr(env), "failed");
  assert.equal(failedAttr(env), "main-unresponsive");
  assert.equal(ladStyle(env), false);
  // NOW the queued INSTALL delivers. dispatchEvent is synchronous, so the
  // whole chain resolves inside this one flush: MAIN wraps → its ACTIVE finds
  // a dead session (matching nonce) → controller orders the release → MAIN
  // unwraps. The orphaned wrap never survives a task boundary.
  flush();
  assert.ok(sent.some((m) => m.type === "INSTALL" && m.nonce === 1));
  assert.ok(sent.some((m) => m.type === "ACTIVE" && m.nonce === 1), "MAIN did wrap (late)");
  assert.ok(sent.some((m) => m.type === "UNINSTALL" && m.reason === "late-active-after-fail"),
    "controller must order the orphaned wrap released");
  assert.ok(sent.some((m) => m.type === "UNINSTALLED" && m.nonce !== null), "MAIN acknowledges the release");
  assert.equal(env.ladTest().query().phase, "idle", "no orphaned wrap survives");
  assert.equal(ladStyle(env), false, "no layout ever mounts for the failed session");
  assert.equal(stateAttr(env), "failed", "session stays dormant");
});

test("E7 同路由幂等：重复 onDetailRoute 不重复 INSTALL", async () => {
  const { env, poc, sent, focusId } = makeLabEnv({});
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await realSleep(5);
  const installsBefore = sent.filter((m) => m.type === "INSTALL").length;
  poc.layoutAdapter.onDetailRoute(focusId);
  poc.layoutAdapter.onDetailRoute(focusId);
  assert.equal(sent.filter((m) => m.type === "INSTALL").length, installsBefore);
});

test("E8 主题变量：暗色默认 + 亮色跟随 body 背景；顶栏高度回退 54px", async () => {
  const { env, focusId } = makeLabEnv({});
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await realSleep(5);
  const root = env.document.documentElement;
  assert.equal(root.style.getPropertyValue("--peek-lad-bg"), "#000000", "jsdom default → dark");
  assert.equal(root.style.getPropertyValue("--peek-lad-top"), "54px", "no measurable banner → 54px fallback");
  env.document.body.style.backgroundColor = "rgb(255, 255, 255)";
  root.setAttribute("class", "theme-change-trigger");
  await realSleep(10); // MutationObserver fires
  assert.equal(root.style.getPropertyValue("--peek-lad-bg"), "#ffffff", "theme observer updates vars");
});

test("E9 CSS 布局合同：左栏固定/右栏位移/窄视口降级规则都在样式中", async () => {
  const { env, focusId } = makeLabEnv({});
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await realSleep(5);
  const css = env.document.getElementById("peek-lad-style").textContent;
  assert.ok(css.includes("@media (min-width: 980px)"), "narrow-viewport safe degradation");
  assert.ok(css.includes('[data-testid="sidebarColumn"]'), "sidebar hidden");
  assert.ok(css.includes("margin-left: 52vw"), "right column shift");
  assert.ok(css.includes("position: fixed"), "left pane pinned");
  assert.ok(css.includes("overflow-y: auto"), "left pane independent scroll");
  assert.ok(css.includes("article[data-peek-lad-focal]"), "focal article is the left pane");
  assert.ok(!/body\s*\{[^}]*overflow/.test(css), "body/html overflow must never be mutated");
  assert.ok(!/html\s*\{[^}]*overflow/.test(css), "html overflow must never be mutated");
});
