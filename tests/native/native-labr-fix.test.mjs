// M2-B1-R targeted regression tests — the four defect classes from the round
// directive, exercised against the REAL built lab artifacts:
//   A  P0-A message protocol: request/response vs autonomous HEALTH_* family,
//      session correlation { gen, focusUrlId }, ACTIVE integrity check, and
//      the headline fix: a MAIN-world self-exit MUST reach the ISOLATED
//      controller and tear the split layout down in the same delivery tick.
//   B  P1-A residue lock: a restore that throws/verifies-false enters
//      RESIDUE_LOCKED — lastError never overwritten, references retained,
//      every later INSTALL refused, X keeps rendering through the wrapper's
//      passthrough, and the state is reported honestly (never as a recovery).
//   C  P1-B same-cell article replacement: marker re-binds only onto an
//      article proven to still be the focus; unconfirmable ⇒ safe exit;
//      video nodes are never touched.
//   D  P1-C theme observer loop-freedom: self-echo dropped, identical values
//      never re-written, quiescence after external churn, exact inline-var
//      restoration (value + priority) on teardown.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeEnv, labSource, mainWorldSource, buildCell, makeStatusId,
} from "./native-env.mjs";
import { LAD_KEY, LAD_MARK_ARTICLE, LAD_ARTICLE_GONE_MS } from "../../native-extension/src/layout-adapter/constants.js";

const ORIGIN = "https://x.com";
const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- fixtures (same shape as the S2/S3 suites: probe-verified X stand-in) ----

function makeVirtualizer({ ownDataDescriptor = false } = {}) {
  const list = [];
  const cells = new Map();
  let rendered = [];
  const proto = { _getFinalRenderedItems() { return rendered.slice(); } };
  const instance = ownDataDescriptor ? {} : Object.create(proto);
  if (ownDataDescriptor) {
    // non-writable own data property: restore must re-apply the EXACT saved
    // descriptor (defineProperty), not a plain assign (contract §4.6)
    Object.defineProperty(instance, LAD_KEY, {
      value: proto._getFinalRenderedItems, writable: false, enumerable: true, configurable: true,
    });
  }
  Object.defineProperty(instance, "props", { value: { list }, writable: true, enumerable: true, configurable: true });
  instance._cells = cells;
  const entryFor = (item, offset = 0) => ({ item, offset, visible: true, key: item.id, height: 100 });
  return {
    instance, list, cells,
    get rendered() { return rendered; },
    set rendered(v) { rendered = v; },
    showReplies(from, to) { rendered = list.slice(from, to).map((item, i) => entryFor(item, (from + i) * 100)); },
    showAll() { this.showReplies(0, list.length); },
    setList(items) { list.length = 0; list.push(...items); },
  };
}

function mountFocalCell(env, { focusId, virtualizer }) {
  const { cell, art } = buildCell({ statusId: focusId });
  env.document.body.appendChild(cell);
  cell.__reactFiber$peekTest = { stateNode: virtualizer.instance, return: null };
  virtualizer.cells.set(focusId, { getElement: () => cell });
  return { cell, art };
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

// An article element whose own timestamp link terminates in `statusId`.
function buildArticleEl(env, statusId) {
  const art = env.document.createElement("article");
  art.setAttribute("data-testid", "tweet");
  const a = env.document.createElement("a");
  a.setAttribute("href", `/somebody/status/${statusId}`);
  const time = env.document.createElement("time");
  time.setAttribute("datetime", "2026-10-13T10:00:00.000Z");
  a.appendChild(time);
  art.appendChild(a);
  return art;
}

// MAIN-world-only environment (adapter core + entry, no controller).
function makeMainEnv({ replyCount = 12, ownDataDescriptor = false } = {}) {
  const focusId = makeStatusId();
  const env = makeEnv({ url: `/somebody/status/${focusId}` });
  const sent = installTransport(env);
  env.bootScript(mainWorldSource());
  const lad = env.ladTest();
  assert.ok(lad, "MAIN test hook must be armed");
  const virtualizer = makeVirtualizer({ ownDataDescriptor });
  virtualizer.setList([{ id: focusId }, ...Array.from({ length: replyCount }, (_, i) => ({ id: `reply-${i}` }))]);
  const { cell, art } = mountFocalCell(env, { focusId, virtualizer });
  virtualizer.showAll();
  return { env, lad, virtualizer, focusId, cell, art, sent };
}

// Dual-world environment (real MAIN artifact + real ISOLATED artifact, one window).
function makeLabEnv({ withFixture = true, bootMain = true } = {}) {
  const focusId = makeStatusId();
  const env = makeEnv({ url: `/somebody/status/${focusId}`, src: "lab" });
  const sent = installTransport(env);
  if (bootMain) env.bootScript(mainWorldSource());
  const poc = env.boot();
  const fixture = withFixture
    ? (() => {
      const virtualizer = makeVirtualizer();
      virtualizer.setList([{ id: focusId }, ...Array.from({ length: 20 }, (_, i) => ({ id: `reply-${i}` }))]);
      const { cell, art } = mountFocalCell(env, { focusId, virtualizer });
      virtualizer.showAll();
      return { virtualizer, cell, art };
    })()
    : null;
  return { env, poc, sent, focusId, fixture, lad: env.ladTest() };
}

const ladStyle = (env) => Boolean(env.document.getElementById("peek-lad-style"));
const htmlAttr = (env) => env.document.documentElement.getAttribute("data-peek-lad");
const stateAttr = (env) => env.document.documentElement.getAttribute("data-peek-lad-state");
const failedAttr = (env) => env.document.documentElement.getAttribute("data-peek-lad-failed");

// ============================================================
// A. P0-A — autonomous notifications reach the controller
// ============================================================

test("A1 INSTALL→ACTIVE：gen 关联下发，控制器记录会话代次", async () => {
  const { env, poc, sent, focusId, fixture } = makeLabEnv({});
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await realSleep(5);
  assert.equal(stateAttr(env), "active");
  assert.equal(ladStyle(env), true);
  const snap = poc.layoutAdapter.sessionSnapshot();
  assert.equal(snap.phase, "active");
  assert.equal(typeof snap.gen, "number", "controller stored the MAIN session generation");
  const active = sent.find((m) => m.type === "ACTIVE");
  assert.equal(active.gen, snap.gen, "ACTIVE response carries the session generation");
  assert.equal(active.reqNonce, active.nonce, "response correlates to its own request nonce");
});

test("A2 [P0 头条] MAIN 自主退出（形状漂移）→ HEALTH_ERROR 到达 → 双栏 CSS 同拍移除", async () => {
  const { env, poc, sent, focusId, fixture, lad } = makeLabEnv({});
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await realSleep(5);
  assert.equal(ladStyle(env), true, "precondition: layout mounted");
  // X replaces the wrapped method underneath the adapter
  fixture.virtualizer.instance[LAD_KEY] = function () { return []; };
  lad.healthTick();
  await realSleep(5); // message delivery (microtask transport)
  // THE FIX: the controller MUST have processed the autonomous exit
  assert.equal(ladStyle(env), false, "split CSS removed in the same delivery window");
  assert.equal(htmlAttr(env), null);
  assert.equal(stateAttr(env), "failed");
  assert.equal(failedAttr(env), "wrapper-replaced");
  assert.equal(poc.layoutAdapter.sessionSnapshot().phase, "failed", "no longer ACTIVE");
  assert.ok(sent.some((m) => m.type === "HEALTH_ERROR" && m.reason === "wrapper-replaced"));
  // X's native single column is intact: X's own replacement method is untouched
  assert.equal(fixture.art.hasAttribute(LAD_MARK_ARTICLE), false);
  fixture.virtualizer.instance[LAD_KEY] = fixture.virtualizer.instance[LAD_KEY]; // identity as X left it
  fixture.virtualizer.instance[LAD_KEY] = function () { return ["x-owns-this"]; };
  assert.deepEqual(fixture.virtualizer.instance[LAD_KEY](), ["x-owns-this"],
    "X's newer method answers calls — the wrapper never came back");
});

test("A3 旧代次 HEALTH_ERROR 迟到：不干扰新 ACTIVE 会话", async () => {
  const { env, poc, sent, focusId, fixture, lad } = makeLabEnv({});
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await realSleep(5);
  const gen = poc.layoutAdapter.sessionSnapshot().gen;
  // a forged/stale notification from an older generation (same focus id)
  env.window.postMessage({
    ns: "peek-lad", from: "main", type: "HEALTH_ERROR",
    gen: gen - 1, reqNonce: null, focusUrlId: focusId, reason: "stale-generation",
  }, ORIGIN);
  await realSleep(5);
  assert.equal(stateAttr(env), "active", "new session untouched");
  assert.equal(ladStyle(env), true);
  assert.equal(poc.layoutAdapter.sessionSnapshot().phase, "active");
  // and it must NOT have ordered an UNINSTALL against the live session's focus
  assert.equal(sent.filter((m) => m.type === "UNINSTALL" && m.focusUrlId === focusId).length, 0,
    "stale events never clobber the live wrap");
  void lad;
});

test("A4 错误焦点/错误代次的自主通知被拒绝，并按需定向释放", async () => {
  const { env, poc, sent, focusId } = makeLabEnv({});
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await realSleep(5);
  const gen = poc.layoutAdapter.sessionSnapshot().gen;
  // wrong focus id, right gen
  env.window.postMessage({ ns: "peek-lad", from: "main", type: "HEALTH_ERROR", gen, reqNonce: null, focusUrlId: "999", reason: "x" }, ORIGIN);
  await realSleep(5);
  assert.equal(stateAttr(env), "active", "wrong-focus event rejected");
  // right focus, wrong gen
  env.window.postMessage({ ns: "peek-lad", from: "main", type: "HEALTH_ERROR", gen: gen + 5, reqNonce: null, focusUrlId: focusId, reason: "x" }, ORIGIN);
  await realSleep(5);
  assert.equal(stateAttr(env), "active", "wrong-gen event rejected");
  void poc;
});

test("A5 伪造/异常 ACTIVE（无焦点标记）：控制器拒绝挂载布局", async () => {
  const focusId = makeStatusId();
  const env = makeEnv({ url: `/somebody/status/${focusId}`, src: "lab" });
  installTransport(env);
  env.bootScript(mainWorldSource());
  const poc = env.boot();
  // NO fixture: the controller's integrity check must refuse to mount the
  // split CSS even though MAIN answered ACTIVE (spoofed or mis-marked state)
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await env.timers.advance(3400); // bounded retry budget (12 × 250ms) exhausts
  assert.equal(ladStyle(env), false, "no split CSS without a verified focal marker");
  assert.equal(poc.layoutAdapter.sessionSnapshot().phase, "failed");
  assert.equal(failedAttr(env), "focal-cell-not-found");
});

test("A6 MAIN 失联：ack 超时一次判失败，无重试风暴", async () => {
  const focusId = makeStatusId();
  const env = makeEnv({ url: `/somebody/status/${focusId}`, src: "lab" });
  installTransport(env);
  const poc = env.boot(); // no MAIN artifact: the ack timeout path
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await env.timers.advance(1250);
  assert.equal(poc.layoutAdapter.sessionSnapshot().phase, "failed");
  assert.equal(poc.layoutAdapter.sessionSnapshot().attempts, 1, "exactly one attempt — retrying cannot help");
  await env.timers.advance(5000);
  assert.equal(poc.layoutAdapter.sessionSnapshot().attempts, 1, "no retry storm after failure");
});

test("A7 HEALTH_UNINSTALLED（路由自检）→ dormant 而非 failed", async () => {
  const { env, poc, focusId, fixture, lad } = makeLabEnv({});
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await realSleep(5);
  assert.equal(ladStyle(env), true);
  env.location.pathname = "/home";
  env.location.href = "https://x.com/home";
  lad.healthTick(); // MAIN detects the route moved on its own
  await realSleep(5);
  assert.equal(ladStyle(env), false, "layout released");
  assert.equal(stateAttr(env), "idle", "clean exit is NOT a failure");
  assert.equal(failedAttr(env), null);
  const phase = poc.layoutAdapter.sessionSnapshot()?.phase ?? null;
  assert.ok(phase === "dormant" || phase === null,
    `clean exit: dormant (controller saw it first) or released (carrier route tick won) — got ${phase}`);
  assert.notEqual(phase, "active");
  assert.notEqual(phase, "failed");
  assert.equal(fixture.art.hasAttribute(LAD_MARK_ARTICLE), false);
});

test("A8 页面切换期乱序（旧 ACTIVE / 旧 ERROR 迟到）：无残留布局", async () => {
  const { env, poc, sent, focusId, fixture } = makeLabEnv({});
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await realSleep(5);
  const oldNonce = sent.find((m) => m.type === "INSTALL").nonce;
  const oldGen = poc.layoutAdapter.sessionSnapshot().gen;
  // navigate away and immediately start a new session for another focus
  const focus2 = makeStatusId();
  await env.pushNavigate(`/other/status/${focus2}`);
  // stale, out-of-order traffic from session 1 arriving AFTER the switch
  env.window.postMessage({ ns: "peek-lad", from: "main", type: "ACTIVE", nonce: oldNonce, gen: oldGen, focusUrlId: focusId }, ORIGIN);
  env.window.postMessage({ ns: "peek-lad", from: "main", type: "HEALTH_ERROR", gen: oldGen, reqNonce: null, focusUrlId: focusId, reason: "late" }, ORIGIN);
  await realSleep(5);
  const snap = poc.layoutAdapter.sessionSnapshot();
  assert.equal(snap.focusUrlId, focus2, "session 2 owns the controller");
  assert.equal(ladStyle(env), false, "no layout until session 2 is really ACTIVE");
  // session 2 installs cleanly afterwards
  const v2 = makeVirtualizer();
  v2.setList([{ id: focus2 }, { id: "r1" }]);
  const { cell, art } = mountFocalCell(env, { focusId: focus2, virtualizer: v2 });
  v2.showAll();
  void cell; void art;
  await env.timers.advance(2000); // bounded UNSUPPORTED→retry loop lands the install
  await realSleep(5);
  assert.equal(poc.layoutAdapter.sessionSnapshot().phase, "active", "new session reached ACTIVE");
  assert.equal(ladStyle(env), true);
});

test("A9 路由离开：包装、观察器、自有 CSS 全部清零", async () => {
  const { env, poc, sent, focusId, fixture, lad } = makeLabEnv({});
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await realSleep(5);
  env.location.pathname = "/home";
  env.location.href = "https://x.com/home";
  poc.layoutAdapter.offRoute();
  await realSleep(5);
  assert.equal(ladStyle(env), false);
  assert.equal(htmlAttr(env), null);
  assert.equal(fixture.art.hasAttribute(LAD_MARK_ARTICLE), false, "MAIN released the wrap + marker");
  const q = lad.query();
  assert.equal(q.phase, "idle");
  assert.equal(Object.getOwnPropertyDescriptor(fixture.virtualizer.instance, LAD_KEY), undefined,
    "prototype-owned wrap fully removed");
  const un = sent.filter((m) => m.type === "UNINSTALL").pop();
  assert.equal(un.focusUrlId, focusId, "release command names its focus");
});

test("A10 [Review 补证] 内部重装成功 → 同路由自主退出：gen 连续、HEALTH_ERROR 必达、CSS 必移除", async () => {
  const { env, poc, focusId, fixture, lad } = makeLabEnv({});
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await realSleep(5);
  const gen0 = poc.layoutAdapter.sessionSnapshot().gen;
  assert.equal(typeof gen0, "number");
  assert.equal(lad.query().gen, gen0, "controller mirrors MAIN gen");
  // X replaces the virtualizer instance underneath the adapter
  fixture.cell.remove();
  const v2 = makeVirtualizer();
  v2.setList([{ id: focusId }, ...Array.from({ length: 10 }, (_, i) => ({ id: `r-${i}` }))]);
  const { cell: cell2 } = mountFocalCell(env, { focusId, virtualizer: v2 });
  v2.showAll();
  void cell2;
  lad.healthTick(); // internal re-install on the new instance
  await realSleep(5);
  assert.equal(lad.query().phase, "active", "reinstall landed");
  const gen1 = lad.query().gen;
  assert.equal(gen1, gen0, "internal re-install CONTINUES the session generation (no drift)");
  assert.equal(poc.layoutAdapter.sessionSnapshot().gen, gen1, "controller gen synced via HEALTH_ACTIVE");
  // same-route structural drift on the NEW instance
  const xsNewest = function () { return []; };
  v2.instance[LAD_KEY] = xsNewest;
  lad.healthTick();
  await realSleep(5);
  assert.equal(ladStyle(env), false, "split CSS removed after reinstall-then-self-exit (P0 symptom must not recur)");
  assert.equal(htmlAttr(env), null);
  assert.equal(stateAttr(env), "failed");
  assert.equal(lad.query().phase, "error");
  assert.equal(v2.instance[LAD_KEY], xsNewest, "X's newer method untouched (already-replaced path never clobbers)");
});

test("A11 [M2-B2-A S6] 同焦点更高 gen 的 HEALTH_ACTIVE：绝不收养，伪造退出链失效，真实会话仍可靠退出", async () => {
  const { env, poc, sent, focusId, fixture, lad } = makeLabEnv({});
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await realSleep(5);
  const gen = poc.layoutAdapter.sessionSnapshot().gen;
  env.window.postMessage({ ns: "peek-lad", from: "main", type: "HEALTH_ACTIVE", gen: gen + 1, reqNonce: null, focusUrlId: focusId, note: "reinstalled" }, ORIGIN);
  await realSleep(5);
  assert.equal(stateAttr(env), "active");
  assert.equal(poc.layoutAdapter.sessionSnapshot().gen, gen,
    "M2-B2-A: a higher gen is by definition not this session — no adoption (spoof cannot strand the real session's exit)");
  // the forged continuation's later exit is foreign to the live session: dropped
  env.window.postMessage({ ns: "peek-lad", from: "main", type: "HEALTH_ERROR", gen: gen + 1, reqNonce: null, focusUrlId: focusId, reason: "forged-continued-exit" }, ORIGIN);
  await realSleep(5);
  assert.equal(stateAttr(env), "active", "forged higher-gen exit never tears a live session down");
  assert.equal(ladStyle(env), true);
  assert.equal(sent.filter((m) => m.type === "UNINSTALL" && m.reason === "stale-health-event").length, 0,
    "an active session is never clobbered by foreign events");
  // the REAL session keeps exiting reliably through its OWN generation — the
  // safety property A11 originally guarded, now carried by gen continuity (A10)
  fixture.virtualizer.instance[LAD_KEY] = function () { return []; };
  lad.healthTick(); // real shape drift → real self-exit at the real gen
  await realSleep(5);
  assert.equal(stateAttr(env), "failed", "real session's own exit is honored");
  assert.equal(ladStyle(env), false);
});

test("A12 [加固] 无焦点字段的伪造事件：绝不发出无限定释放命令", async () => {
  const { env, poc, sent, focusId, fixture, lad } = makeLabEnv({});
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await realSleep(5);
  // drive the session into a failed state so the stale-release branch is armed
  fixture.virtualizer.instance[LAD_KEY] = function () { return []; };
  lad.healthTick();
  await realSleep(5);
  assert.equal(stateAttr(env), "failed");
  const uninstallCount = sent.filter((m) => m.type === "UNINSTALL").length;
  // spoofed autonomous event WITHOUT focusUrlId
  env.window.postMessage({ ns: "peek-lad", from: "main", type: "HEALTH_ERROR", gen: 999, reqNonce: null, reason: "spoofed" }, ORIGIN);
  await realSleep(5);
  assert.equal(sent.filter((m) => m.type === "UNINSTALL").length, uninstallCount,
    "no unqualified UNINSTALL may be synthesized from a focus-less spoofed event");
  void poc;
});

// ============================================================
// B. P1-A — residue lock
// ============================================================

function lockResidueScenario({ viaHealthExit = false, ownData = false } = {}) {
  const { env, lad, virtualizer, focusId, cell, art, sent } = makeMainEnv({ ownDataDescriptor: ownData });
  lad.install({ focusUrlId: focusId });
  const wrapper = virtualizer.instance[LAD_KEY];
  // X hardens the property between install and uninstall (configurable:false):
  // own-data restore re-applies the saved descriptor → defineProperty THROWS;
  // prototype restore deletes the shadow → silently fails verification.
  // Both are genuine residue conditions.
  Object.defineProperty(virtualizer.instance, LAD_KEY, {
    value: wrapper, writable: true, enumerable: false, configurable: false,
  });
  if (viaHealthExit) {
    env.location.pathname = "/home";
    env.location.href = "https://x.com/home";
    lad.healthTick(); // route-moved → doUninstall → restore throws
  } else {
    lad.uninstall({ reason: "requested" });
  }
  return { env, lad, virtualizer, focusId, cell, art, sent, wrapper };
}

test("B1a 恢复抛异常（own-data）→ RESIDUE_LOCKED：lastError 不被退出原因覆盖", () => {
  const { lad, virtualizer, sent } = lockResidueScenario({ viaHealthExit: true, ownData: true });
  const q = lad.query();
  assert.equal(q.phase, "residue-locked");
  assert.equal(q.lastError, "restore-threw", "the restore failure is the truth — never overwritten by route-moved");
  assert.equal(q.possibleResidue, true);
  assert.equal(q.residueLock.reason, "restore-threw");
  assert.equal(q.residueLock.focusUrlId, lad.query().focusUrlId);
  assert.equal(q.residueLock.hasWrapper, true, "diagnostic references retained");
  const err = sent.find((m) => m.type === "HEALTH_ERROR");
  assert.equal(err.reason, "restore-threw", "wire reason is the restore failure");
  assert.equal(err.exitReason, "route-moved", "the trigger is reported as exitReason");
  assert.equal(err.restored, false);
  void virtualizer;
});

test("B1b 恢复校验失败（prototype delete 静默失败）→ 同样 RESIDUE_LOCKED", () => {
  const { lad, virtualizer, sent } = lockResidueScenario({ viaHealthExit: true });
  const q = lad.query();
  assert.equal(q.phase, "residue-locked");
  assert.equal(q.lastError, "restore-verify-failed");
  assert.equal(q.possibleResidue, true);
  const err = sent.find((m) => m.type === "HEALTH_ERROR");
  assert.equal(err.reason, "restore-verify-failed");
  assert.equal(err.restored, false, "honestly reported: NOT presented as a recovery");
  assert.equal(typeof virtualizer.instance[LAD_KEY], "function", "wrap still physically present — never hidden");
});

test("B2 残留状态拒绝一切新 INSTALL，且不重复包装", () => {
  const { lad, virtualizer, focusId, wrapper } = lockResidueScenario({});
  const r = lad.install({ focusUrlId: focusId });
  assert.equal(r.type, "ERROR");
  assert.equal(r.reason, "residue-locked");
  const desc = Object.getOwnPropertyDescriptor(virtualizer.instance, LAD_KEY);
  assert.equal(desc.value, wrapper, "the ORIGINAL wrapper is still the only wrapper — no re-wrap stack");
  assert.equal(desc.configurable, false, "X's hardened shape untouched");
  // even a different focus id is refused: the page is locked until reload
  const r2 = lad.install({ focusUrlId: makeStatusId() });
  assert.equal(r2.reason, "residue-locked");
});

test("B3 残留状态下包装器直通：X 继续原生渲染", () => {
  const { lad, virtualizer, focusId } = lockResidueScenario({});
  assert.equal(lad.query().phase, "residue-locked");
  const out = virtualizer.instance[LAD_KEY]();
  assert.equal(Array.isArray(out), true);
  assert.equal(out.some((x) => x.item.id === focusId), true, "original items pass through untouched");
  assert.equal(virtualizer.rendered.length, out.length, "no injection in residue state");
});

test("B4 卸载请求到达残留会话：not-active，不重置锁", () => {
  const { lad } = lockResidueScenario({});
  const r = lad.uninstall({ reason: "requested" });
  assert.equal(r.type, "UNINSTALLED");
  assert.equal(r.note, "not-active");
  assert.equal(lad.query().phase, "residue-locked", "lock survives a redundant release");
});

test("B5 双 world：残留锁传播为请求级 ERROR，控制器回退单栏", async () => {
  const { env, poc, sent, focusId, fixture, lad } = makeLabEnv({});
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await realSleep(5);
  assert.equal(ladStyle(env), true);
  // MAIN hits restore failure on its next self-exit (shape drift while the
  // property was hardened by "X")
  const wrapper = fixture.virtualizer.instance[LAD_KEY];
  Object.defineProperty(fixture.virtualizer.instance, LAD_KEY, {
    value: wrapper, writable: true, enumerable: false, configurable: false,
  });
  fixture.virtualizer.instance._cells = undefined; // shape drift → safeExit
  lad.healthTick();
  await realSleep(5);
  assert.equal(ladStyle(env), false, "controller released the layout");
  assert.equal(stateAttr(env), "failed");
  assert.equal(lad.query().phase, "residue-locked");
  // a late re-install for the same route must be refused end-to-end
  const r = lad.install({ focusUrlId: focusId });
  assert.equal(r.reason, "residue-locked");
  void poc;
});

// ============================================================
// C. P1-B — same-cell article replacement
// ============================================================

test("C1 同 cell article 替换（仍是焦点）：重绑标记并清理旧标记", () => {
  const { env, lad, virtualizer, focusId, cell, art } = makeMainEnv({});
  lad.install({ focusUrlId: focusId });
  assert.equal(art.getAttribute(LAD_MARK_ARTICLE), "");
  const art2 = buildArticleEl(env, focusId);
  cell.replaceChild(art2, art);
  lad.verifyArticleBinding();
  assert.equal(art.hasAttribute(LAD_MARK_ARTICLE), false, "old article's marker cleaned");
  assert.equal(art2.getAttribute(LAD_MARK_ARTICLE), "", "marker re-bound onto the new article");
  assert.equal(lad.query().phase, "active");
  assert.equal(lad.query().stats.articleRebinds, 1);
  // retention still injects the focus on the SAME instance
  virtualizer.showReplies(5, 12);
  assert.equal(virtualizer.instance[LAD_KEY]()[0].item.id, focusId);
});

test("C2 替换进来的 article 不是焦点：安全退出而非错误保留", () => {
  const { env, lad, virtualizer, focusId, cell, art, sent } = makeMainEnv({});
  lad.install({ focusUrlId: focusId });
  const stranger = buildArticleEl(env, "1999999999999999999");
  cell.replaceChild(stranger, art);
  lad.verifyArticleBinding();
  assert.equal(lad.query().phase, "error");
  assert.equal(lad.query().lastError, "focal-article-replaced-unconfirmed");
  assert.equal(stranger.hasAttribute(LAD_MARK_ARTICLE), false, "never pin an article we cannot vouch for");
  assert.equal(art.hasAttribute(LAD_MARK_ARTICLE), false);
  assert.equal(Object.getOwnPropertyDescriptor(virtualizer.instance, LAD_KEY), undefined, "method restored");
  const err = sent.find((m) => m.type === "HEALTH_ERROR");
  assert.equal(err.reason, "focal-article-replaced-unconfirmed");
  assert.equal(lad.query().stats.articleRebindRefusals, 1);
});

test("C3 article 短暂缺失：容忍；超时未归：退出", () => {
  const { env, lad, virtualizer, focusId, cell, art } = makeMainEnv({});
  lad.install({ focusUrlId: focusId });
  art.remove(); // hydration gap: article momentarily absent
  lad.verifyArticleBinding();
  assert.equal(lad.query().phase, "active", "transient gap tolerated");
  // warp past the gone-budget and re-verify: bounded exit, no infinite wait
  const realNow = performance.now.bind(performance);
  performance.now = () => realNow() + LAD_ARTICLE_GONE_MS + 1;
  try { lad.verifyArticleBinding(); } finally { performance.now = realNow; }
  assert.equal(lad.query().phase, "error");
  assert.equal(lad.query().lastError, "focal-article-vanished");
  assert.equal(Object.getOwnPropertyDescriptor(virtualizer.instance, LAD_KEY), undefined);
});

test("C4 cell 观察器自动驱动重绑（无需等待 health tick）", async () => {
  const { env, lad, virtualizer, focusId, cell, art } = makeMainEnv({});
  lad.install({ focusUrlId: focusId });
  const art2 = buildArticleEl(env, focusId);
  cell.replaceChild(art2, art);
  assert.equal(art2.hasAttribute(LAD_MARK_ARTICLE), false, "not yet rebound");
  // MutationObserver (microtask during flush) schedules the 120ms debounce —
  // the harness clock is already at the window edge, so advance once more
  await env.timers.advance(300);
  await env.timers.advance(300);
  assert.equal(art2.getAttribute(LAD_MARK_ARTICLE), "", "observer-driven rebind");
  assert.equal(art.hasAttribute(LAD_MARK_ARTICLE), false);
  assert.equal(lad.query().phase, "active");
  void virtualizer;
});

test("C5 重绑只写属性：视频节点绝不移动/重建", () => {
  const { env, lad, focusId, cell, art } = makeMainEnv({});
  const video = env.document.createElement("video");
  art.appendChild(video);
  lad.install({ focusUrlId: focusId });
  const art2 = buildArticleEl(env, focusId);
  const video2 = env.document.createElement("video");
  art2.appendChild(video2);
  cell.replaceChild(art2, art);
  lad.verifyArticleBinding();
  assert.equal(art2.getAttribute(LAD_MARK_ARTICLE), "");
  assert.equal(video.isConnected, false, "old subtree untouched by us (removed by the fixture swap only)");
  assert.equal(video2.tagName, "VIDEO");
  assert.equal(video2.parentNode, art2, "no DOM moves performed by the adapter");
  void focusId;
});

test("C6 healthTick 内嵌重验：article 替换被 backstop 捕获", () => {
  const { env, lad, focusId, cell, art } = makeMainEnv({});
  lad.install({ focusUrlId: focusId });
  const stranger = buildArticleEl(env, "1888888888888888888");
  cell.replaceChild(stranger, art);
  env.timers.advance(0); // flush pending micro-timers
  lad.healthTick();
  assert.equal(lad.query().phase, "error");
  assert.equal(lad.query().lastError, "focal-article-replaced-unconfirmed");
  void env;
});

// ============================================================
// D. P1-C — theme observer loop-freedom
// ============================================================

test("D1 挂载写变量；随后外部变更触发的自回声被丢弃（不形成第二次写）", async () => {
  const { env, poc, focusId } = makeLabEnv({});
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await realSleep(5);
  const d0 = poc.layoutAdapter.themeDiagnostics();
  assert.equal(d0.watching, true);
  assert.ok(d0.writes >= 3, "bg/border/top written once each at mount");
  assert.equal(d0.selfEchoDrops, 0, "mount writes precede the observer — nothing echoed yet");
  // an external theme flip now produces writes whose echo MUST be dropped
  env.document.body.style.backgroundColor = "rgb(255, 255, 255)";
  await realSleep(10);
  const d = poc.layoutAdapter.themeDiagnostics();
  assert.ok(d.selfEchoDrops >= 1, "our own write's echo was dropped, not re-applied");
  assert.equal(d.inlineVars["--peek-lad-bg"], "#ffffff");
});

test("D2 相同值不重复写（值差异守卫）", async () => {
  const { env, poc, focusId } = makeLabEnv({});
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await realSleep(5);
  const before = poc.layoutAdapter.themeDiagnostics().writes;
  // X churns the root style (unrelated attributes) — theme vars stay identical
  for (let i = 0; i < 5; i++) {
    env.document.documentElement.style.setProperty("--peek-x-churn", String(i));
    await realSleep(5);
  }
  const d = poc.layoutAdapter.themeDiagnostics();
  assert.equal(d.writes, before, "no CSS variable re-written without a real change");
  assert.ok(d.skippedWrites >= 5, "identical values skipped");
});

test("D3 无外部变化时零回调：不存在自激无限更新", async () => {
  const { env, poc, focusId } = makeLabEnv({});
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await realSleep(5);
  const c0 = poc.layoutAdapter.themeDiagnostics().callbacks;
  for (let i = 0; i < 10; i++) await env.timers.advance(100); // pure idle time
  const d = poc.layoutAdapter.themeDiagnostics();
  assert.equal(d.callbacks, c0, "no observer activity without external mutations");
  assert.equal(d.writes, d.writes, "stable");
  assert.ok(d.callbacks <= 2, "total callback count stays bounded after mount");
});

test("D4 深浅切换：一次外部变更 → 恰好一轮更新", async () => {
  const { env, poc, focusId } = makeLabEnv({});
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await realSleep(5);
  const before = poc.layoutAdapter.themeDiagnostics().writes;
  env.document.body.style.backgroundColor = "rgb(255, 255, 255)"; // X paints light
  await realSleep(10);
  const d = poc.layoutAdapter.themeDiagnostics();
  assert.equal(d.inlineVars["--peek-lad-bg"], "#ffffff", "light palette applied");
  // M2-B2-B: the palette is now 7 vars (bg/border/fg/dim/hover/backdrop/shadow,
  // all differing between dark and light); top stays identical → skipped
  assert.equal(d.writes, before + 7, "exactly one pass: 7 palette vars change, top identical → no echo re-write");
  env.document.body.style.backgroundColor = "rgb(0, 0, 0)"; // back to dark
  await realSleep(10);
  assert.equal(poc.layoutAdapter.themeDiagnostics().inlineVars["--peek-lad-bg"], "#000000");
});

test("D5 清理恢复适配前的内联变量值与优先级", async () => {
  const focusId = makeStatusId();
  const env = makeEnv({ url: `/somebody/status/${focusId}`, src: "lab" });
  // the page already owns one of our variable names with a custom value
  env.document.documentElement.style.setProperty("--peek-lad-top", "99px", "important");
  installTransport(env);
  env.bootScript(mainWorldSource());
  const poc = env.boot();
  const virtualizer = makeVirtualizer();
  virtualizer.setList([{ id: focusId }, { id: "r1" }]);
  const { cell } = mountFocalCell(env, { focusId, virtualizer });
  virtualizer.showAll();
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await realSleep(5);
  assert.equal(ladStyle(env), true);
  assert.notEqual(env.document.documentElement.style.getPropertyValue("--peek-lad-top"), "99px", "adapter overrode while active");
  poc.layoutAdapter.offRoute();
  await realSleep(5);
  const style = env.document.documentElement.style;
  assert.equal(style.getPropertyValue("--peek-lad-top"), "99px", "pre-adapter value restored");
  assert.equal(style.getPropertyPriority("--peek-lad-top"), "important", "priority restored");
  assert.equal(style.getPropertyValue("--peek-lad-bg"), "", "adapter-created vars fully removed");
  assert.equal(style.getPropertyValue("--peek-lad-border"), "");
});

test("D6 错误/关闭路径同样清理观察器与变量", async () => {
  const { env, poc, focusId, fixture, lad } = makeLabEnv({});
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await realSleep(5);
  assert.equal(poc.layoutAdapter.themeDiagnostics().watching, true);
  fixture.virtualizer.instance[LAD_KEY] = function () { return []; }; // MAIN self-exit
  lad.healthTick();
  await realSleep(5);
  const d = poc.layoutAdapter.themeDiagnostics();
  assert.equal(d.watching, false, "observer disconnected on failure path");
  assert.equal(d.inlineVars["--peek-lad-bg"], "", "no adapter inline vars left behind");
  assert.equal(ladStyle(env), false);
});
