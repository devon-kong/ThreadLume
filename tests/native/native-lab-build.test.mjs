// Build-identity tests for the SINGLE unified Native artifact (S3 unification,
// 2026-10-15): dist-extension-native/ IS the former C1-R lab build — the
// MAIN-world adapter is always compiled in and always registered in the
// manifest. The former "default carrier without adapter" (M1-R) contract is
// retired; its remaining live half (isolation gate) is re-asserted here and in
// native-isolation.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  makeEnv, NATIVE_DIST, NATIVE_LAB_DIST, buildCell, makeStatusId, nativeSource
} from "./native-env.mjs";

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

test("P1 统一构建：manifest 注册 document_start MAIN 入口，MAIN 产物文件存在", () => {
  const manifest = readJson(join(NATIVE_DIST, "manifest.json"));
  const mainEntry = manifest.content_scripts.find((c) => c.world === "MAIN");
  assert.ok(mainEntry, "unified manifest must register the MAIN-world adapter");
  assert.deepEqual(mainEntry.js, ["layout-adapter-main.js"]);
  assert.equal(mainEntry.run_at, "document_start");
  assert.ok(existsSync(join(NATIVE_DIST, "layout-adapter-main.js")));
  // the isolated carrier entry is untouched and follows the MAIN entry
  const iso = manifest.content_scripts.find((c) => !c.world || c.world !== "MAIN");
  assert.deepEqual(iso.js, ["vendor/brand/icon.js", "content.js"]);
  assert.equal(manifest.content_scripts.indexOf(mainEntry), 0, "MAIN entry runs first (document_start)");
});

test("P2 统一构建 manifest 身份：Peek Native / 0.11.0 / HTTPS 可选权限上限", () => {
  const manifest = readJson(join(NATIVE_DIST, "manifest.json"));
  assert.equal(manifest.name, "ThreadLume — AI Reader for X");
  assert.equal(manifest.version, "0.12.0");
  assert.deepEqual(manifest.permissions, ["storage", "declarativeNetRequestWithHostAccess"]);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.optional_permissions, undefined);
  assert.deepEqual(manifest.optional_host_permissions, ["https://*/*"]);
  assert.deepEqual(manifest.background, {service_worker:"ai-background.js"});
  assert.equal(manifest.web_accessible_resources, undefined);
  // S3 alias rule: both historical dist constants resolve to the same build
  assert.equal(NATIVE_LAB_DIST, NATIVE_DIST);
});

test("P3 隔离闸门（防御性重扫）：统一产物 content.js 与 layout-adapter-main.js 均无 Legacy 桥标记", () => {
  const FORBIDDEN = [
    /XMLHttpRequest/, /\bwebpackChunk/, /__webpack_require__/, /\bfetch\s*\(/,
    /\bfetch\b\s*[.=(]/, /queryId/, /x-csrf-token/i, /\bauthorization\b/i,
    /\bbearer\s+[A-Za-z0-9]/i, /document\.cookie/, /page-bridge/,
    /chrome\.(scripting|tabs|cookies|webRequest|declarativeNetRequest)/, /hls\.js|hls\.min/i,
  ];
  for (const f of ["content.js", "layout-adapter-main.js"]) {
    const src = readFileSync(join(NATIVE_DIST, f), "utf8");
    const offenders = FORBIDDEN.filter((re) => re.test(src));
    assert.deepEqual(offenders, [], `${f} must be free of Legacy-bridge markers`);
  }
});

test("P4 统一产物：适配器编译在内（控制器标记存在），M1 阅读副本路径不复存在", async () => {
  // the adapter controller must be IN the isolated bundle now — the inverted
  // half of the retired "default build has no adapter" contract
  assert.ok(nativeSource().includes("data-peek-lad-state"),
    "unified content.js carries the adapter controller (state attribute)");
  assert.ok(nativeSource().includes("peek-lad-style"),
    "unified content.js carries the adapter split-layout style");
  // behaviorally: on a detail route the reading copy never builds — the
  // adapter session owns the page (honest main-unresponsive failure without
  // a MAIN world in this harness window)
  const focusId = makeStatusId();
  const env = makeEnv({ url: `/somebody/status/${focusId}` });
  env.boot();
  const { cell } = buildCell({ statusId: focusId });
  env.document.body.appendChild(cell);
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await env.timers.advance(1400); // MAIN world never booted here → ack timeout
  assert.equal(env.pane(), null, "M1 reading copy is unreachable in the unified build");
  assert.equal(env.document.documentElement.getAttribute("data-peek-lad-state"), "failed",
    "no MAIN world booted here → honest main-unresponsive failure");
});
