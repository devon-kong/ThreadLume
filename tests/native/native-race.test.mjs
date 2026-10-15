// Native race & lifecycle tests — S3 adaptation (2026-10-15).
//
// The unified C1-R build replaced the M1 reading-copy build loop with the
// adapter session lifecycle, so the pane build/upgrade races (B4-2…B4-7,
// B4-10) and the pane action-row semantics (M1-B4 互动语义) have no runtime
// path anymore — their live equivalents are covered by the controller and
// protocol suites (session supersede E3, idempotent re-entry E7, bounded
// retry E5, method restoration E2). Kept here:
//   - the "reading copy never mounts" invariants (B4-1/B4-9), which remain a
//     real unified-build contract ("M1 副本绝不出现", controller E1);
//   - double-injection idempotency (B4-8), converted to the adapter build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, makeStatusId } from "./native-env.mjs";

const waitMs = 20_000;

test("B4-1 进入 A 后立即返回首页：旧构建任务立即失效，阅读副本永不挂载", async () => {
  const env = makeEnv();
  env.boot();
  const idA = makeStatusId();
  await env.navigate(`/somebody/status/${idA}`);
  await env.timers.advance(200);
  await env.navigate("/home");
  await env.timers.advance(waitMs + 80_000);
  assert.equal(env.panes(), 0, "no pane after leaving the detail page");
  assert.equal(env.style(), null, "no style residue");
  assert.equal(env.document.documentElement.getAttribute("data-peek-native"), null);
  await env.timers.advance(waitMs);
  assert.equal(env.panes(), 0);
});

test("B4-8 扩展重复注入：幂等，路由观察链只有一条，适配器会话唯一", async () => {
  const env = makeEnv();
  env.boot();
  const pendingAfterFirst = env.timers.pendingCount;
  env.boot(); // second injection must be a no-op (install guard)
  assert.equal(env.timers.pendingCount, pendingAfterFirst, "no second observation chain");
  const idA = makeStatusId();
  await env.pushNavigate(`/somebody/status/${idA}`);
  await env.timers.advance(1_500);
  assert.equal(env.pane(), null, "reading copy never mounts (adapter build)");
  const snap = env.poc.layoutAdapter.sessionSnapshot();
  assert.equal(snap?.attempts, 1, "exactly one install session despite double injection");
});

test("B4-9 卸载后无旧计时任务重新挂载 UI", async () => {
  const env = makeEnv();
  env.boot();
  const idA = makeStatusId();
  await env.pushNavigate(`/somebody/status/${idA}`);
  await env.timers.advance(1_500);
  await env.navigate("/home");
  await env.timers.advance(180_000);
  assert.equal(env.panes(), 0);
  assert.equal(env.timers.pendingCount <= 2, true, "only the route-watch chain remains");
});
