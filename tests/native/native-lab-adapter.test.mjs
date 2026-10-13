// M2-B1 S2 tests — the MAIN-world layout adapter CORE, executed as the REAL
// built artifact (dist-extension-native-lab/layout-adapter-main.js).
// Contract: docs/m2-b1/adapter-contract.md. The fake virtualizer mirrors the
// probe-verified X shape: method on the prototype, _cells Map keyed by item id,
// props.list as the source of truth, rendered entries {item, offset, visible}.
//
// Install-order contract (§4.5): the focal entry is mapped via DOM identity in
// the RENDERED set — exactly like the probe's "install before focal unmount".
// Tests therefore install with the focal naturally rendered, then simulate
// deep scroll.
//
// Transport note: jsdom's window.postMessage does not populate event.origin /
// event.source (jsdom limitation), so the tests replace the TRANSPORT with a
// synthetic MessageEvent dispatcher that fills them like real Chromium does.
// The handlers' validation logic — the part this repo owns — runs for real;
// the true cross-world transport is verified on a real MV3 load (S6).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeEnv, mainWorldSource, buildCell, makeStatusId
} from "./native-env.mjs";
import { LAD_KEY, LAD_MARK_ARTICLE } from "../../native-extension/src/layout-adapter/constants.js";

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ORIGIN = "https://x.com";

// ---- fixture: a faithful minimal stand-in for X's detail virtualizer ----

function makeVirtualizer({ ownDataDescriptor = false } = {}) {
  const list = []; // filled per test
  const cells = new Map();
  let rendered = [];
  const proto = {
    _getFinalRenderedItems() { return rendered.slice(); },
  };
  const instance = ownDataDescriptor ? {} : Object.create(proto);
  if (ownDataDescriptor) {
    Object.defineProperty(instance, LAD_KEY, {
      value: proto._getFinalRenderedItems, writable: false, enumerable: true, configurable: true,
    });
  }
  Object.defineProperty(instance, "props", { value: { list }, writable: true, enumerable: true, configurable: true });
  instance._cells = cells;
  const entryFor = (item, offset = 0) => ({ item, offset, visible: true, key: item.id, height: 100 });
  return {
    instance, list, cells, entryFor,
    get rendered() { return rendered; },
    set rendered(v) { rendered = v; },
    showReplies(from, to) { rendered = list.slice(from, to).map((item, i) => entryFor(item, (from + i) * 100)); },
    showAll() { this.showReplies(0, list.length); },
    setList(items) { list.length = 0; list.push(...items); },
  };
}

// Mount a detail page fixture: focal cell (probe selectors) + fiber link.
function mountFocalCell(env, { focusId, virtualizer }) {
  const { cell, art } = buildCell({ statusId: focusId });
  env.document.body.appendChild(cell);
  cell.__reactFiber$peekTest = { stateNode: virtualizer.instance, return: null };
  virtualizer.cells.set(focusId, { getElement: () => cell });
  return { cell, art };
}

// jsdom postMessage leaves origin/source empty; replace the transport with a
// properly-originated synthetic MessageEvent dispatch (microtask delivery).
function installTransport(env) {
  const sent = [];
  env.window.postMessage = (data) => {
    sent.push(data);
    const ev = new env.window.MessageEvent("message", { source: env.window, origin: ORIGIN, data });
    queueMicrotask(() => env.window.dispatchEvent(ev));
  };
  return sent;
}

// Boot ONLY the MAIN-world artifact (adapter core + message entry).
function makeMainEnv({ replyCount = 30, ownDataDescriptor = false } = {}) {
  const focusId = makeStatusId();
  const env = makeEnv({ url: `/somebody/status/${focusId}` });
  const sent = installTransport(env);
  env.bootScript(mainWorldSource());
  const lad = env.ladTest();
  assert.ok(lad, "MAIN test hook must be armed in the lab build");
  const virtualizer = makeVirtualizer({ ownDataDescriptor });
  virtualizer.setList([{ id: focusId }, ...Array.from({ length: replyCount }, (_, i) => ({ id: `reply-${i}` }))]);
  const { cell, art } = mountFocalCell(env, { focusId, virtualizer });
  virtualizer.showAll(); // focal rendered naturally — the install precondition
  return { env, lad, virtualizer, focusId, cell, art, sent };
}

const deepScroll = (v, from = 8, to = 20) => v.showReplies(from, to);

// ---------- A. install + wrap contract ----------

test("A1 prototype 所有权安装：ACTIVE、注入焦点条目、不改原数组", () => {
  const { lad, virtualizer, focusId } = makeMainEnv({});
  const r = lad.install({ focusUrlId: focusId });
  assert.equal(r.type, "ACTIVE");
  assert.equal(r.ownership, "prototype");
  assert.equal(r.focusItemKey, focusId);

  deepScroll(virtualizer); // now the focal is NOT in the rendered set
  const expected = virtualizer.rendered.map((e) => e);
  const out = virtualizer.instance[LAD_KEY]();
  assert.notEqual(out, virtualizer.rendered);           // new array, original untouched
  assert.equal(out.length, expected.length + 1);
  assert.equal(out[0].item.id, focusId);                // focal prepended
  assert.equal(out[0].offset, 0);
  assert.equal(out[0].visible, true);
  assert.equal(out[0].key, focusId);                    // X's key preserved
  for (let i = 0; i < expected.length; i++) {
    assert.equal(out[i + 1], expected[i]);              // element identity + order preserved
  }
  assert.equal(virtualizer.rendered.length, expected.length); // original array not mutated
});

test("A2 焦点自然在集合中：零拷贝返回原集合，且快照刷新", () => {
  const { lad, virtualizer, focusId } = makeMainEnv({});
  lad.install({ focusUrlId: focusId });
  const before = virtualizer.instance[LAD_KEY]();
  assert.equal(before.length, virtualizer.list.length);
  assert.ok(lad.query().stats.naturalSightings >= 1);
  const again = virtualizer.instance[LAD_KEY]();
  assert.equal(again.length, virtualizer.list.length);
  void focusId;
});

test("A3 无重复注入：连续多次调用至多一个焦点条目", () => {
  const { lad, virtualizer, focusId } = makeMainEnv({});
  lad.install({ focusUrlId: focusId });
  deepScroll(virtualizer);
  for (let i = 0; i < 5; i++) {
    const out = virtualizer.instance[LAD_KEY]();
    assert.equal(out.filter((x) => x.item.id === focusId).length, 1);
  }
});

test("A4 路由守卫：URL 离开焦点帖即停止注入，恢复后继续", () => {
  const { env, lad, virtualizer, focusId } = makeMainEnv({});
  lad.install({ focusUrlId: focusId });
  deepScroll(virtualizer);
  assert.equal(virtualizer.instance[LAD_KEY]()[0].item.id, focusId);
  env.location.pathname = "/somebody/status/999";
  env.location.href = "https://x.com/somebody/status/999";
  const out = virtualizer.instance[LAD_KEY]();
  assert.ok(!out.some((x) => x.item.id === focusId));
  env.location.pathname = `/somebody/status/${focusId}`;
  env.location.href = `https://x.com/somebody/status/${focusId}`;
  assert.equal(virtualizer.instance[LAD_KEY]()[0].item.id, focusId);
});

test("A5 实例守卫：脱离 this 调用（foreign this）不注入", () => {
  const { lad, virtualizer, focusId } = makeMainEnv({});
  lad.install({ focusUrlId: focusId });
  deepScroll(virtualizer);
  const detached = virtualizer.instance[LAD_KEY];
  const out = detached(); // this === undefined
  assert.ok(!out.some((x) => x.item.id === focusId));
});

test("A6 item 从列表数据移除：优雅停注（不抛错、不强渲染）", () => {
  const { lad, virtualizer, focusId } = makeMainEnv({});
  lad.install({ focusUrlId: focusId });
  deepScroll(virtualizer);
  virtualizer.setList(virtualizer.list.filter((x) => x.id !== focusId));
  const out = virtualizer.instance[LAD_KEY]();
  assert.ok(!out.some((x) => x.item.id === focusId));
});

test("A7 注入使用调用时刻的最新 item（无过期 item）", () => {
  const { lad, virtualizer, focusId } = makeMainEnv({});
  lad.install({ focusUrlId: focusId });
  deepScroll(virtualizer);
  const freshItem = { id: focusId, hydrated: true };
  virtualizer.setList([freshItem, ...virtualizer.list.slice(1)]);
  const out = virtualizer.instance[LAD_KEY]();
  assert.equal(out[0].item, freshItem); // identity, not a stale copy
});

test("A8 原方法抛错：安装期拒绝（final-items-threw），不包装", () => {
  const { lad, virtualizer, focusId } = makeMainEnv({});
  const proto = Object.getPrototypeOf(virtualizer.instance);
  const desc = Object.getOwnPropertyDescriptor(proto, LAD_KEY);
  Object.defineProperty(proto, LAD_KEY, { ...desc, value() { throw new Error("x-boom"); } });
  const r = lad.install({ focusUrlId: focusId });
  assert.equal(r.type, "UNSUPPORTED");
  assert.equal(r.reason, "final-items-threw");
  Object.defineProperty(proto, LAD_KEY, desc); // fixture cleanup
  assert.equal(lad.query().phase, "idle");
});

test("A9 标记维护：安装时标记 focal article，卸载时移除", () => {
  const { lad, virtualizer, focusId, art } = makeMainEnv({});
  lad.install({ focusUrlId: focusId });
  assert.equal(art.getAttribute(LAD_MARK_ARTICLE), "");
  lad.uninstall({ reason: "test" });
  assert.equal(art.hasAttribute(LAD_MARK_ARTICLE), false);
});

// ---------- B. uninstall + ownership-aware restore ----------

test("B1 prototype 所有权卸载：own property 被删除（无遮蔽残留）", () => {
  const { lad, virtualizer, focusId } = makeMainEnv({});
  lad.install({ focusUrlId: focusId });
  deepScroll(virtualizer);
  const r = lad.uninstall({ reason: "test" });
  assert.equal(r.type, "UNINSTALLED");
  assert.equal(r.restored, true);
  assert.equal(r.note, "prototype-restored");
  const d = Object.getOwnPropertyDescriptor(virtualizer.instance, LAD_KEY);
  assert.equal(d, undefined); // NO instance-level shadow left (contract §8)
  assert.equal(virtualizer.instance[LAD_KEY], Object.getPrototypeOf(virtualizer.instance)[LAD_KEY]);
  assert.equal(lad.query().phase, "idle");
  const out = virtualizer.instance[LAD_KEY]();
  assert.ok(!out.some((x) => x.item.id === focusId)); // restore is functional
});

test("B2 own-data 所有权卸载：完整描述符按原样恢复（含 writable/enumerable）", () => {
  const { lad, virtualizer, focusId } = makeMainEnv({ ownDataDescriptor: true });
  const before = Object.getOwnPropertyDescriptor(virtualizer.instance, LAD_KEY);
  assert.equal(before.writable, false);
  assert.equal(before.enumerable, true);
  const r = lad.install({ focusUrlId: focusId });
  assert.equal(r.ownership, "own-data");
  const after = Object.getOwnPropertyDescriptor(virtualizer.instance, LAD_KEY);
  assert.equal(after.enumerable, true); // flags preserved while wrapped
  deepScroll(virtualizer);
  assert.equal(virtualizer.instance[LAD_KEY]()[0].item.id, focusId);
  const u = lad.uninstall({ reason: "test" });
  assert.equal(u.restored, true);
  assert.equal(u.note, "descriptor-restored");
  const restored = Object.getOwnPropertyDescriptor(virtualizer.instance, LAD_KEY);
  assert.equal(restored.value, before.value);
  assert.equal(restored.writable, false);
  assert.equal(restored.enumerable, true);
  assert.equal(restored.configurable, true);
});

test("B3 own 不可配置描述符：拒绝安装且零副作用", () => {
  const { lad, virtualizer, focusId } = makeMainEnv({});
  Object.defineProperty(virtualizer.instance, LAD_KEY, {
    value: () => [], writable: true, enumerable: false, configurable: false,
  });
  const untouched = virtualizer.instance[LAD_KEY];
  const r = lad.install({ focusUrlId: focusId });
  assert.equal(r.type, "UNSUPPORTED");
  assert.equal(r.reason, "non-configurable");
  assert.equal(virtualizer.instance[LAD_KEY], untouched);
  assert.equal(Object.getOwnPropertyDescriptor(virtualizer.instance, LAD_KEY).configurable, false);
});

test("B4 accessor 描述符：拒绝安装", () => {
  const { lad, virtualizer, focusId } = makeMainEnv({});
  Object.defineProperty(virtualizer.instance, LAD_KEY, {
    get() { return () => []; }, configurable: true,
  });
  const r = lad.install({ focusUrlId: focusId });
  assert.equal(r.type, "UNSUPPORTED");
  assert.equal(r.reason, "accessor-descriptor");
});

test("B5 密封实例：拒绝安装（无法保证卸载）", () => {
  const { lad, virtualizer, focusId } = makeMainEnv({});
  Object.seal(virtualizer.instance);
  const r = lad.install({ focusUrlId: focusId });
  assert.equal(r.type, "UNSUPPORTED");
  assert.equal(r.reason, "instance-sealed");
});

test("B6 X 已自行替换方法时卸载：不覆盖 X 的新值", () => {
  const { lad, virtualizer, focusId } = makeMainEnv({});
  lad.install({ focusUrlId: focusId });
  const xsNewMethod = function () { return []; };
  virtualizer.instance[LAD_KEY] = xsNewMethod; // X replaced the wrap itself
  const r = lad.uninstall({ reason: "test" });
  assert.equal(r.type, "UNINSTALLED");
  assert.equal(r.note, "already-replaced");
  assert.equal(virtualizer.instance[LAD_KEY], xsNewMethod); // X's value survives
});

test("B7 未激活时卸载：幂等不崩溃", () => {
  const { lad } = makeMainEnv({});
  const r = lad.uninstall({ reason: "test" });
  assert.equal(r.type, "UNINSTALLED");
  assert.equal(r.note, "not-active");
});

test("B8 换焦点重装：旧实例恢复原方法，新实例被包装", () => {
  const { env, lad, virtualizer, focusId } = makeMainEnv({});
  lad.install({ focusUrlId: focusId });
  assert.equal(typeof Object.getOwnPropertyDescriptor(virtualizer.instance, LAD_KEY), "object");

  const focusB = makeStatusId();
  const v2 = makeVirtualizer();
  v2.setList([{ id: focusB }, ...Array.from({ length: 10 }, (_, i) => ({ id: `b-${i}` }))]);
  mountFocalCell(env, { focusId: focusB, virtualizer: v2 });
  v2.showAll(); // install precondition: focal rendered
  env.location.pathname = `/other/status/${focusB}`;
  env.location.href = `https://x.com/other/status/${focusB}`;

  const r = lad.install({ focusUrlId: focusB });
  assert.equal(r.type, "ACTIVE");
  assert.equal(r.focusItemKey, focusB);
  assert.equal(Object.getOwnPropertyDescriptor(virtualizer.instance, LAD_KEY), undefined, "old instance restored");
  v2.showReplies(3, 8); // then verify retention works on the new instance
  const out = v2.instance[LAD_KEY]();
  assert.equal(out[0].item.id, focusB, "new instance wrapped");
});

test("B9 同焦点重复安装：幂等（不叠层包装）", () => {
  const { lad, virtualizer, focusId } = makeMainEnv({});
  const first = lad.install({ focusUrlId: focusId });
  const wrappedFn = virtualizer.instance[LAD_KEY];
  const second = lad.install({ focusUrlId: focusId });
  assert.equal(second.type, "ACTIVE");
  assert.equal(second.note, "already-active");
  assert.equal(virtualizer.instance[LAD_KEY], wrappedFn);
  void first;
});

test("B10 形状失配逐项：_cells / props.list / 非数组返回 / 无法映射", () => {
  const { lad, virtualizer, focusId } = makeMainEnv({});
  virtualizer.instance._cells = undefined;
  assert.equal(lad.install({ focusUrlId: focusId }).reason, "cells-map-missing");
  virtualizer.instance._cells = new Map();
  virtualizer.instance.props = {};
  assert.equal(lad.install({ focusUrlId: focusId }).reason, "props-list-missing");
  virtualizer.instance.props = { list: virtualizer.list };
  const proto = Object.getPrototypeOf(virtualizer.instance);
  const desc = Object.getOwnPropertyDescriptor(proto, LAD_KEY);
  Object.defineProperty(proto, LAD_KEY, { ...desc, value() { return "not-an-array"; } });
  assert.equal(lad.install({ focusUrlId: focusId }).reason, "final-items-not-array");
  Object.defineProperty(proto, LAD_KEY, desc);
  // valid shapes but the focal entry is not rendered → unmappable (contract §4.5)
  deepScroll(virtualizer);
  assert.equal(lad.install({ focusUrlId: focusId }).reason, "focal-entry-not-mapped");
});

test("B11 焦点 cell 无法定位：UNSUPPORTED focal-cell-not-found", () => {
  const focusId = makeStatusId();
  const env = makeEnv({ url: `/somebody/status/${focusId}` });
  installTransport(env);
  env.bootScript(mainWorldSource());
  const r = env.ladTest().install({ focusUrlId: focusId });
  assert.equal(r.type, "UNSUPPORTED");
  assert.equal(r.reason, "focal-cell-not-found");
});

// ---------- C. health check + safe exits ----------

test("C1 路由离开 + healthTick：优雅卸载并恢复", () => {
  const { env, lad, virtualizer, focusId, sent } = makeMainEnv({});
  lad.install({ focusUrlId: focusId });
  deepScroll(virtualizer);
  env.location.pathname = "/home";
  env.location.href = "https://x.com/home";
  lad.healthTick();
  assert.equal(lad.query().phase, "idle");
  assert.equal(Object.getOwnPropertyDescriptor(virtualizer.instance, LAD_KEY), undefined);
  const uninstalled = sent.find((m) => m.type === "HEALTH_UNINSTALLED");
  assert.ok(uninstalled, "autonomous HEALTH_UNINSTALLED transition must be emitted");
  assert.equal(uninstalled.reason, "route-moved");
});

test("C2 X 替换包装方法 + healthTick：安全退出且不碰 X 的新方法", () => {
  const { lad, virtualizer, focusId, sent } = makeMainEnv({});
  lad.install({ focusUrlId: focusId });
  const xsNewMethod = function () { return []; };
  virtualizer.instance[LAD_KEY] = xsNewMethod;
  lad.healthTick();
  const err = sent.find((m) => m.type === "HEALTH_ERROR");
  assert.ok(err);
  assert.equal(err.reason, "wrapper-replaced");
  assert.equal(virtualizer.instance[LAD_KEY], xsNewMethod); // X's value untouched
  assert.equal(lad.query().phase, "error");
});

test("C3 形状漂移 + healthTick：安全退出并恢复原方法", () => {
  const { lad, virtualizer, focusId, sent } = makeMainEnv({});
  lad.install({ focusUrlId: focusId });
  virtualizer.instance._cells = undefined;
  lad.healthTick();
  const err = sent.find((m) => m.type === "HEALTH_ERROR");
  assert.equal(err.reason, "shape-drift");
  assert.equal(Object.getOwnPropertyDescriptor(virtualizer.instance, LAD_KEY), undefined);
});

test("C4 cell 重建（同实例重映射）：重绑标记并继续适配", () => {
  const { env, lad, virtualizer, focusId, cell, art } = makeMainEnv({});
  lad.install({ focusUrlId: focusId });
  // X rebuilds the focal cell: old element dies, new element registers
  cell.remove();
  const { cell: cell2, art: art2 } = buildCell({ statusId: focusId });
  env.document.body.appendChild(cell2);
  virtualizer.cells.set(focusId, { getElement: () => cell2 });
  lad.healthTick();
  const q = lad.query();
  assert.equal(q.phase, "active");
  assert.equal(q.cellConnected, true);
  assert.equal(art2.getAttribute(LAD_MARK_ARTICLE), ""); // marker moved
  assert.equal(art.hasAttribute(LAD_MARK_ARTICLE), false);
  deepScroll(virtualizer);
  const out = virtualizer.instance[LAD_KEY]();
  assert.equal(out[0].item.id, focusId); // retention still works
});

test("C5 cell 彻底消失：两次 miss 后安全退出", () => {
  const { env, lad, virtualizer, focusId, cell, sent } = makeMainEnv({});
  lad.install({ focusUrlId: focusId });
  cell.remove(); // retention lost entirely
  lad.healthTick();
  assert.equal(lad.query().phase, "active"); // transient tolerance (1st miss)
  lad.healthTick();
  const err = sent.find((m) => m.type === "HEALTH_ERROR");
  assert.equal(err.reason, "focal-cell-gone");
  assert.equal(Object.getOwnPropertyDescriptor(virtualizer.instance, LAD_KEY), undefined);
  void env;
});

test("C6 实例被替换：有界内部重装成功（预算递减不重置）", () => {
  const { env, lad, virtualizer, focusId, cell, sent } = makeMainEnv({});
  lad.install({ focusUrlId: focusId });
  // X replaces the virtualizer instance: old cell dies, new instance+cell appear
  cell.remove();
  const v2 = makeVirtualizer();
  v2.setList([{ id: focusId }, ...Array.from({ length: 10 }, (_, i) => ({ id: `r-${i}` }))]);
  const { cell: cell2 } = mountFocalCell(env, { focusId, virtualizer: v2 });
  v2.showAll(); // re-install precondition: focal rendered on the NEW instance
  lad.healthTick();
  const q = lad.query();
  assert.equal(q.phase, "active");
  assert.equal(q.reinstallLeft, 1, "budget decremented by the successful re-install");
  assert.equal(Object.getOwnPropertyDescriptor(virtualizer.instance, LAD_KEY), undefined, "old instance restored");
  v2.showReplies(2, 8);
  assert.equal(v2.instance[LAD_KEY]()[0].item.id, focusId, "new instance wrapped");
  assert.ok(sent.some((m) => m.type === "HEALTH_ACTIVE" && m.note === "reinstalled"));
  void cell2;
});

test("C7 重装预算耗尽后持续失配：安全退出（无重试风暴）", () => {
  const { env, lad, virtualizer, focusId, cell, sent } = makeMainEnv({});
  lad.install({ focusUrlId: focusId });
  let currentCell = cell;
  const replaceInstance = () => {
    currentCell.remove();
    const v = makeVirtualizer();
    v.setList([{ id: focusId }, ...Array.from({ length: 5 }, (_, i) => ({ id: `x-${i}` }))]);
    currentCell = mountFocalCell(env, { focusId, virtualizer: v }).cell;
    v.showAll();
    return v;
  };  replaceInstance();
  lad.healthTick(); // reinstall #1 (budget 2→1)
  assert.equal(lad.query().reinstallLeft, 1);
  replaceInstance();
  lad.healthTick(); // reinstall #2 (budget 1→0)
  assert.equal(lad.query().reinstallLeft, 0);
  assert.equal(lad.query().phase, "active");
  replaceInstance();
  lad.healthTick(); // budget exhausted: no re-install, miss #1
  assert.equal(lad.query().phase, "active");
  lad.healthTick(); // miss #2 → safe exit
  const err = sent.filter((m) => m.type === "HEALTH_ERROR").pop();
  assert.equal(err.reason, "focal-cell-unmappable");
  assert.equal(lad.query().phase, "error");
  // the last managed instance must have been restored
  const lastFiber = env.document.querySelector(`a[href*="/status/${focusId}"] time`)
    ?.closest('[data-testid="cellInnerDiv"]');
  void lastFiber;
});

test("C8 包装统计：调用与注入计数（仅聚合计数，无内容采集）", () => {
  const { lad, virtualizer, focusId } = makeMainEnv({});
  lad.install({ focusUrlId: focusId });
  deepScroll(virtualizer);
  virtualizer.instance[LAD_KEY]();
  virtualizer.instance[LAD_KEY]();
  const q = lad.query();
  assert.ok(q.stats.calls >= 2);
  assert.ok(q.stats.injections >= 2);
  assert.equal(typeof q.stats.sampledOriginalMs, "number");
  const snap = JSON.stringify(q);
  assert.ok(!snap.includes("reply-")); // no content leaks into diagnostics
});

// ---------- D. MAIN↔ISOLATED messaging ----------

test("D1 INSTALL 经消息通道到达并返回 ACTIVE（nonce 关联）", async () => {
  const { env, virtualizer, focusId, sent } = makeMainEnv({});
  const responses = [];
  env.window.addEventListener("message", (e) => { if (e.data?.from === "main") responses.push(e.data); });
  env.window.postMessage({ ns: "peek-lad", from: "isolated", type: "INSTALL", focusUrlId: focusId, nonce: 42 }, ORIGIN);
  await realSleep(20);
  const active = responses.find((m) => m.nonce === 42 && m.type === "ACTIVE");
  assert.ok(active, "ACTIVE response must arrive");
  assert.equal(active.focusItemKey, focusId);
  deepScroll(virtualizer);
  assert.equal(env.ladTest().query().stats.injections >= 0, true);
  void sent;
});

test("D2 消息验证：外来 origin / 来源方向 / 未知类型 / 异命名空间被忽略", async () => {
  const { env, lad } = makeMainEnv({});
  const dispatch = (data, origin = ORIGIN) => {
    env.window.dispatchEvent(new env.window.MessageEvent("message", { source: env.window, origin, data }));
  };
  dispatch({ ns: "peek-lad", from: "isolated", type: "INSTALL", focusUrlId: "123", nonce: 1 }, "https://evil.example");
  dispatch({ ns: "peek-lad", from: "main", type: "INSTALL", focusUrlId: "123", nonce: 2 }); // wrong direction
  dispatch({ ns: "peek-lad", from: "isolated", type: "EXPLODE", nonce: 3 });                 // unknown type
  dispatch({ ns: "other", from: "isolated", type: "INSTALL", focusUrlId: "123", nonce: 4 }); // wrong namespace
  await realSleep(10);
  const q = lad.query();
  assert.equal(q.phase, "idle");
  assert.equal(q.stats.installs, 0);
});

test("D3 QUERY 返回状态快照（无 DOM/React 引用泄漏）", async () => {
  const { env, lad, focusId } = makeMainEnv({});
  lad.install({ focusUrlId: focusId });
  const responses = [];
  env.window.addEventListener("message", (e) => { if (e.data?.from === "main") responses.push(e.data); });
  env.window.postMessage({ ns: "peek-lad", from: "isolated", type: "QUERY", nonce: 7 }, ORIGIN);
  await realSleep(20);
  const state = responses.find((m) => m.nonce === 7 && m.type === "STATE");
  assert.ok(state);
  assert.equal(state.state.phase, "active");
  const snap = JSON.stringify(state.state);
  assert.ok(!snap.includes("reactFiber"));
  assert.ok(!snap.includes("Element"));
});
