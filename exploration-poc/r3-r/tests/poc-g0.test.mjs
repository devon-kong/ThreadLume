// R4 G0 tests: close-decision navigation (G0-A), event-driven route detection
// (G0-B). Drives the REAL production content.js through the shared jsdom
// harness. The close decision must consult the real session-history state —
// never an unconditional history.back(), never a permanent boolean.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, makeStatusId, mountCell, buildCell, buildAuthor, buildTweetText, buildActionBar } from "./poc-env.mjs";

const waitMs = 20_000;

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
  env.pane().querySelector(".peek-poc-close").click();
  await env.timers.flushMicrotasks();
};

// ---------- G0-A: the six required close scenarios (fallback trail path) ----------

test("G0-A-1 /home → A，关闭返回 /home", async () => {
  const env = makeEnv(); // boots on /home
  env.boot();
  const idA = makeStatusId();
  await openAndWait(env, idA);
  await close(env);
  assert.equal(env.history._backCalls, 1, "list-originated close follows the session history");
  await env.navigate("/home"); // the browser completes the back
  assert.equal(env.panes(), 0);
});

test("G0-A-2 外部直达 A，关闭留在 X（不后退到站外）", async () => {
  const env = makeEnv({ url: `/somebody/status/${makeStatusId()}` }); // document starts on the detail
  env.boot();
  const idA = env.location.pathname.match(/\/status\/(\d+)/)[1];
  mountCell(env, focalFixture(idA));
  await env.timers.advance(1_500);
  await close(env);
  assert.equal(env.history._backCalls, 0, "initial entry has an unknown predecessor");
  assert.equal(env.location.pathname.includes("/status/"), true, "stays on X");
  assert.equal(env.panes(), 0, "enhancement dismissed in place");
});

test("G0-A-3 外部→A→引用帖 B→后退到 A，关闭留在 A（后退目标是站外页）", async () => {
  const env = makeEnv({ url: `/somebody/status/${makeStatusId()}` }); // external entry: doc starts at A
  env.boot();
  const idA = env.location.pathname.match(/\/status\/(\d+)/)[1];
  const idB = makeStatusId();
  mountCell(env, focalFixture(idA));
  await env.timers.advance(1_500);
  await env.pushNavigate(`/other/status/${idB}`); // click into quote/reply B
  mountCell(env, focalFixture(idB));
  await env.timers.advance(1_500);
  await close(env); // back target is A (visited) — back is fine here
  assert.equal(env.history._backCalls, 1, "B's previous entry is A, visited in-document");
  await env.navigate(`/somebody/status/${idA}`); // the browser completes the back to A
  await env.timers.advance(700);
  await close(env); // now A is the document's INITIAL entry: back would leave X
  assert.equal(env.history._backCalls, 1, "no second back after returning to the initial entry");
  assert.equal(env.location.pathname, `/somebody/status/${idA}`, "stays on A");
  assert.equal(env.panes(), 0);
});

test("G0-A-4 通知列表进入帖子，关闭返回通知列表", async () => {
  const env = makeEnv({ url: "/notifications" });
  env.boot();
  const idA = makeStatusId();
  await openAndWait(env, idA);
  await close(env);
  assert.equal(env.history._backCalls, 1);
  await env.navigate("/notifications");
  assert.equal(env.panes(), 0);
});

test("G0-A-5 A→B→C 连续进入，逐级后退关闭", async () => {
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

test("G0-A-6 刷新后关闭不得后退到站外（trail 路径：留在 X）", async () => {
  // the pre-refresh document saw /home → A, but a refresh creates a NEW
  // document whose trail starts at A; the fallback path must stay on X
  const env = makeEnv({ url: `/somebody/status/${makeStatusId()}` });
  env.boot();
  const idA = env.location.pathname.match(/\/status\/(\d+)/)[1];
  mountCell(env, focalFixture(idA));
  await env.timers.advance(1_500);
  await close(env);
  assert.equal(env.history._backCalls, 0, "conservative stay after a document reload");
  assert.equal(env.panes(), 0);
});

// ---------- G0-A: Navigation API entries() path (exact session history) ----------

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

test("G0-A-NAV 外部→A：entries() 显示前项非 X，关闭不后退", async () => {
  const { nav } = fakeNavigation({ entries: ["https://news.example.com/article", "https://x.com/somebody/status/1"], index: 1 });
  const env = makeEnv({ url: "/somebody/status/1" });
  env.window.navigation = nav; // exposed to the isolated world before boot
  env.boot();
  assert.equal(env.poc.navApi(), true, "Navigation API path armed");
  mountCell(env, focalFixture("1"));
  await env.timers.advance(1_500);
  await close(env);
  assert.equal(env.history._backCalls, 0, "cross-origin predecessor is not a back target");
  assert.equal(env.panes(), 0);
});

test("G0-A-NAV /home→A（跨文档刷新后仍保留联合历史）：关闭返回 /home", async () => {
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
  assert.equal(env.history._backCalls, 1, "refresh keeps the joint session history — back to the timeline");
  await env.navigate("/home"); // the browser completes the back
  assert.equal(env.panes(), 0);
});

test("G0-A-NAV 初始条目（index 0）：关闭不后退", async () => {
  const { nav } = fakeNavigation({ entries: ["https://x.com/somebody/status/1"], index: 0 });
  const env = makeEnv({ url: "/somebody/status/1" });
  env.window.navigation = nav;
  env.boot();
  mountCell(env, focalFixture("1"));
  await env.timers.advance(1_500);
  await close(env);
  assert.equal(env.history._backCalls, 0);
});

test("G0-A-NAV navigate 事件更新轨迹：push 后关闭按会话历史决定", async () => {
  const { nav, state } = fakeNavigation({
    entries: ["https://x.com/home", "https://x.com/somebody/status/1"],
    index: () => state.idx,
  });
  state.idx = 1;
  const env = makeEnv({ url: "/home" });
  env.window.navigation = nav;
  env.boot();
  // X pushes the detail route (no popstate fires); the navigate event carries
  // the destination — the trail follows without relying on the poll
  state.entries = ["https://x.com/home", "https://x.com/somebody/status/9"];
  state.fire("push", "https://x.com/somebody/status/9");
  state.idx = 1;
  await env.timers.flushMicrotasks();
  assert.equal(env.location.pathname, "/home", "location not yet changed by the fake");
  // now the navigation commits in the fake location
  env.location.pathname = "/somebody/status/9";
  env.location.href = "https://x.com/somebody/status/9";
  mountCell(env, focalFixture("9"));
  await env.timers.advance(2_100); // no further event: the poll safety net confirms the route
  assert.ok(env.pane(), "pane builds after the route lands");
  await close(env);
  assert.equal(env.history._backCalls, 1, "entries() decides: previous entry is /home");
});

test("G0-A-NAV entries() 抛异常时回退轨迹路径（外部直达不后退）", async () => {
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

// ---------- G0-B: event-driven route detection ----------

test("G0-B-1 链接点击后 pushState（无 popstate）：级联在 ≤350ms 内识别路由", async () => {
  const env = makeEnv();
  env.boot();
  const idA = makeStatusId();
  const before = env.poc.lastRouteChangeAt();
  await env.clickLink(`/somebody/status/${idA}`);
  env.location.pathname = `/somebody/status/${idA}`;
  env.location.href = `https://x.com/somebody/status/${idA}`;
  await env.timers.advance(50); // only the 0ms cascade step needed
  assert.ok(env.poc.lastRouteChangeAt() > before, "route change observed without any popstate");
  mountCell(env, focalFixture(idA));
  await env.timers.advance(1_500);
  assert.ok(env.pane(), "pane builds from click-cascade detection alone");
});

test("G0-B-2 无点击无事件时兜底轮询仍能发现路由（上限 2000ms）", async () => {
  const env = makeEnv();
  env.boot();
  const idA = makeStatusId();
  await env.pushNavigate(`/somebody/status/${idA}`, { viaClick: false });
  await env.timers.advance(2_100); // the idle poll fires
  mountCell(env, focalFixture(idA));
  await env.timers.advance(1_500);
  assert.ok(env.pane(), "poll safety net still finds the navigation");
});

test("G0-B-3 title 变更驱动路由检查（无点击路径）", async () => {
  const env = makeEnv({ url: "/home", html: '<!doctype html><html><head><title>Home / X</title></head><body></body></html>' });
  env.boot();
  const idA = makeStatusId();
  const before = env.poc.lastRouteChangeAt();
  const title = env.document.querySelector("head > title");
  title.textContent = `(3) 某帖 / X`; // X rewrites the title per route
  env.location.pathname = `/somebody/status/${idA}`;
  env.location.href = `https://x.com/somebody/status/${idA}`;
  await new Promise((r) => setImmediate(r));
  await env.timers.flushMicrotasks();
  assert.ok(env.poc.lastRouteChangeAt() > before, "title mutation triggered a route check");
});

test("G0-B-4 快速连点 A→B：最终只挂载 B（事件路径不引入新竞态）", async () => {
  const env = makeEnv();
  env.boot();
  const idA = makeStatusId();
  const idB = makeStatusId();
  await env.clickLink(`/somebody/status/${idA}`);
  env.location.pathname = `/somebody/status/${idA}`;
  env.location.href = `https://x.com/somebody/status/${idA}`;
  await env.timers.advance(50);
  await env.clickLink(`/somebody/status/${idB}`);
  env.location.pathname = `/somebody/status/${idB}`;
  env.location.href = `https://x.com/somebody/status/${idB}`;
  mountCell(env, focalFixture(idB, "B 的正文"));
  await env.timers.advance(waitMs);
  mountCell(env, focalFixture(idA, "A 的正文"));
  await env.timers.advance(60_000);
  assert.equal(env.panes(), 1);
  assert.equal(env.pane().dataset.statusId, idB, "B wins; A's late DOM never remounts");
});

// ---------- G2: decoupled show-more upgrade ----------

test("G2 长帖快速首显：折叠文本先上屏，展开后原地升级（不重挂、不闪烁）", async () => {
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
  art.appendChild(more);
  // hydrate the full text only after the show-more click (like X does)
  more.addEventListener("click", () => {
    const t = art.querySelector('[data-testid="tweetText"]');
    t.textContent = "折叠的首段文本\n展开后的完整正文第二段";
  });

  await env.pushNavigate(`/somebody/status/${idA}`);
  env.document.body.appendChild(cell); // mount ONCE, after the route change
  await env.timers.advance(1_200); // fast path + one expansion round (700ms wait)
  const pane = env.pane();
  assert.ok(pane, "pane mounts from the collapsed text");
  assert.match(pane.textContent, /折叠的首段文本/, "collapsed body readable at first paint");
  assert.match(pane.textContent, /展开后的完整正文第二段/, "upgrade replaced the text in place");
  assert.equal(env.panes(), 1, "no remount during the upgrade");
  assert.equal(clicks, 1, "exactly one display expansion");
});

test("G2 升级途中关闭：展开只点击一次，死亡任务不更新任何内容", async () => {
  const env = makeEnv();
  env.boot();
  const idA = makeStatusId();
  const { cell, art } = buildCell({
    statusId: idA,
    articleChildren: [buildAuthor(), buildTweetText("长帖"), buildActionBar()],
  });
  const more = env.document.createElement("button");
  more.setAttribute("role", "button");
  more.textContent = "显示更多";
  let clicks = 0;
  more.addEventListener("click", () => { clicks++; });
  art.appendChild(more);
  await env.pushNavigate(`/somebody/status/${idA}`);
  env.document.body.appendChild(cell); // mount ONCE, after the route change
  await env.timers.advance(1_200); // fast mount; upgrade clicks show-more, waits 700ms
  await env.navigate("/home");     // close while the upgrade wait is pending
  await env.timers.advance(60_000);
  assert.equal(env.panes(), 0, "no stale pane after close");
  assert.equal(clicks, 1, "the dead upgrade never clicks again");
});


test("G0-Esc Esc 关闭阅读器（跟随关闭语义），输入中不关闭", async () => {
  const env = makeEnv();
  env.boot();
  const idA = makeStatusId();
  await openAndWait(env, idA);

  // typing guard: Esc inside the native composer belongs to X
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

test("G2 匹配收紧：引用卡内的时间链接不充当焦点格（防串帖提取）", async () => {
  const env = makeEnv();
  env.boot();
  const idA = makeStatusId();
  await env.pushNavigate(`/somebody/status/${idA}`);
  // a timeline cell that only QUOTES post A: its quote card nests a time link
  // to /status/idA — it must NOT be selected as the focal cell
  const { cell } = buildCell({ statusId: makeStatusId(), articleChildren: [buildAuthor(), buildTweetText("引用者的正文")] });
  const quoteCard = env.document.createElement("div");
  quoteCard.setAttribute("role", "link");
  const quoteLink = env.document.createElement("a");
  quoteLink.setAttribute("href", `/somebody/status/${idA}`);
  const qt = env.document.createElement("time");
  qt.setAttribute("datetime", "2026-10-12T10:00:00.000Z");
  quoteLink.appendChild(qt);
  quoteCard.appendChild(quoteLink);
  cell.appendChild(quoteCard);
  env.document.body.appendChild(cell);
  await env.timers.advance(1_500);
  assert.equal(env.panes(), 0, "a quoting cell never feeds the pane the quoter's content");
  // when the REAL detail cell hydrates, the pane builds from it
  mountCell(env, { statusId: idA, articleChildren: [buildAuthor(), buildTweetText("真正的焦点正文"), buildActionBar()] });
  await env.timers.advance(1_500);
  const pane = env.pane();
  assert.ok(pane, "real focal cell builds the pane");
  assert.match(pane.textContent, /真正的焦点正文/, "content comes from the post itself");
});

test("G2-review-P2-1 文本单调性：展开升级完成后，水合刷新不得把全文回退为折叠文本", async () => {
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
  await env.timers.advance(1_200); // fast paint + expansion upgrade (full text + flag)
  const pane = env.pane();
  assert.match(pane.querySelector(".peek-poc-text").textContent, /展开后的完整正文第二段/, "full body in place");
  assert.equal(pane.querySelector(".peek-poc-text").dataset.peekFullText, "1", "full-text flag set");

  // a late hydration refresh whose source cell still renders the COLLAPSED
  // body must not regress the text (counts/time may still refresh)
  const fullBefore = pane.querySelector(".peek-poc-text").textContent;
  // drive the production updatePaneInPlace (test hook) with the same collapsed
  // extraction a late hydration refresh would carry
  env.poc.updatePaneInPlace(pane, env.poc.extractFromArticle(art, idA));
  assert.equal(pane.querySelector(".peek-poc-text").textContent, fullBefore, "collapsed refresh never regresses the full body");
});

test("G2-review-P2-2 X 自有浮层打开时 Esc 归 X（面板不关闭）", async () => {
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
