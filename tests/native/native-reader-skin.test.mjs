// M2-B2-B S2 tests — the reader skin (visual layer): chrome mount/teardown,
// brand-free top bar, X app-bar tagging, safe-back / native-view release paths,
// theme palette vars, and preview↔skin geometry-source equality.
//
// Both worlds run as REAL built artifacts (dist-extension-native) sharing
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
    if (env.holdNativeRelease && data.from === "isolated" && data.type === "UNINSTALL") {
      (env.pendingNativeReleaseCommands ||= []).push(() => env.window.dispatchEvent(ev));
    } else if (env.holdNativeReleaseAck && data.from === "main" && data.type === "UNINSTALLED" && data.reason === "native-view") {
      (env.pendingNativeReleaseAcks ||= []).push(() => env.window.dispatchEvent(ev));
    } else queueMicrotask(() => env.window.dispatchEvent(ev));
  };
  return { sent };
}

function makeSkinEnv({ url } = {}) {
  const focusId = makeStatusId();
  const pageUrl = url ?? `/somebody/status/${focusId}`;
  const env = makeEnv({ url: pageUrl, src: "lab" });
  // jsdom defaults to a hidden document; these chrome tests model a visible tab.
  Object.defineProperty(env.document, "hidden", { value: false, configurable: true });
  // Test-only trusted-event fixtures call the REAL registered document input
  // callbacks. dispatchEvent remains untrusted; no browser-user claim is made.
  const inputTypes = new Set(["pointerdown", "wheel", "touchstart", "touchmove", "keydown"]);
  const inputs = new Map(), add = env.document.addEventListener.bind(env.document), remove = env.document.removeEventListener.bind(env.document);
  env.document.addEventListener = (type, fn, opts) => {
    if (inputTypes.has(type)) { if (!inputs.has(type)) inputs.set(type, new Set()); inputs.get(type).add(fn); }
    add(type, fn, opts);
  };
  env.document.removeEventListener = (type, fn, opts) => { inputs.get(type)?.delete(fn); remove(type, fn, opts); };
  env.readerInputFixture = (type, target, rest = {}) => { for (const fn of [...(inputs.get(type) || [])]) fn({ type, target, isTrusted: true, ...rest }); };
  env.readerInputCount = () => [...inputs.values()].reduce((n, set) => n + set.size, 0);
  const { sent } = installTransport(env);
  env.bootScript(mainWorldSource());
  const poc = env.boot();
  const fixture = mountDetailPage(env, { focusId });
  return { env, poc, sent, focusId, fixture };
}

const topbar = (env) => env.document.getElementById("peek-reader-topbar");
const skinStyle = (env) => env.document.getElementById("peek-reader-skin");
const stateAttr = (env) => env.document.documentElement.getAttribute("data-peek-lad-state");
const styleText = (env, id) => env.document.getElementById(id)?.textContent || "";

// ---------- mount / teardown ----------

test("K1 ACTIVE：皮肤样式、顶栏与画布暗化挂载；顶栏无品牌图形、标题为 Peek、几何变量就位", async () => {
  const { env, focusId } = makeSkinEnv({});
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await realSleep(5);
  assert.equal(stateAttr(env), "active");
  assert.ok(skinStyle(env), "skin style mounted");
  const bar = topbar(env);
  assert.ok(bar, "top bar mounted");
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
  // the surround is the PAGE CANVAS (no overlay node — an overlay would dim the
  // card/sheet too; measured live)
  assert.ok(css.includes('html[data-peek-lad="on"] body,'), "page canvas dim rule present");
  assert.ok(css.includes('[data-testid="primaryColumn"] {') && css.includes("background-color: var(--peek-lad-page"), "canvas colour on html/body and X's primary column");
  assert.equal(env.document.getElementById("peek-reader-backdrop"), null, "no overlay node: the dim is the canvas");
  assert.ok(css.includes(':has([data-testid="swipe-to-dismiss"])'), "top bar yields while X's image lightbox is open");
  assert.ok(css.includes("z-index: 1;"), "top bar above the sheet contexts (z 1)");
});

test("K2 主题调色板变量在挂载时写入并随主题切换更新", async () => {
  const { env, focusId, poc } = makeSkinEnv({});
  env.document.body.style.backgroundColor = "rgb(255, 255, 255)"; // jsdom default body is transparent → dark fallback
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await realSleep(5);
  const d0 = poc.layoutAdapter.themeDiagnostics();
  for (const v of ["--peek-lad-fg", "--peek-lad-dim", "--peek-lad-hover", "--peek-lad-page", "--peek-lad-shadow"]) {
    assert.ok(d0.inlineVars[v], `${v} written at mount`);
  }
  assert.equal(d0.inlineVars["--peek-lad-bg"], "#ffffff", "light card");
  env.document.body.style.backgroundColor = "rgb(0, 0, 0)";
  await realSleep(10);
  const d1 = poc.layoutAdapter.themeDiagnostics();
  assert.equal(d1.inlineVars["--peek-lad-bg"], "#000000", "dark card after theme flip");
  assert.equal(d1.inlineVars["--peek-lad-page"], "#0b0e11", "dark canvas value follows the theme");
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
  assert.ok(topbar(env));
  await env.pushNavigate("/home");
  await realSleep(5);
  assert.equal(env.document.getElementById("peek-reader-topbar"), null, "top bar removed");
  assert.equal(env.document.getElementById("peek-reader-skin"), null, "skin style removed (canvas rule released with it)");
  assert.equal(env.document.getElementById("peek-reader-backdrop"), null, "no overlay node ever existed");
  assert.equal(fixture.art.hasAttribute(LAD_MARK_ARTICLE), false, "focal marker released");
  assert.equal(stateAttr(env), "idle");
});

// ---------- close semantics ----------

test("K5a 原生视图释放：布局稳定后只纠正一次，用户滚动与导航优先", async () => {
  for (const interruption of [null, "wheel", "route"]) {
    const { env, focusId } = makeSkinEnv({});
    await env.pushNavigate(`/somebody/status/${focusId}`);
    await realSleep(5);
    env.scroll.y = 270;
    const writes = [];
    env.window.scrollTo = (x, y) => { env.scroll.y = typeof x === "object" ? x.top : y; writes.push(env.scroll.y); };
    topbar(env).querySelector(".pk-tb-native").click();
    // Native virtual-list remeasurement happens after the style release.
    // jsdom has no layout engine: model only this externally observed drift.
    env.scroll.y = 4708;
    if (interruption === "wheel") env.window.dispatchEvent(new env.window.Event("wheel"));
    if (interruption === "route") await env.navigate("/home");
    await env.timers.advance(32);
    assert.equal(writes.length, 0, "observe teardown before correcting");
    await env.timers.advance(700);
    assert.equal(env.scroll.y, interruption ? 4708 : 270);
    assert.equal(writes.length, interruption ? 0 : 1);
    env.scroll.y = 300; // Later native/user movement must never be fought.
    await env.timers.advance(1000);
    assert.equal(env.scroll.y, 300);
    env.window.close();
  }
});

test("K5b 原生视图：同一评论位置优先于旧scrollY，实际bundle仅修正一次", async () => {
  const { env, focusId } = makeSkinEnv({});
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await realSleep(5);
  const { cell, art } = buildCell({ statusId: "2053230853795266618" });
  const column = env.document.querySelector('[data-testid="primaryColumn"]');
  column.appendChild(cell);
  column.getBoundingClientRect = () => ({ left: 0, right: 1451, top: -env.scroll.y, bottom: 20000 - env.scroll.y, width: 1451, height: 20000 });
  let docTop = 3405.71875;
  art.getBoundingClientRect = () => ({ left: 762.5, right: 1435, top: docTop - env.scroll.y, bottom: docTop - env.scroll.y + 300, width: 672.5, height: 300 });
  env.document.elementFromPoint = (x, y) => {
    const box = art.getBoundingClientRect();
    return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom ? art : null;
  };
  env.scroll.y = 3401;
  env.readerInputFixture("pointerdown", art);
  const writes = [];
  env.window.scrollTo = ({ top }) => { env.scroll.y = top; writes.push(top); };
  topbar(env).querySelector(".pk-tb-native").click();
  await env.timers.advance(60);
  env.scroll.y = 3375; docTop = 3025;
  await env.timers.advance(83);
  env.scroll.y = 4448.5; docTop = 4098.5;
  await env.timers.advance(1100);
  assert.equal(art.getBoundingClientRect().top, 4.71875);
  assert.deepEqual(writes, [4093.78125]);
  env.window.close();
});

for (const interrupt of ["offRoute", "reopen-and-close-before-frame"]) test(`K5c ${interrupt}：旧退出恢复不跨越新生命周期`, async () => {
  const { env, focusId, poc } = makeSkinEnv({});
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await realSleep(5);
  env.scroll.y = 680;
  const writes = [];
  env.window.scrollTo = ({ top }) => { env.scroll.y = top; writes.push(top); };
  topbar(env).querySelector(".pk-tb-native").click();
  if (interrupt === "reopen-and-close-before-frame") poc.layoutAdapter.onDetailRoute(focusId);
  poc.layoutAdapter.offRoute();
  env.scroll.y = 900;
  await env.timers.advance(1200);
  assert.equal(env.scroll.y, 900);
  assert.equal(writes.length, 0);
  env.window.close();
});

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

test("K6a 显式返回列表：复用已捕获锚点，原生列表稳定后只修正一次", async () => {
  const { env, focusId, fixture } = makeSkinEnv({ url: "/home" });
  let top = 384;
  fixture.cell.getBoundingClientRect = () => ({ top, bottom: top + 100, height: 100 });
  fixture.cell.querySelector("time").closest("a").click();
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await realSleep(5);
  topbar(env).querySelector('[aria-label="返回"]').click();
  await env.navigate("/home");
  env.scroll.y = 469;
  top = 315; // Same list height; native return displaced the anchor by -69px.
  await env.timers.advance(1000);
  assert.equal(env.scroll.y, 400);
  env.scroll.y = 420;
  await env.timers.advance(2500);
  assert.equal(env.scroll.y, 420, "restoration finished, never competes with later input");
  env.window.close();
});

test("K7 「原生视图」释放：会话释放、split 与皮肤下线；UNINSTALL 命名焦点", async () => {
  const { env, sent, focusId } = makeSkinEnv({});
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await realSleep(5);
  const before = sent.length, commands = [];
  env.document.addEventListener('peek-lad-native-release', event => commands.push(JSON.parse(event.detail)));
  topbar(env).querySelector(".pk-tb-native").click();
  await realSleep(10);
  assert.equal(stateAttr(env), "idle");
  assert.equal(env.document.getElementById("peek-lad-style"), null, "split released");
  assert.equal(topbar(env), null, "chrome released");
  const uninstall = commands[0];
  assert.ok(uninstall, "fixed synchronous release dispatched");
  assert.equal(uninstall.focusUrlId, focusId, "release names its session focus");
  assert.equal(sent.slice(before).filter(m => m.type === 'UNINSTALL').length, 0, 'no async command on normal synchronous success');
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
  assert.ok(skin.includes(`--peek-reader-column-gap: ${g.columnGap}px`));
  assert.ok(skin.includes(`width: calc(52vw - var(--peek-reader-inset) - var(--peek-reader-column-gap))`), "focal card width = geometry");
  // Preview and native focal top share the same top inset independently of side margins.
  assert.ok(skin.includes(`--peek-reader-card-top: ${g.topbarH + g.topInset}px`));
  assert.ok(skin.includes(`top: var(--peek-reader-card-top)`));
});

test("K10 画布 !important 规则存在时，主题仍跟随 X 的内联信号（就地切换）", async () => {
  // The skin's canvas rule is !important, so the COMPUTED body background is
  // ours while mounted (jsdom does not implement that cascade — the real
  // cascade is covered by the live `themeinline` scenario). readTheme() reads
  // X's INLINE body background first, which is exactly the signal X writes.
  const { env, focusId, poc } = makeSkinEnv({});
  env.document.body.style.backgroundColor = "rgb(255, 255, 255)";
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await realSleep(5);
  assert.equal(poc.layoutAdapter.themeDiagnostics().inlineVars["--peek-lad-bg"], "#ffffff");
  env.document.body.style.backgroundColor = "rgb(0, 0, 0)"; // X's in-place dark write
  await realSleep(10);
  const d = poc.layoutAdapter.themeDiagnostics();
  assert.equal(d.inlineVars["--peek-lad-bg"], "#000000", "palette follows the inline theme write while mounted");
  assert.equal(d.inlineVars["--peek-lad-page"], "#0b0e11", "canvas switches with the same signal");
  assert.equal(d.inlineVars["--peek-lad-fg"], "#e7e9ea");
});


async function paneExitEnv() {
  const f = makeSkinEnv({}); const { env, fixture, focusId } = f;
  await env.pushNavigate(`/somebody/status/${focusId}`); await realSleep(5);
  const on = () => env.document.documentElement.getAttribute('data-peek-lad') === 'on';
  fixture.art.scrollTop = 400;
  fixture.cell.style.boxSizing = 'border-box';
  fixture.cell.getBoundingClientRect = () => {
    const height = on() ? Math.max(85, parseFloat(fixture.cell.style.minHeight) || 0) : 1685;
    return { left: 0, right: on() ? 714 : 598, top: -env.scroll.y, bottom: height - env.scroll.y, width: on() ? 714 : 598, height };
  };
  fixture.art.getBoundingClientRect = () => ({ left: 16, right: 730, top: on() ? 68 : 200 - env.scroll.y, bottom: on() ? 797 : 1800 - env.scroll.y, width: 714, height: on() ? 729 : 1600 });
  const video = env.document.createElement('video'); fixture.art.append(video);
  video.getBoundingClientRect = () => ({ left: 32, right: 700, top: on() ? 568 - fixture.art.scrollTop : 700 - env.scroll.y, bottom: (on() ? 568 - fixture.art.scrollTop : 700 - env.scroll.y) + 300, width: 668, height: 300 });
  const reply = buildCell({ statusId: '2053230853795266618' });
  const column = env.document.querySelector('[data-testid="primaryColumn"]'); column.append(reply.cell);
  column.getBoundingClientRect = () => ({ left: 0, right: 1451, top: -env.scroll.y, bottom: 20000 - env.scroll.y, width: 1451, height: 20000 });
  reply.art.getBoundingClientRect = () => ({ left: 762.5, right: 1435, top: (on() ? 1080 : 2000) - env.scroll.y, bottom: (on() ? 1380 : 2300) - env.scroll.y, width: 672.5, height: 300 });
  env.document.elementFromPoint = (x, y) => {
    for (const node of [video, reply.art]) { const r = node.getBoundingClientRect(); if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return node; }
    return null;
  };
  const ai = env.document.createElement('section'); ai.id = 'peek-ai-card'; ai.innerHTML = '<p>summary fixture</p>'; env.document.body.append(ai);
  const writes = []; env.window.scrollTo = ({ top }) => { env.scroll.y = top; writes.push(top); }; env.scroll.y = 680;
  return { ...f, video, reply, ai, writes };
}

for (const sequence of ['default', 'left-right', 'right-left', 'left-AI', 'untrusted-right', 'right-same-route']) test(`K11 compiled last-pane wiring (${sequence}, callback fixtures)`, async () => {
  const f = await paneExitEnv(); const { env, video, reply, ai, writes, poc, focusId } = f;
  if (sequence === 'left-right' || sequence === 'left-AI') env.readerInputFixture('pointerdown', video);
  if (['left-right', 'right-left', 'right-same-route'].includes(sequence)) env.readerInputFixture('wheel', reply.art);
  if (sequence === 'right-left') env.readerInputFixture('pointerdown', video);
  if (sequence === 'left-AI') env.readerInputFixture('pointerdown', ai.querySelector('p'));
  if (sequence === 'untrusted-right') reply.art.dispatchEvent(new env.window.Event('pointerdown', { bubbles: true }));
  if (sequence === 'right-same-route') poc.layoutAdapter.onDetailRoute(focusId);
  const button = topbar(env).querySelector('.pk-tb-native'); env.readerInputFixture('pointerdown', button); button.click();
  const right = ['left-right', 'left-AI', 'right-same-route'].includes(sequence);
  if (!right) assert.deepEqual(writes, [], 'left observes its height lease while preserving the active session');
  assert.equal(env.readerInputCount(), right ? 0 : 5);
  await env.timers.advance(800);
  assert.equal(env.readerInputCount(), 0, 'all tracker callbacks removed by final exit');
  if (!right) assert.deepEqual(writes, [532], 'last-left maps once after bounded height preheat');
  await env.timers.advance(1200);
  assert.deepEqual(writes, right ? [1600] : [532]);
  env.window.close();
});

test('K15 compiled left exit leases measured original cell height before its only scroll', async () => {
  const { env, fixture, video, writes } = await paneExitEnv();
  env.readerInputFixture('pointerdown', video);
  const button = topbar(env).querySelector('.pk-tb-native'); button.click();
  assert.deepEqual(writes, [], 'no mapping until native height has been observed');
  assert.equal(stateAttr(env), 'active'); assert.equal(button.getAttribute('aria-busy'), 'true');
  assert.equal(fixture.cell.style.minHeight, '1685px'); assert.equal(video.getBoundingClientRect().top, 168);
  button.click(); await env.timers.advance(500);
  assert.deepEqual(writes, [], 'repeated exit is idempotent, not an early teardown');
  await env.timers.advance(300);
  assert.deepEqual(writes, [532]); assert.equal(fixture.cell.style.minHeight, '');
  assert.equal(stateAttr(env), 'idle'); env.window.close();
});

test('K17 compiled left text skips zero-width newline and completes height lease with visible glyph', async () => {
  const { env, fixture, video, writes } = await paneExitEnv(); video.remove();
  const p = env.document.createElement('p'); p.textContent = 'x'.repeat(44) + '\n' + 'x'.repeat(51) + 'o'.repeat(40); fixture.art.append(p);
  p.getBoundingClientRect = () => ({ left: 32, right: 700, top: -232, bottom: 768, width: 668, height: 1000 });
  env.document.elementFromPoint = (x, y) => x >= 32 && x <= 700 && y >= 68 && y < 797 ? p : null;
  let caret = 0; const create = env.document.createRange.bind(env.document);
  env.document.caretRangeFromPoint = () => ({ startContainer: p.firstChild, startOffset: caret++ === 0 ? 44 : 96 });
  env.document.createRange = () => {
    const range = create(); range.getBoundingClientRect = () => ({
      top: env.document.documentElement.getAttribute('data-peek-lad') === 'on' ? (range.startOffset === 44 ? 72.5 : 96.5) : 1040 - env.scroll.y,
      width: range.startOffset === 44 ? 0 : 9.265625, height: 20,
    }); return range;
  };
  env.readerInputFixture('pointerdown', p); topbar(env).querySelector('.pk-tb-native').click();
  assert.equal(fixture.cell.style.minHeight, '1685px', 'a visible nonzero glyph starts the height lease');
  await env.timers.advance(800);
  assert.deepEqual(writes, [943.5]); assert.equal(1040 - env.scroll.y, 96.5);
  assert.equal(stateAttr(env), 'idle'); assert.equal(fixture.cell.style.minHeight, ''); env.window.close();
});

test('K12 compiled tracking resets on offRoute, health failure and reopen; no history carry', async () => {
  for (const stop of ['route', 'health']) {
    const { env, poc, focusId, reply, video, sent, writes } = await paneExitEnv();
    env.readerInputFixture('pointerdown', reply.art); assert.equal(env.readerInputCount(), 5);
    if (stop === 'route') poc.layoutAdapter.offRoute();
    else { const active = sent.find(m => m.type === 'ACTIVE'); env.window.postMessage({ ns: 'peek-lad', from: 'main', type: 'HEALTH_ERROR', focusUrlId: focusId, gen: active.gen, reason: 'fixture-health' }); await env.timers.flushMicrotasks(); }
    assert.equal(env.readerInputCount(), 0);
    poc.layoutAdapter.onDetailRoute(focusId); await env.timers.flushMicrotasks();
    assert.equal(env.readerInputCount(), 5, 'new active layout installs one fresh tracker');
    env.scroll.y = 680; topbar(env).querySelector('.pk-tb-native').click(); await env.timers.advance(800);
    assert.equal(video.getBoundingClientRect().top, 168); assert.deepEqual(writes, [532]);
    assert.equal(env.readerInputCount(), 0); env.window.close();
  }
});


test('K13 compiled deep-left handoff uninstalls and maps final geometry before queued native recycling', async () => {
  const { env, fixture, video, writes, sent } = await paneExitEnv();
  const rect = video.getBoundingClientRect;
  video.getBoundingClientRect = () => { const r = rect(); return fixture.art.hasAttribute('data-peek-lad-focal') ? r : { ...r, top: r.top + 400, bottom: r.bottom + 400 }; };
  env.scroll.y = 2964;
  const observer = new env.window.MutationObserver(() => {
    if (video.getBoundingClientRect().bottom < 0) video.remove();
  });
  observer.observe(env.document.documentElement, { attributes: true, attributeFilter: ['data-peek-lad'] });
  env.readerInputFixture('pointerdown', video); topbar(env).querySelector('.pk-tb-native').click();
  assert.deepEqual(writes, [], 'height warmup precedes final synchronous release');
  await env.timers.advance(800);
  assert.deepEqual(writes, [932], 'one same-stack map uses geometry after MAIN unmarks/restores');
  assert.equal(env.ladTest().query().phase, 'idle');
  assert.equal(video.getBoundingClientRect().top, 168);
  assert.equal(sent.filter(m => m.type === 'UNINSTALL').length, 0, 'normal left handoff has no async command');
  await env.timers.advance(1200);
  assert.equal(video.isConnected, true); assert.equal(writes.length, 1);
  observer.disconnect(); env.window.close();
});

for (const interrupt of ['input', 'route', 'reopen', 'node-recycled', 'core-error', 'missing-command', 'missing-result', 'foreign-result', 'malformed-result', 'extra-result-field', 'late-result']) test(`K14 compiled synchronous left handoff cleanup: ${interrupt}`, async () => {
  const { env, poc, focusId, fixture, video, writes, sent } = await paneExitEnv();
  const dispatch = env.document.dispatchEvent.bind(env.document);
  const delayed = []; let resultListeners = 0;
  const add = env.document.addEventListener.bind(env.document), remove = env.document.removeEventListener.bind(env.document);
  env.document.addEventListener = (type, fn, options) => { if (type === 'peek-lad-native-released') resultListeners++; add(type, fn, options); };
  env.document.removeEventListener = (type, fn, options) => { if (type === 'peek-lad-native-released') resultListeners--; remove(type, fn, options); };
  env.document.dispatchEvent = event => {
    if (event.type === 'peek-lad-native-release') {
      if (interrupt === 'input') env.window.dispatchEvent(new env.window.Event('wheel'));
      if (interrupt === 'route') { env.location.pathname = '/home'; env.location.href = 'https://x.com/home'; }
      if (interrupt === 'reopen') poc.layoutAdapter.onDetailRoute(focusId);
      if (interrupt === 'node-recycled') video.replaceWith(video.cloneNode(true));
      if (interrupt === 'core-error') Object.defineProperty(fixture.v.instance, '_getFinalRenderedItems', { configurable: false });
      if (interrupt === 'missing-command') return true;
    }
    if (event.type === 'peek-lad-native-released') {
      if (interrupt === 'missing-result') return true;
      if (interrupt === 'foreign-result') {
        const m = JSON.parse(event.detail);
        return dispatch(new env.window.CustomEvent(event.type, { detail: JSON.stringify({ ...m, nonce: m.nonce + 100 }) }));
      }
      if (interrupt === 'malformed-result') return dispatch(new env.window.CustomEvent(event.type, { detail: '{' }));
      if (interrupt === 'extra-result-field') return dispatch(new env.window.CustomEvent(event.type, { detail: JSON.stringify({ ...JSON.parse(event.detail), url: 'https://example.test/' }) }));
      if (interrupt === 'late-result') { delayed.push(event); return true; }
    }
    return dispatch(event);
  };
  env.readerInputFixture('pointerdown', video); topbar(env).querySelector('.pk-tb-native').click();
  assert.deepEqual(writes, [], 'interrupted/unsuccessful handoff never maps');
  assert.equal(resultListeners, 0, 'temporary result receiver removed before return');
  for (const event of delayed) dispatch(event);
  await env.timers.advance(1200);
  for (const event of delayed) dispatch(event);
  assert.deepEqual(writes, [], 'late result/async cleanup cannot recover or rebind');
  if (interrupt === 'reopen') assert.equal(stateAttr(env), 'active', 'new session survives old release');
  else if (interrupt !== 'core-error') assert.equal(env.ladTest().query().phase, 'idle', 'no orphan retention after cleanup');
  else assert.equal(env.ladTest().query().phase, 'residue-locked', 'restore failure is preserved, never retried');
  if (['missing-command', 'missing-result', 'foreign-result', 'malformed-result', 'extra-result-field', 'late-result'].includes(interrupt)) {
    const cleanup = sent.filter(m => m.type === 'UNINSTALL');
    assert.equal(cleanup.length, 1); assert.equal(cleanup[0].reason, 'native-view-cleanup'); assert.ok(cleanup[0].gen > 0);
  }
  env.window.close();
});

for (const interrupt of ['input', 'route', 'hidden', 'reopen', 'video-replaced', 'link-replaced']) test(`K16 compiled pending height exit cancellation: ${interrupt}`, async () => {
  const { env, poc, fixture, video, writes, focusId } = await paneExitEnv();
  const callbacks = new Set(), add = env.window.addEventListener.bind(env.window), remove = env.window.removeEventListener.bind(env.window);
  env.window.addEventListener = (type, fn, opts) => { if (type === 'wheel') callbacks.add(fn); add(type, fn, opts); };
  env.window.removeEventListener = (type, fn, opts) => { if (type === 'wheel') callbacks.delete(fn); remove(type, fn, opts); };
  env.readerInputFixture('pointerdown', video); topbar(env).querySelector('.pk-tb-native').click();
  assert.equal(fixture.cell.style.minHeight, '1685px');
  poc.layoutAdapter.onDetailRoute(focusId); assert.equal(fixture.cell.style.minHeight, '1685px', 'same-focus tick does not supersede ACTIVE pending');
  if (interrupt === 'input') for (const fn of [...callbacks]) fn({ type: 'wheel', target: video, isTrusted: true });
  if (interrupt === 'route') await env.navigate('/home');
  if (interrupt === 'hidden') { Object.defineProperty(env.document, 'hidden', { value: true, configurable: true }); env.document.dispatchEvent(new env.window.Event('visibilitychange')); }
  if (interrupt === 'reopen') { poc.layoutAdapter.offRoute(); await env.timers.flushMicrotasks(); poc.layoutAdapter.onDetailRoute(focusId); await env.timers.flushMicrotasks(); }
  if (interrupt === 'video-replaced') video.replaceWith(video.cloneNode(true));
  if (interrupt === 'link-replaced') { const link = fixture.art.querySelector('a:has(time)'); link.replaceWith(link.cloneNode(true)); }
  await env.timers.advance(1200);
  assert.deepEqual(writes, []); assert.equal(fixture.cell.style.minHeight, ''); assert.equal(callbacks.size, 0);
  if (interrupt !== 'route') assert.equal(stateAttr(env), 'active', 'cancellation preserves reader/new session');
  env.window.close();
});
