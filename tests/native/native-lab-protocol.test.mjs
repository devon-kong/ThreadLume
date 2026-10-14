// M2-B2-A S6 tests — protocol hardening: the gen-continuation ADOPTION branch
// is removed from the ISOLATED controller. Any same-focus autonomous
// notification with a gen HIGHER than the held session's is now foreign:
// never adopted, never acted on while the session is active. Since the
// M2-B1-R remediation MAIN keeps one generation across internal re-installs
// (adapter-core `continuesSession`), so legitimate continued-session events
// match `ours` exactly — verified here end-to-end alongside the adversarial
// cases (a same-origin page script forging HEALTH_* messages).
//
// Threat being closed (reviewer note, M2-B1-R): forge HEALTH_ACTIVE{gen: s.gen+N}
// → controller adopts N → the REAL session's later HEALTH_ERROR{gen: s.gen} is
// dropped as foreign → split CSS leaks until the next route change.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeEnv, labSource, mainWorldSource, buildCell, makeStatusId,
} from "./native-env.mjs";
import { LAD_KEY, LAD_NS, LAD_FROM_MAIN } from "../../native-extension/src/layout-adapter/constants.js";

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

function installTransport(env) {
  const sent = [];
  env.window.postMessage = (data) => {
    sent.push(data);
    const ev = new env.window.MessageEvent("message", { source: env.window, origin: ORIGIN, data });
    queueMicrotask(() => env.window.dispatchEvent(ev));
  };
  return sent;
}

// A raw same-origin dispatch, exactly what a hostile page script can do after
// reading ONE real adapter message (it knows the namespace + from markers —
// they are not secrets): event.source === window, correct origin, real
// ns/from. Correlation must stay bookkeeping, never authentication.
const forge = (env, data) => {
  const ev = new env.window.MessageEvent("message", {
    source: env.window, origin: ORIGIN,
    data: { ns: LAD_NS, from: LAD_FROM_MAIN, ...data },
  });
  env.window.dispatchEvent(ev);
};

function makeLabEnv() {
  const focusId = makeStatusId();
  const env = makeEnv({ url: `/somebody/status/${focusId}`, src: "lab" });
  const sent = installTransport(env);
  env.bootScript(mainWorldSource());
  const poc = env.boot();
  const fixture = mountDetailPage(env, { focusId });
  return { env, poc, sent, focusId, fixture, lad: env.ladTest() };
}

const ladStyle = (env) => Boolean(env.document.getElementById("peek-lad-style"));
const stateAttr = (env) => env.document.documentElement.getAttribute("data-peek-lad-state");
const session = (poc) => poc.layoutAdapter.sessionSnapshot();

// Active the session through the real route flow (browser back/forward not
// needed here): boot with the detail URL → route tick builds the session.
async function activeSession(env) {
  // boot already ran on the detail URL; the initial buildReader ran at boot,
  // but the route observer only fires on changes — drive onDetailRoute like
  // the real initial-entry path does.
  env.poc.layoutAdapter.onDetailRoute(env.location.pathname.match(/status\/(\d+)/)[1]);
  await realSleep(5);
}

test("Q1 正常链路不回归：内部重装 HEALTH_ACTIVE（同代次）→ 会话保持、CSS 保持", async () => {
  const { env, poc, focusId, fixture, lad } = makeLabEnv();
  await activeSession(env);
  assert.equal(lad.query().phase, "active");
  const gen = session(poc).gen;
  assert.equal(typeof gen, "number");
  assert.equal(ladStyle(env), true);

  // instance replaced underneath the adapter → internal reinstall (real flow)
  fixture.cell.remove();
  const v2 = makeVirtualizer();
  v2.setList([{ id: focusId }, { id: "reply-0" }]);
  const { cell: cell2 } = buildCell({ statusId: focusId });
  env.document.body.appendChild(cell2);
  cell2.__reactFiber$peekTest = { stateNode: v2.instance, return: null };
  v2.cells.set(focusId, { getElement: () => cell2 });
  v2.showAll();
  lad.healthTick();

  assert.equal(lad.query().phase, "active", "internal reinstall succeeded");
  assert.equal(session(poc).gen, gen, "gen continuity: SAME generation across the reinstall");
  assert.equal(ladStyle(env), true, "session alive, CSS stays");
  void poc;
});

test("Q2 伪造更高代次的 HEALTH_ACTIVE 不被收养；随后伪造的 HEALTH_ERROR 不生效", async () => {
  const { env, poc, focusId } = makeLabEnv();
  await activeSession(env);
  const gen = session(poc).gen;
  assert.equal(ladStyle(env), true);

  forge(env, { type: "HEALTH_ACTIVE", gen: gen + 5, reqNonce: null, focusUrlId: focusId, note: "forged" });
  assert.equal(session(poc).gen, gen, "higher gen is foreign — never adopted");
  assert.equal(ladStyle(env), true, "session unaffected");
  assert.equal(stateAttr(env), "active");

  forge(env, { type: "HEALTH_ERROR", gen: gen + 5, reqNonce: null, focusUrlId: focusId, reason: "forged-exit" });
  assert.equal(ladStyle(env), true, "forged exit must NOT tear the live session down");
  assert.equal(stateAttr(env), "active");

  // the real session's own health tick keeps working after the forgeries
  env.ladTest().healthTick();
  assert.equal(env.ladTest().query().phase, "active");
  assert.equal(ladStyle(env), true);
});

test("Q3 真实代次的 HEALTH_ERROR 仍然可靠退出（回归）", async () => {
  const { env, poc, focusId } = makeLabEnv();
  await activeSession(env);
  const gen = session(poc).gen;

  forge(env, { type: "HEALTH_ERROR", gen, reqNonce: null, focusUrlId: focusId, reason: "shape-drift" });
  assert.equal(ladStyle(env), false, "genuine main self-exit tears the split down");
  assert.equal(stateAttr(env), "failed");
});

test("Q4 旧代次 HEALTH_ACTIVE（active 会话）→ 不收养、不释放", async () => {
  const { env, poc, focusId, sent } = makeLabEnv();
  await activeSession(env);
  const gen = session(poc).gen;

  forge(env, { type: "HEALTH_ACTIVE", gen: gen - 1, reqNonce: null, focusUrlId: focusId });
  assert.equal(session(poc).gen, gen);
  assert.equal(ladStyle(env), true);
  assert.equal(sent.filter((m) => m.type === "UNINSTALL" && m.reason === "stale-health-event").length, 0,
    "an active session is never clobbered by a stale event");
});

test("Q5 非活跃会话收到异代次事件 → stale 释放路径保持可用", async () => {
  const { env, poc, focusId, sent } = makeLabEnv();
  await activeSession(env);
  const gen = session(poc).gen;
  // leave the route: the controller tears its session down (no live wrap to protect)
  poc.layoutAdapter.offRoute();
  await realSleep(5);
  assert.equal(ladStyle(env), false);

  forge(env, { type: "HEALTH_ACTIVE", gen: gen + 9, reqNonce: null, focusUrlId: focusId });
  assert.ok(sent.some((m) => m.type === "UNINSTALL" && m.reason === "stale-health-event" && m.focusUrlId === focusId),
    "non-active session: the stale-event release path still orders orphans released");
  assert.equal(session(poc), null, "and still no session to adopt into");
});

test("R1 回放的 ACTIVE（active 会话）被忽略：绝不释放活的包装（Review P3）", async () => {
  const { env, poc, sent, focusId } = makeLabEnv();
  await activeSession(env);
  const gen = session(poc).gen;
  const activeMsg = sent.find((m) => m.type === "ACTIVE" && m.gen === gen);
  assert.ok(activeMsg, "a real ACTIVE was observed on the transport");
  const uninstallBefore = sent.filter((m) => m.type === "UNINSTALL").length;
  // replay it verbatim, like a same-origin script that observed one real message
  const ev = new env.window.MessageEvent("message", {
    source: env.window, origin: ORIGIN,
    data: { ns: LAD_NS, from: LAD_FROM_MAIN, ...activeMsg },
  });
  env.window.dispatchEvent(ev);
  await realSleep(5);
  assert.equal(sent.filter((m) => m.type === "UNINSTALL").length, uninstallBefore,
    "a replayed ACTIVE must not order the live wrap released");
  assert.equal(session(poc).phase, "active", "live session untouched");
  assert.equal(ladStyle(env), true, "split CSS stays");
  void focusId;
});

test("R2 迟到 ACTIVE（failed/dormant 会话）仍释放孤儿包装（E6 语义保留）", async () => {
  const { env, poc, sent, focusId } = makeLabEnv();
  await activeSession(env);
  const activeMsg = sent.find((m) => m.type === "ACTIVE");
  poc.layoutAdapter.offRoute(); // controller session gone (dormant/none)
  await realSleep(5);
  const ev = new env.window.MessageEvent("message", {
    source: env.window, origin: ORIGIN,
    data: { ns: LAD_NS, from: LAD_FROM_MAIN, ...activeMsg },
  });
  env.window.dispatchEvent(ev);
  await realSleep(5);
  assert.equal(session(poc), null);
  void focusId;
});

test("Q6 无焦点字段的伪造事件不产生无限定释放（A12 回归）", async () => {
  const { env, poc, sent } = makeLabEnv();
  await activeSession(env);
  const gen = session(poc).gen;
  poc.layoutAdapter.offRoute();

  forge(env, { type: "HEALTH_ACTIVE", gen: gen + 9, reqNonce: null });
  assert.equal(sent.filter((m) => m.type === "UNINSTALL" && !m.focusUrlId).length, 0,
    "a focusless forgery must never become an unqualified release");
});
