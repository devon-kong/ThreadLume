// M1 Native close-navigation tests (R4 G0-A semantics preserved through the
// engineering re-packaging): the close decision consults real session history
// — never an unconditional history.back(), never a permanent boolean. Runs the
// REAL built artifact via the shared offline harness.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeEnv, makeStatusId, mountCell, buildCell, buildAuthor, buildTweetText, buildActionBar,
} from "./native-env.mjs";

function focalFixture(statusId, text = "焦点帖正文") {
  return { statusId, articleChildren: [buildAuthor(), buildTweetText(text), buildActionBar()] };
}

async function openAndWait(env, statusId, opts) {
  await env.pushNavigate(`/somebody/status/${statusId}`);
  mountCell(env, opts ?? focalFixture(statusId));
  await env.timers.advance(1_500);
  return env.pane();
}

const close = async (env) => {
  env.pane().querySelector(".peek-native-close").click();
  await env.timers.flushMicrotasks();
};

// ---------- trail path: the six required close scenarios ----------

test("关闭-1 /home → A，关闭返回 /home", async () => {
  const env = makeEnv(); // boots on /home
  env.boot();
  const idA = makeStatusId();
  await openAndWait(env, idA);
  await close(env);
  assert.equal(env.history._backCalls, 1, "list-originated close follows the session history");
  await env.navigate("/home"); // the browser completes the back
  assert.equal(env.panes(), 0);
});

test("关闭-2 外部直达 A，关闭留在 X（不后退到站外）", async () => {
  const env = makeEnv({ url: `/somebody/status/${makeStatusId()}` });
  env.boot();
  const idA = env.location.pathname.match(/\/status\/(\d+)/)[1];
  mountCell(env, focalFixture(idA));
  await env.timers.advance(1_500);
  await close(env);
  assert.equal(env.history._backCalls, 0, "initial entry has an unknown predecessor");
  assert.equal(env.location.pathname.includes("/status/"), true, "stays on X");
  assert.equal(env.panes(), 0, "enhancement dismissed in place");
});

test("关闭-3 外部→A→B→后退到 A，关闭留在 A（后退目标是站外页）", async () => {
  const env = makeEnv({ url: `/somebody/status/${makeStatusId()}` });
  env.boot();
  const idA = env.location.pathname.match(/\/status\/(\d+)/)[1];
  const idB = makeStatusId();
  mountCell(env, focalFixture(idA));
  await env.timers.advance(1_500);
  await env.pushNavigate(`/other/status/${idB}`);
  mountCell(env, focalFixture(idB));
  await env.timers.advance(1_500);
  await close(env);
  assert.equal(env.history._backCalls, 1, "B's previous entry is A, visited in-document");
  await env.navigate(`/somebody/status/${idA}`);
  await env.timers.advance(700);
  await close(env);
  assert.equal(env.history._backCalls, 1, "no second back after returning to the initial entry");
  assert.equal(env.location.pathname, `/somebody/status/${idA}`, "stays on A");
  assert.equal(env.panes(), 0);
});

test("关闭-4 通知列表进入帖子，关闭返回通知列表", async () => {
  const env = makeEnv({ url: "/notifications" });
  env.boot();
  const idA = makeStatusId();
  await openAndWait(env, idA);
  await close(env);
  assert.equal(env.history._backCalls, 1);
  await env.navigate("/notifications");
  assert.equal(env.panes(), 0);
});

test("关闭-5 A→B→C 连续进入，逐级后退关闭", async () => {
  const env = makeEnv();
  env.boot();
  const [idA, idB, idC] = [makeStatusId(), makeStatusId(), makeStatusId()];
  await openAndWait(env, idA);
  await openAndWait(env, idB);
  await openAndWait(env, idC);
  await close(env);
  assert.equal(env.history._backCalls, 1, "C → B");
  await env.navigate(`/somebody/status/${idB}`);
  await env.timers.advance(1_500);
  await close(env);
  assert.equal(env.history._backCalls, 2, "B → A");
  await env.navigate(`/somebody/status/${idA}`);
  await env.timers.advance(1_500);
  await close(env);
  assert.equal(env.history._backCalls, 3, "A → list");
  await env.navigate("/home");
  assert.equal(env.panes(), 0);
});

test("关闭-6 刷新后关闭不得后退到站外（trail 路径：留在 X）", async () => {
  const env = makeEnv({ url: `/somebody/status/${makeStatusId()}` });
  env.boot();
  const idA = env.location.pathname.match(/\/status\/(\d+)/)[1];
  mountCell(env, focalFixture(idA));
  await env.timers.advance(1_500);
  await close(env);
  assert.equal(env.history._backCalls, 0, "conservative stay after a document reload");
  assert.equal(env.panes(), 0);
});

// ---------- Navigation API entries() path ----------

function fakeNavigation({ entries, index }) {
  const handlers = {};
  const state = {
    handlers,
    fire(type, destinationUrl) {
      handlers.navigate?.({ navigationType: type, destination: { url: destinationUrl } });
    },
  };
  const nav = {
    addEventListener: (t, fn) => { handlers[t] = fn; },
    entries: () => entries.map((url) => ({ url })),
    currentEntry: { get index() { return typeof index === "function" ? index() : index; } },
  };
  return { nav, state };
}

test("关闭-NAV 外部→A：entries() 显示前项非 X，关闭不后退", async () => {
  const { nav } = fakeNavigation({ entries: ["https://news.example.com/article", "https://x.com/somebody/status/1"], index: 1 });
  const env = makeEnv({ url: "/somebody/status/1" });
  env.window.navigation = nav;
  env.boot();
  assert.equal(env.poc.navApi(), true, "Navigation API path armed");
  mountCell(env, focalFixture("1"));
  await env.timers.advance(1_500);
  await close(env);
  assert.equal(env.history._backCalls, 0);
  assert.equal(env.panes(), 0);
});

test("关闭-NAV /home→A（刷新后仍保留联合历史）：关闭返回 /home", async () => {
  const { nav, state } = fakeNavigation({
    entries: ["https://x.com/home", "https://x.com/somebody/status/1"],
    index: () => state.idx,
  });
  state.idx = 1;
  const env = makeEnv({ url: "/somebody/status/1" });
  env.window.navigation = nav;
  env.boot();
  mountCell(env, focalFixture("1"));
  await env.timers.advance(1_500);
  await close(env);
  assert.equal(env.history._backCalls, 1);
  await env.navigate("/home");
  assert.equal(env.panes(), 0);
});

test("关闭-NAV 初始条目（index 0）：关闭不后退", async () => {
  const { nav } = fakeNavigation({ entries: ["https://x.com/somebody/status/1"], index: 0 });
  const env = makeEnv({ url: "/somebody/status/1" });
  env.window.navigation = nav;
  env.boot();
  mountCell(env, focalFixture("1"));
  await env.timers.advance(1_500);
  await close(env);
  assert.equal(env.history._backCalls, 0);
});

test("关闭-NAV navigate 事件更新轨迹：push 后关闭按会话历史决定", async () => {
  const { nav, state } = fakeNavigation({
    entries: ["https://x.com/home", "https://x.com/somebody/status/1"],
    index: () => state.idx,
  });
  state.idx = 1;
  const env = makeEnv({ url: "/home" });
  env.window.navigation = nav;
  env.boot();
  state.entries = ["https://x.com/home", "https://x.com/somebody/status/9"];
  state.fire("push", "https://x.com/somebody/status/9");
  state.idx = 1;
  await env.timers.flushMicrotasks();
  assert.equal(env.location.pathname, "/home", "location not yet changed by the fake");
  env.location.pathname = "/somebody/status/9";
  env.location.href = "https://x.com/somebody/status/9";
  mountCell(env, focalFixture("9"));
  await env.timers.advance(2_100);
  assert.ok(env.pane(), "pane builds after the route lands");
  await close(env);
  assert.equal(env.history._backCalls, 1, "entries() decides: previous entry is /home");
});

test("关闭-NAV entries() 抛异常时回退轨迹路径（外部直达不后退）", async () => {
  const nav = {
    addEventListener: () => {},
    entries: () => { throw new Error("entries unavailable"); },
    currentEntry: { index: 1 },
  };
  const env = makeEnv({ url: `/somebody/status/${makeStatusId()}` });
  env.window.navigation = nav;
  env.boot();
  const idA = env.location.pathname.match(/\/status\/(\d+)/)[1];
  mountCell(env, focalFixture(idA));
  await env.timers.advance(1_500);
  await close(env);
  assert.equal(env.history._backCalls, 0, "trail fallback: initial entry stays");
});

// ---------- route detection + Esc semantics ----------

test("路由：链接点击后 pushState（无 popstate）：级联在 ≤350ms 内识别", async () => {
  const env = makeEnv();
  env.boot();
  const idA = makeStatusId();
  const before = env.poc.lastRouteChangeAt();
  await env.clickLink(`/somebody/status/${idA}`);
  env.location.pathname = `/somebody/status/${idA}`;
  env.location.href = `https://x.com/somebody/status/${idA}`;
  await env.timers.advance(50);
  assert.ok(env.poc.lastRouteChangeAt() > before, "route change observed without any popstate");
  mountCell(env, focalFixture(idA));
  await env.timers.advance(1_500);
  assert.ok(env.pane(), "pane builds from click-cascade detection alone");
});

test("路由：无点击无事件时兜底轮询仍能发现路由（上限 2000ms）", async () => {
  const env = makeEnv();
  env.boot();
  const idA = makeStatusId();
  await env.pushNavigate(`/somebody/status/${idA}`, { viaClick: false });
  await env.timers.advance(2_100);
  mountCell(env, focalFixture(idA));
  await env.timers.advance(1_500);
  assert.ok(env.pane(), "poll safety net still finds the navigation");
});

test("路由：title 变更驱动路由检查（无点击路径）", async () => {
  const env = makeEnv({ url: "/home", html: '<!doctype html><html><head><title>Home / X</title></head><body></body></html>' });
  env.boot();
  const idA = makeStatusId();
  const before = env.poc.lastRouteChangeAt();
  const title = env.document.querySelector("head > title");
  title.textContent = `(3) 某帖 / X`;
  env.location.pathname = `/somebody/status/${idA}`;
  env.location.href = `https://x.com/somebody/status/${idA}`;
  await new Promise((r) => setImmediate(r));
  await env.timers.flushMicrotasks();
  assert.ok(env.poc.lastRouteChangeAt() > before, "title mutation triggered a route check");
});

test("Esc 关闭阅读器（跟随关闭语义），输入中不关闭", async () => {
  const env = makeEnv();
  env.boot();
  const idA = makeStatusId();
  await openAndWait(env, idA);

  const composer = env.document.createElement("div");
  composer.setAttribute("data-testid", "tweetTextarea_0");
  composer.setAttribute("contenteditable", "true");
  env.document.body.appendChild(composer);
  composer.dispatchEvent(new env.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await env.timers.flushMicrotasks();
  assert.ok(env.pane(), "Esc while composing does not close the reader");

  env.document.body.dispatchEvent(new env.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await env.timers.flushMicrotasks();
  assert.equal(env.history._backCalls, 1, "Esc follows the same safe-back decision as ✕");
  await env.navigate("/home");
  assert.equal(env.panes(), 0);
});

test("Esc：X 自有浮层打开时 Esc 归 X（面板不关闭）", async () => {
  const env = makeEnv();
  env.boot();
  const idA = makeStatusId();
  await env.pushNavigate(`/somebody/status/${idA}`);
  mountCell(env, { statusId: idA, articleChildren: [buildAuthor(), buildTweetText("正文"), buildActionBar()] });
  await env.timers.advance(1_500);
  const lightbox = env.document.createElement("div");
  lightbox.setAttribute("data-testid", "lightbox");
  env.document.body.appendChild(lightbox);
  env.document.body.dispatchEvent(new env.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await env.timers.flushMicrotasks();
  assert.ok(env.pane(), "Esc with an X lightbox open leaves the reader untouched");
  lightbox.remove();
  env.document.body.dispatchEvent(new env.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await env.timers.flushMicrotasks();
  assert.equal(env.history._backCalls, 1, "Esc without the lightbox closes the reader as usual");
});

// ---------- decoupled upgrades preserved ----------

test("G2 长帖：折叠文本先上屏，展开后原地升级（不重挂、仅一次展开点击）", async () => {
  const env = makeEnv();
  env.boot();
  const idA = makeStatusId();
  const { cell, art } = buildCell({
    statusId: idA,
    articleChildren: [buildAuthor(), buildTweetText("折叠的首段文本"), buildActionBar()],
  });
  env.document.body.appendChild(cell);
  const more = env.document.createElement("button");
  more.setAttribute("role", "button");
  more.textContent = "显示更多";
  let clicks = 0;
  more.addEventListener("click", () => { clicks++; });
  more.addEventListener("click", () => {
    const t = art.querySelector('[data-testid="tweetText"]');
    t.textContent = "折叠的首段文本\n展开后的完整正文第二段";
  });
  art.appendChild(more);

  await env.pushNavigate(`/somebody/status/${idA}`);
  env.document.body.appendChild(cell);
  await env.timers.advance(1_200);
  const pane = env.pane();
  assert.ok(pane, "pane mounts from the collapsed text");
  assert.match(pane.textContent, /折叠的首段文本/, "collapsed body readable at first paint");
  assert.match(pane.textContent, /展开后的完整正文第二段/, "upgrade replaced the text in place");
  assert.equal(env.panes(), 1, "no remount during the upgrade");
  assert.equal(clicks, 1, "exactly one display expansion");
});

test("P2-1 文本单调性：展开升级后，水合刷新不得把全文回退为折叠文本", async () => {
  const env = makeEnv();
  env.boot();
  const idA = makeStatusId();
  const { cell, art } = buildCell({
    statusId: idA,
    articleChildren: [buildAuthor(), buildTweetText("折叠的首段文本"), buildActionBar()],
  });
  env.document.body.appendChild(cell);
  const more = env.document.createElement("button");
  more.setAttribute("role", "button");
  more.textContent = "显示更多";
  more.addEventListener("click", () => {
    const t = art.querySelector('[data-testid="tweetText"]');
    t.textContent = "折叠的首段文本\n展开后的完整正文第二段";
  });
  art.appendChild(more);
  await env.pushNavigate(`/somebody/status/${idA}`);
  env.document.body.appendChild(cell);
  await env.timers.advance(1_200);
  const pane = env.pane();
  assert.match(pane.querySelector(".peek-native-text").textContent, /展开后的完整正文第二段/, "full body in place");
  assert.equal(pane.querySelector(".peek-native-text").dataset.peekFullText, "1", "full-text flag set");

  const fullBefore = pane.querySelector(".peek-native-text").textContent;
  env.poc.updatePaneInPlace(pane, env.poc.extractFromArticle(art, idA));
  assert.equal(pane.querySelector(".peek-native-text").textContent, fullBefore, "collapsed refresh never regresses the full body");
});

test("水合升级：详情格替换信息流格后原地刷新（不重挂）", async () => {
  const env = makeEnv();
  env.boot();
  const idA = makeStatusId();
  await env.pushNavigate(`/somebody/status/${idA}`);
  // timeline cell first (fast first paint)
  mountCell(env, { statusId: idA, articleChildren: [buildAuthor(), buildTweetText("时间线正文"), buildActionBar({ bookmark: "" })] });
  await env.timers.advance(600);
  const pane = env.pane();
  assert.ok(pane, "fast first paint from the timeline cell");
  // the detail page REPLACES the focal cell (X removes the timeline cell and
  // mounts its own — exact counts, new node)
  env.document.querySelector('[data-testid="cellInnerDiv"]').remove();
  mountCell(env, { statusId: idA, articleChildren: [buildAuthor(), buildTweetText("时间线正文"), buildActionBar({ bookmark: "1,148" })] });
  await env.timers.advance(3_000); // hydration upgrade window (12 × 250ms)
  assert.equal(env.panes(), 1, "no remount during hydration refresh");
  assert.match(pane.querySelector(".peek-native-counts").textContent, /1,148/, "exact counts refreshed in place");
});
