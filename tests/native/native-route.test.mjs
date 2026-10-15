// M1-R A1 — SPA route-observation real-world boundary.
//
// Observed live (M1-B3, re-confirmed this round): a Chromium extension
// isolated world CAN register a Navigation API "navigate" listener, but the
// events are never delivered to it. The M1 code therefore has a hole: with
// NAV_API present the <title> watcher is NOT enabled, so keyboard /
// programmatic SPA navigation (no click, no popstate) is only caught by the
// 2000ms idle poll.
//
// The fix under test: the title watcher is a co-primary signal in EVERY
// configuration (re-binding itself when X replaces the <title> element),
// the close-decision trail stays alive without navigate events, and the poll
// remains an honestly-bounded last resort.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeEnv, makeStatusId, mountCell, buildCell, buildAuthor, buildTweetText,
  buildActionBar,
} from "./native-env.mjs";

function focalFixture(statusId, text = "焦点帖正文") {
  return { statusId, articleChildren: [buildAuthor(), buildTweetText(text), buildActionBar()] };
}

// per-navigation detection signal: the diagnostics routeChanges log length
const observedCount = (env) => env.poc.diag().routeChanges.length;

// Advance the simulated clock in small steps and require the route flip to
// land inside `budgetMs` (the idle poll is 2000ms, so ≤400ms proves an event
// path — title watcher or click cascade — fired first).
async function detectWithin(env, before, budgetMs) {
  let elapsed = 0;
  while (observedCount(env) <= before && elapsed < budgetMs) {
    await env.timers.advance(50);
    elapsed += 50;
  }
  assert.ok(observedCount(env) > before,
    `route detected within the ${budgetMs}ms budget (not via the 2000ms poll; took ${elapsed}ms)`);
}

// flush-only detection: the observer reacted without ANY simulated clock movement
function assertInstantNoClock(env, before) {
  assert.ok(observedCount(env) > before, "route change observed");
}

test("A1 键盘/程序化导航（无点击无 popstate，Navigation API 静默）：title 变更即时驱动路由检查", async () => {
  const env = makeEnv({ navApi: "silent" });
  const poc = env.boot();
  assert.equal(poc.navApi(), true, "Navigation API object present (listener registrable)");
  const idA = makeStatusId();
  const before = observedCount(env);
  await env.programmaticNavigate(`/somebody/status/${idA}`); // flush only — no clock advance
  assertInstantNoClock(env, before);
  // detection is instant; the adapter session owns the detail route from here
  // (the M1 reading copy never mounts in the unified build — E1 contract)
  mountCell(env, focalFixture(idA));
  await env.timers.advance(1_500);
  assert.equal(env.pane(), null, "M1 reading copy never mounts in the unified build");
  assert.equal(env.document.documentElement.getAttribute("data-peek-lad-state"), "failed",
    "content-only harness window: the adapter session fails closed honestly");
});

test("A1 Navigation API 静默时监听器已注册但事件从不到达：title 路径独立兜住", async () => {
  const env = makeEnv({ navApi: "silent" });
  const poc = env.boot();
  assert.equal(env.navigateListenerCount(), 1, "navigate listener registered");
  const idA = makeStatusId();
  const before = observedCount(env);
  await env.programmaticNavigate(`/somebody/status/${idA}`, { title: "哥飞 on X: \"…\" / X" });
  assertInstantNoClock(env, before);
  // and the trail is NOT frozen: the observed URL reached the close-decision
  // bookkeeping through checkRoute (A1 fix), enabling a correct back decision
  const trail = poc.navTrailState();
  assert.ok(trail.trail.includes(`https://x.com/somebody/status/${idA}`),
    "fallback trail records the URL without navigate events");
  assert.ok(trail.idx > 0, "trail index advanced past the initial entry");
});

test("A1 X 内部 pushState（标题先于路由提交）：短级联兜住", async () => {
  const env = makeEnv({ navApi: "silent" });
  env.boot();
  const idA = makeStatusId();
  const before = observedCount(env);
  // title rewritten BEFORE the URL commits (router ordering never guaranteed):
  // the immediate title check reads the old path, the bounded cascade catches it
  env.document.querySelector("head > title").textContent = `某帖 / X`;
  await env.timers.flushMicrotasks();
  env.location.pathname = `/somebody/status/${idA}`;
  env.location.href = `https://x.com/somebody/status/${idA}`;
  await detectWithin(env, before, 400);
});

test("A1 标题不变的程序化导航：诚实的有界兜底（不伪造即时感知）", async () => {
  const env = makeEnv({ navApi: "silent" });
  env.boot();
  const idA = makeStatusId();
  const before = observedCount(env);
  // no click, no popstate, no title change, no navigate event — nothing to observe
  env.location.pathname = `/somebody/status/${idA}`;
  env.location.href = `https://x.com/somebody/status/${idA}`;
  await env.timers.advance(300);
  assert.equal(observedCount(env), before, "nothing observed before the poll");
  await env.timers.advance(1_800); // total ≥ the 2000ms idle poll
  assert.ok(observedCount(env) > before, "bounded poll finds it (documented residual limit)");
});

test("A1 点击帖子时间链接与正文卡片：级联即时，未退化", async () => {
  for (const target of ["time-link", "body-card"]) {
    const env = makeEnv({ navApi: "silent" });
    env.boot();
    const idA = makeStatusId();
    const { cell } = buildCell(focalFixture(idA));
    env.document.body.appendChild(cell);
    const before = observedCount(env);
    const hit = target === "time-link"
      ? cell.querySelector("a[href]")
      : cell.querySelector("article");
    hit.dispatchEvent(new env.window.MouseEvent("click", { bubbles: true, cancelable: true }));
    env.location.pathname = `/somebody/status/${idA}`;
    env.location.href = `https://x.com/somebody/status/${idA}`;
    await detectWithin(env, before, 400);
  }
});

test("A1 浏览器前进/后退（traverse）：popstate 即时 + 轨迹按 traverse 记账", async () => {
  const env = makeEnv({ navApi: "silent" });
  const poc = env.boot();
  const idA = makeStatusId();
  await env.pushNavigate(`/somebody/status/${idA}`); // click push (trail via checkRoute)
  await env.timers.advance(1_200);
  assert.ok(poc.navTrailState().idx > 0, "push recorded in the trail");
  await env.navigate("/home"); // back: popstate after URL change
  await env.timers.flushMicrotasks();
  const trail = poc.navTrailState();
  assert.equal(env.location.pathname, "/home");
  assert.ok(trail.idx === 0, "traverse moved the index back to the list entry");
  // forward again (traverse to a visited detail)
  await env.navigate(`/somebody/status/${idA}`);
  await env.timers.flushMicrotasks();
  assert.ok(poc.navTrailState().idx > 0, "forward traverse re-enters the recorded entry");
});

test("A1 Navigation API live（事件可达的未来世界）：事件驱动 + 轨迹不双记", async () => {
  const env = makeEnv({ navApi: "live" });
  const poc = env.boot();
  const idA = makeStatusId();
  const before = observedCount(env);
  env.location.pathname = `/somebody/status/${idA}`;
  env.location.href = `https://x.com/somebody/status/${idA}`;
  env.dispatchNavigate("push", `https://x.com/somebody/status/${idA}`);
  await env.timers.flushMicrotasks();
  assertInstantNoClock(env, before);
  const trail = poc.navTrailState();
  const statusEntries = trail.trail.filter((h) => h.endsWith(`/status/${idA}`));
  assert.equal(statusEntries.length, 1, "recordNav + checkRoute sync never double-append");
  // a click on the same navigation does not duplicate the listener either
  assert.equal(env.navigateListenerCount(), 1);
});

test("A1 快速 A→B→C 连续切换：观察链唯一、检测持续即时（面板跟随由适配器会话合同覆盖）", async () => {
  const env = makeEnv({ navApi: "silent" });
  const poc = env.boot();
  const [idA, idB, idC] = [makeStatusId(), makeStatusId(), makeStatusId()];
  mountCell(env, focalFixture(idA));
  await env.programmaticNavigate(`/somebody/status/${idA}`);
  await env.timers.advance(1_200);
  mountCell(env, focalFixture(idB));
  await env.programmaticNavigate(`/other/status/${idB}`);
  await env.timers.advance(1_200);
  mountCell(env, focalFixture(idC));
  await env.programmaticNavigate(`/third/status/${idC}`);
  await env.timers.advance(1_200);
  assert.equal(env.pane(), null, "M1 reading copy never mounts in the unified build");
  assert.equal(env.navigateListenerCount(), 1, "navigate listener registered exactly once");
  // title detection still works after the rapid sequence (flush-only, no clock)
  const idD = makeStatusId();
  const before = observedCount(env);
  await env.programmaticNavigate(`/fourth/status/${idD}`);
  assertInstantNoClock(env, before);
});

test("A1 路由后 DOM 延迟水合（title 路径）：适配器会话只启动一次，title 杂讯不重触发", async () => {
  const env = makeEnv({ navApi: "silent" });
  env.boot();
  const idA = makeStatusId();
  await env.programmaticNavigate(`/somebody/status/${idA}`);
  await env.timers.advance(3_000);
  assert.equal(env.pane(), null, "M1 reading copy never mounts in the unified build");
  assert.equal(env.document.documentElement.getAttribute("data-peek-lad-state"), "failed",
    "content-only harness window: one honest failed session");
  // late title churn (X updating unread counts) must not re-run route detection
  // or restart the adapter session
  mountCell(env, focalFixture(idA));
  const observedBefore = observedCount(env);
  env.document.querySelector("head > title").textContent = "(2) 某帖 / X";
  await env.timers.advance(1_000);
  assert.equal(observedCount(env), observedBefore, "same-URL title churn is not a route change");
  assert.equal(env.document.documentElement.getAttribute("data-peek-lad-state"), "failed",
    "the failed session is not resurrected by title churn");
});

test("A1 <title> 元素被整体替换：观察者自愈，后续变更仍即时", async () => {
  const env = makeEnv({ navApi: "silent" });
  env.boot();
  const idA = makeStatusId();
  // X swaps the <title> element wholesale
  const head = env.document.head;
  head.querySelector("title").remove();
  const fresh = env.document.createElement("title");
  fresh.textContent = "Home / X";
  head.appendChild(fresh);
  await env.timers.flushMicrotasks();
  const before = observedCount(env);
  await env.programmaticNavigate(`/somebody/status/${idA}`, { title: "某帖 / X" });
  assertInstantNoClock(env, before);
});

test("A1 连续导航不重复注册观察者：多个回合后 title 与 click 级联仍各自单份", async () => {
  const env = makeEnv({ navApi: "silent" });
  const poc = env.boot();
  for (let round = 0; round < 5; round++) {
    const id = makeStatusId();
    mountCell(env, focalFixture(id));
    await env.pushNavigate(`/somebody/status/${id}`); // click path
    await env.timers.advance(800);
    await env.navigate("/home"); // traverse path
    await env.timers.flushMicrotasks();
  }
  assert.equal(env.panes(), 0, "back on the list, nothing mounted");
  assert.equal(env.navigateListenerCount(), 1, "exactly one navigate listener total");
  const idLast = makeStatusId();
  mountCell(env, focalFixture(idLast));
  const before = observedCount(env);
  await env.programmaticNavigate(`/somebody/status/${idLast}`);
  assertInstantNoClock(env, before);
});

test("A1 无 Navigation API 的环境（旧路径不回归）：title watcher 与级联照常工作", async () => {
  const env = makeEnv(); // navApi absent — jsdom/reality without the API
  const poc = env.boot();
  assert.equal(poc.navApi(), false);
  const idA = makeStatusId();
  const before = observedCount(env);
  await env.programmaticNavigate(`/somebody/status/${idA}`);
  assertInstantNoClock(env, before);
  assert.ok(poc.navTrailState().idx > 0, "trail still records the push");
});

test("A1 document_start 注入（head 尚未解析）：安装不抛错，head 出现后 title 检测自愈", async () => {
  // the offline/CDP harness injects at document_start, where document.head is
  // still null — the title watcher must observe documentElement until head
  // exists, then re-bind the title element (regression found in live M2-A B0)
  const env = makeEnv({ html: "<!doctype html><html><body></body></html>" });
  env.window.document.head.remove(); // simulate pre-parser document_start
  const poc = env.boot(); // must not throw
  assert.equal(poc.navApi(), false);
  // document fully parsed later: head + title appear
  const head = env.document.createElement("head");
  const title = env.document.createElement("title");
  title.textContent = "Home / X";
  head.appendChild(title);
  env.document.documentElement.insertBefore(head, env.document.body);
  await env.timers.flushMicrotasks();
  const idA = makeStatusId();
  const before = observedCount(env);
  await env.programmaticNavigate(`/somebody/status/${idA}`, { title: "某帖 / X" });
  assertInstantNoClock(env, before);
});
