// Native close-decision tests — S3 adaptation (2026-10-15).
//
// The close DECISION (consult real session history; never an unconditional
// history.back(), never a permanent boolean) is a LIVE product contract: the
// unified C1-R build drives it from the reader-skin top-bar back button
// (end-to-end coverage: native-reader-skin K5/K6) and releases to X's own
// single column otherwise. The retired M1 pane and its ✕ button are gone, so
// the six scenario groups below now pin the SAME decision function
// (safeBackTarget, exported through the production test hook) at the exact
// point the skin consumes it — same scenario setup, same trail semantics.
//
// Retired with the M1 carrier (pane-only behavior, no unified-build
// equivalent): Esc-close guard tests and the pane render-upgrade tests
// (G2/P2-1/hydration). The adapter-mode reader has no Esc path and renders
// X's own DOM; hydration/upgrade races are covered by the controller suites.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, makeStatusId } from "./native-env.mjs";

// ---------- trail path: the six required close scenarios ----------

test("关闭-1 /home → A：同站会话历史在案，关闭决策为 history.back", async () => {
  const env = makeEnv(); // boots on /home
  const poc = env.boot();
  const idA = makeStatusId();
  await env.pushNavigate(`/somebody/status/${idA}`);
  assert.deepEqual(poc.safeBackTarget(), { back: true, why: "trail-visited-entry" },
    "list-originated session follows the session history");
});

test("关闭-2 外部直达 A：关闭决策留在 X（不后退到站外）", async () => {
  const env = makeEnv({ url: `/somebody/status/${makeStatusId()}` });
  const poc = env.boot();
  assert.equal(poc.safeBackTarget().back, false, "initial entry has an unknown predecessor");
  assert.equal(env.location.pathname.includes("/status/"), true, "stays on X");
});

test("关闭-3 外部→A→B→后退到 A：后退目标是初始条目，决策不后退", async () => {
  const idA = makeStatusId();
  const env = makeEnv({ url: `/somebody/status/${idA}` });
  const poc = env.boot();
  const idB = makeStatusId();
  await env.pushNavigate(`/other/status/${idB}`);
  assert.equal(poc.safeBackTarget().back, true, "B's previous entry is A, visited in-document");
  await env.navigate(`/somebody/status/${idA}`);
  await env.timers.advance(700);
  assert.equal(poc.safeBackTarget().back, false, "no back after returning to the initial entry");
  assert.equal(env.location.pathname, `/somebody/status/${idA}`, "stays on A");
});

test("关闭-4 通知列表进入帖子：关闭决策返回通知列表", async () => {
  const env = makeEnv({ url: "/notifications" });
  const poc = env.boot();
  const idA = makeStatusId();
  await env.pushNavigate(`/somebody/status/${idA}`);
  assert.equal(poc.safeBackTarget().back, true);
});

test("关闭-5 A→B→C 连续进入：每一级同站前项都决策后退，回到初始条目后不后退", async () => {
  const idA = makeStatusId();
  const env = makeEnv({ url: `/somebody/status/${idA}` });
  const poc = env.boot();
  const [idB, idC] = [makeStatusId(), makeStatusId()];
  await env.pushNavigate(`/other/status/${idB}`);
  await env.pushNavigate(`/third/status/${idC}`);
  assert.equal(poc.safeBackTarget().back, true, "C's previous entry is B (visited in-document)");
  await env.navigate(`/other/status/${idB}`); // traverse back one level
  await env.timers.advance(700);
  assert.equal(poc.safeBackTarget().back, true, "B's previous entry is A (visited in-document)");
  await env.navigate(`/somebody/status/${idA}`); // traverse back to the initial entry
  await env.timers.advance(700);
  assert.equal(poc.safeBackTarget().back, false, "the initial entry has no known predecessor");
});

test("关闭-6 刷新后关闭不得后退到站外（trail 路径：留在 X）", async () => {
  const env = makeEnv({ url: `/somebody/status/${makeStatusId()}` });
  const poc = env.boot();
  assert.equal(poc.safeBackTarget().back, false, "conservative stay after a document reload");
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

test("关闭-NAV 外部→A：entries() 显示前项非 X，决策不后退", async () => {
  const { nav } = fakeNavigation({ entries: ["https://news.example.com/article", "https://x.com/somebody/status/1"], index: 1 });
  const env = makeEnv({ url: "/somebody/status/1" });
  env.window.navigation = nav;
  const poc = env.boot();
  assert.equal(poc.navApi(), true, "Navigation API path armed");
  assert.deepEqual(poc.safeBackTarget(), { back: false, why: "navapi-previous-entry-not-x" });
});

test("关闭-NAV /home→A（刷新后仍保留联合历史）：决策返回 /home", async () => {
  const { nav, state } = fakeNavigation({
    entries: ["https://x.com/home", "https://x.com/somebody/status/1"],
    index: () => state.idx,
  });
  state.idx = 1;
  const env = makeEnv({ url: "/somebody/status/1" });
  env.window.navigation = nav;
  const poc = env.boot();
  assert.deepEqual(poc.safeBackTarget(), { back: true, why: "navapi-same-site-entry" });
});

test("关闭-NAV 初始条目（index 0）：决策不后退", async () => {
  const { nav } = fakeNavigation({ entries: ["https://x.com/somebody/status/1"], index: 0 });
  const env = makeEnv({ url: "/somebody/status/1" });
  env.window.navigation = nav;
  const poc = env.boot();
  assert.deepEqual(poc.safeBackTarget(), { back: false, why: "navapi-initial-entry" });
});

test("关闭-NAV navigate 事件更新轨迹：push 后按会话历史决策", async () => {
  const { nav, state } = fakeNavigation({
    entries: ["https://x.com/home", "https://x.com/somebody/status/9"],
    index: () => state.idx,
  });
  state.idx = 1;
  const env = makeEnv({ url: "/home" });
  env.window.navigation = nav;
  const poc = env.boot();
  state.fire("push", "https://x.com/somebody/status/9");
  state.idx = 1;
  await env.timers.flushMicrotasks();
  env.location.pathname = "/somebody/status/9";
  env.location.href = "https://x.com/somebody/status/9";
  await env.timers.advance(2_100); // route check lands on the detail URL (idle poll path)
  assert.deepEqual(poc.safeBackTarget(), { back: true, why: "navapi-same-site-entry" },
    "entries() decides: previous entry is /home");
});

test("关闭-NAV entries() 抛异常时回退轨迹路径（外部直达不后退）", async () => {
  const nav = {
    addEventListener: () => {},
    entries: () => { throw new Error("entries unavailable"); },
    currentEntry: { index: 1 },
  };
  const env = makeEnv({ url: `/somebody/status/${makeStatusId()}` });
  env.window.navigation = nav;
  const poc = env.boot();
  const decision = poc.safeBackTarget();
  assert.equal(decision.back, false, "trail fallback: initial entry stays");
  assert.match(decision.why, /^trail-/);
});

// ---------- route detection (pane build assertions retired with the M1 pane) ----------

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
});

test("路由：无点击无事件时兜底轮询仍能发现路由（上限 2000ms）", async () => {
  const env = makeEnv();
  env.boot();
  const idA = makeStatusId();
  const before = env.poc.lastRouteChangeAt();
  await env.pushNavigate(`/somebody/status/${idA}`, { viaClick: false });
  await env.timers.advance(1_600); // cumulative simulated time crosses the 2000ms idle poll
  assert.ok(env.poc.lastRouteChangeAt() > before,
    "poll safety net still finds the navigation");
});
