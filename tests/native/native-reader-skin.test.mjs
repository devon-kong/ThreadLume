// M2-B2-B S2 tests — the reader skin (visual layer): chrome mount/teardown,
// brand-free top bar, X app-bar tagging, safe-back / native-view release paths,
// theme palette vars, and preview↔skin geometry-source equality.
//
// Both worlds run as REAL built artifacts (dist-extension-native-lab) sharing
// one jsdom window, exactly like MAIN + ISOLATED content scripts on a page.
// jsdom has no layout engine: structural facts (nodes, attributes, CSS text,
// restore) are asserted here; pixel geometry is verified live in S3.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, labSource, mainWorldSource, buildCell, makeStatusId } from "./native-env.mjs";
import { LAD_MARK_ARTICLE } from "../../native-extension/src/layout-adapter/constants.js";
import { skinGeometry } from "../../native-extension/src/layout-adapter/reader-skin.js";

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

// Detail page fixture carrying X's own app bar (the skin must tag+hide it) and
// one conversation cell.
function mountDetailPage(env, { focusId }) {
  const v = makeVirtualizer();
  v.setList([{ id: focusId }, { id: "reply-0" }]);
  const col = env.document.createElement("div");
  col.setAttribute("data-testid", "primaryColumn");
  const wrapper = env.document.createElement("div");
  const appbar = env.document.createElement("div");
  appbar.setAttribute("style", "position: sticky");
  const inner = env.document.createElement("div");
  const backBtn = env.document.createElement("button");
  backBtn.setAttribute("data-testid", "app-bar-back");
  backBtn.setAttribute("aria-label", "返回");
  inner.appendChild(backBtn);
  appbar.appendChild(inner);
  wrapper.appendChild(appbar);
  col.appendChild(wrapper);
  env.document.body.appendChild(col);

  const { cell, art } = buildCell({ statusId: focusId });
  env.document.body.appendChild(cell);
  const extra = env.document.createElement("div");
  extra.setAttribute("data-testid", "cellInnerDiv");
  env.document.body.appendChild(extra);
  cell.__reactFiber$peekTest = { stateNode: v.instance, return: null };
  v.cells.set(focusId, { getElement: () => cell });
  v.showAll();
  return { v, cell, art, appbar };
}

function installTransport(env) {
  const sent = [];
  env.window.postMessage = (data) => {
    sent.push(data);
    const ev = new env.window.MessageEvent("message", { source: env.window, origin: ORIGIN, data });
    queueMicrotask(() => env.window.dispatchEvent(ev));
  };
  return { sent };
}

function makeSkinEnv({ url } = {}) {
  const focusId = makeStatusId();
  const pageUrl = url ?? `/somebody/status/${focusId}`;
  const env = makeEnv({ url: pageUrl, src: "lab" });
  const { sent } = installTransport(env);
  env.bootScript(mainWorldSource());
  const poc = env.boot();
  const fixture = mountDetailPage(env, { focusId });
  return { env, poc, sent, focusId, fixture };
}

const topbar = (env) => env.document.getElementById("peek-reader-topbar");
const backdrop = (env) => env.document.getElementById("peek-reader-backdrop");
const skinStyle = (env) => env.document.getElementById("peek-reader-skin");
const stateAttr = (env) => env.document.documentElement.getAttribute("data-peek-lad-state");
const styleText = (env, id) => env.document.getElementById(id)?.textContent || "";

// ---------- mount / teardown ----------

test("K1 ACTIVE：皮肤样式、顶栏与背景幕挂载；顶栏无品牌图形、标题为 Peek、几何变量就位", async () => {
  const { env, focusId } = makeSkinEnv({});
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await realSleep(5);
  assert.equal(stateAttr(env), "active");
  assert.ok(skinStyle(env), "skin style mounted");
  const bar = topbar(env);
  assert.ok(bar, "top bar mounted");
  assert.ok(backdrop(env), "backdrop mounted");
  assert.equal(bar.querySelectorAll("img, image").length, 0, "NO brand imagery in the reader chrome (rabbit-logo ban)");
  assert.ok(bar.textContent.includes("Peek"), "compact Peek wordmark only");
  assert.ok(bar.querySelector('[aria-label="返回"]'), "safe back control");
  assert.ok(bar.querySelector(".pk-tb-native"), "native-view release control");
  const css = styleText(env, "peek-reader-skin");
  assert.ok(css.includes("--peek-reader-top: 52px"), "top bar height var");
  assert.ok(css.includes("--peek-reader-inset: 16px"), "floating inset var");
  assert.ok(css.includes("border-radius: var(--peek-reader-radius)"), "rounded focal card");
  assert.ok(css.includes("box-shadow: var(--peek-lad-shadow"), "card shadow");
  assert.ok(css.includes("@media (max-width: 979.98px)"), "chrome is media-inert below the split breakpoint");
});

test("K2 主题调色板变量在挂载时写入并随主题切换更新", async () => {
  const { env, focusId, poc } = makeSkinEnv({});
  env.document.body.style.backgroundColor = "rgb(255, 255, 255)"; // jsdom default body is transparent → dark fallback
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await realSleep(5);
  const d0 = poc.layoutAdapter.themeDiagnostics();
  for (const v of ["--peek-lad-fg", "--peek-lad-dim", "--peek-lad-hover", "--peek-lad-backdrop", "--peek-lad-shadow"]) {
    assert.ok(d0.inlineVars[v], `${v} written at mount`);
  }
  assert.equal(d0.inlineVars["--peek-lad-bg"], "#ffffff", "light card");
  env.document.body.style.backgroundColor = "rgb(0, 0, 0)";
  await realSleep(10);
  const d1 = poc.layoutAdapter.themeDiagnostics();
  assert.equal(d1.inlineVars["--peek-lad-bg"], "#000000", "dark card after theme flip");
  assert.ok(d1.inlineVars["--peek-lad-backdrop"].includes("231"), "dark backdrop value follows the theme");
});

test("K3 X 自带详情应用栏被标记隐藏；离开路由后标记移除", async () => {
  const { env, fixture, focusId } = makeSkinEnv({});
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await realSleep(5);
  assert.equal(fixture.appbar.getAttribute("data-peek-reader-appbar"), "", "app bar tagged");
  assert.ok(styleText(env, "peek-reader-skin").includes('[data-peek-reader-appbar]'), "hiding rule present");
  await env.pushNavigate("/home");
  await realSleep(5);
  assert.equal(fixture.appbar.hasAttribute("data-peek-reader-appbar"), false, "tag removed with the skin");
});

test("K4 路由离开：皮肤样式与全部自有节点清理，焦点标记解除", async () => {
  const { env, fixture, focusId } = makeSkinEnv({});
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await realSleep(5);
  assert.ok(topbar(env) && backdrop(env));
  await env.pushNavigate("/home");
  await realSleep(5);
  assert.equal(env.document.getElementById("peek-reader-topbar"), null, "top bar removed");
  assert.equal(env.document.getElementById("peek-reader-backdrop"), null, "backdrop removed");
  assert.equal(skinStyle(env), null, "skin style removed");
  assert.equal(fixture.art.hasAttribute(LAD_MARK_ARTICLE), false, "focal marker released");
  assert.equal(stateAttr(env), "idle");
});

// ---------- close semantics ----------

test("K5 直接进入（无安全历史）：顶栏返回不得调用 history.back，原地释放为 X 原生单栏", async () => {
  const { env, focusId } = makeSkinEnv({}); // direct entry: trail has only the initial entry
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await realSleep(5);
  assert.equal(stateAttr(env), "active");
  topbar(env).querySelector('[aria-label="返回"]').click();
  await realSleep(10);
  assert.equal(env.history._backCalls, 0, "history.back() must NOT be gambled on an unknown predecessor");
  assert.equal(stateAttr(env), "idle", "session released in place");
  assert.equal(env.document.getElementById("peek-lad-style"), null, "split CSS removed");
  assert.equal(topbar(env), null, "chrome removed");
});

test("K6 从列表进入（存在同站历史）：顶栏返回走 history.back 安全导航", async () => {
  const { env, focusId } = makeSkinEnv({ url: "/home" });
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await realSleep(5);
  assert.equal(stateAttr(env), "active");
  topbar(env).querySelector('[aria-label="返回"]').click();
  await realSleep(10);
  assert.equal(env.history._backCalls, 1, "same-site predecessor → real back navigation");
});

test("K7 「原生视图」释放：会话释放、split 与皮肤下线；UNINSTALL 命名焦点", async () => {
  const { env, sent, focusId } = makeSkinEnv({});
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await realSleep(5);
  const before = sent.length;
  topbar(env).querySelector(".pk-tb-native").click();
  await realSleep(10);
  assert.equal(stateAttr(env), "idle");
  assert.equal(env.document.getElementById("peek-lad-style"), null, "split released");
  assert.equal(topbar(env), null, "chrome released");
  const uninstall = sent.slice(before).find((m) => m.type === "UNINSTALL");
  assert.ok(uninstall, "UNINSTALL sent");
  assert.equal(uninstall.focusUrlId, focusId, "release names its session focus");
});

test("K8 原生视图释放后同一路由不自动重装（无循环复位）", async () => {
  const { env, poc, focusId } = makeSkinEnv({});
  const lad = env.ladTest();
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await realSleep(5);
  topbar(env).querySelector(".pk-tb-native").click();
  await realSleep(10);
  assert.equal(lad.query().phase, "idle");
  for (let i = 0; i < 10; i++) await env.timers.advance(600); // several route polls
  assert.equal(lad.query().phase, "idle", "released session stays released until the next navigation");
  assert.equal(env.document.getElementById("peek-lad-style"), null);
  void poc;
});

// ---------- geometry source ----------

test("K9 皮肤 CSS 的几何变量与 skinGeometry() 单一来源一致（预览像素一致性由 S3 实测 dx=dy=dw=0 证明）", async () => {
  const g = skinGeometry();
  const { env, focusId } = makeSkinEnv({});
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await realSleep(5);
  const skin = styleText(env, "peek-reader-skin");
  assert.ok(skin.includes(`--peek-reader-top: ${g.topbarH}px`));
  assert.ok(skin.includes(`--peek-reader-inset: ${g.inset}px`));
  assert.ok(skin.includes(`--peek-reader-gap: ${g.gap}px`));
  assert.ok(skin.includes(`--peek-reader-radius: ${g.radius}px`));
  assert.ok(skin.includes(`width: calc(52vw - var(--peek-reader-inset) - var(--peek-reader-gap))`), "focal card width = geometry");
  // the handoff target: focal top = topbar + inset, expressed through the vars
  assert.ok(skin.includes(`top: calc(var(--peek-reader-top) + var(--peek-reader-inset))`));
});
