// M2-B1 build isolation: the DEFAULT artifact must remain the M1-R carrier
// (no adapter mode, no MAIN-world script), and the LAB artifact must carry the
// adapter behind the experimental flag with the isolation gate intact.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  makeEnv, NATIVE_DIST, NATIVE_LAB_DIST, buildCell, makeStatusId, nativeSource
} from "./native-env.mjs";

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

test("P1 默认构建：manifest 无 MAIN world 入口，无 MAIN 产物文件", () => {
  const manifest = readJson(join(NATIVE_DIST, "manifest.json"));
  assert.equal(manifest.name, "Peek Native (M1)");
  assert.equal(manifest.content_scripts.some((c) => c.world === "MAIN"), false);
  assert.equal(existsSync(join(NATIVE_DIST, "layout-adapter-main.js")), false);
});

test("P2 lab 构建：manifest 含 MAIN 入口且命名/版本区分明确", () => {
  const manifest = readJson(join(NATIVE_LAB_DIST, "manifest.json"));
  assert.equal(manifest.name, "Peek Native (M2-B1 Lab)");
  assert.equal(manifest.version, "0.10.0");
  const mainEntry = manifest.content_scripts.find((c) => c.world === "MAIN");
  assert.ok(mainEntry, "lab manifest must register the MAIN-world adapter");
  assert.deepEqual(mainEntry.js, ["layout-adapter-main.js"]);
  assert.equal(mainEntry.run_at, "document_start");
  assert.ok(existsSync(join(NATIVE_LAB_DIST, "layout-adapter-main.js")));
  // the isolated carrier entry is untouched
  const iso = manifest.content_scripts.find((c) => !c.world || c.world !== "MAIN");
  assert.deepEqual(iso.js, ["vendor/brand/icon.js", "content.js"]);
});

test("P3 隔离闸门（防御性重扫）：两个 lab 产物与默认产物均无 Legacy 桥标记", () => {
  const FORBIDDEN = [
    /XMLHttpRequest/, /\bwebpackChunk/, /__webpack_require__/, /\bfetch\s*\(/,
    /\bfetch\b\s*[.=(]/, /queryId/, /x-csrf-token/i, /\bauthorization\b/i,
    /\bbearer\s+[A-Za-z0-9]/i, /document\.cookie/, /page-bridge/,
    /chrome\.(scripting|tabs|cookies|webRequest|declarativeNetRequest)/, /hls\.js|hls\.min/i,
  ];
  for (const [dist, files] of [
    [NATIVE_DIST, ["content.js"]],
    [NATIVE_LAB_DIST, ["content.js", "layout-adapter-main.js"]],
  ]) {
    for (const f of files) {
      const src = readFileSync(join(dist, f), "utf8");
      const offenders = FORBIDDEN.filter((re) => re.test(src));
      assert.deepEqual(offenders, [], `${dist}/${f} must be free of Legacy-bridge markers`);
    }
  }
});

test("P4 默认产物行为不变：详情页仍构建 M1 阅读副本，且适配器零注册", async () => {
  const focusId = makeStatusId();
  const env = makeEnv({ url: `/somebody/status/${focusId}` }); // src: default
  env.boot();
  const { cell } = buildCell({ statusId: focusId });
  env.document.body.appendChild(cell);
  await env.pushNavigate(`/somebody/status/${focusId}`);
  assert.ok(env.pane(), "M1 reading copy builds as before");
  assert.equal(env.document.getElementById("peek-lad-style"), null, "no adapter layout");
  assert.equal(env.document.documentElement.getAttribute("data-peek-lad-state"), null, "no adapter state attr");
  assert.equal(env.ladMainInstalled(), false, "no MAIN-world adapter registered");
  // the MAIN entry is not even bundled into the default content.js
  assert.ok(!nativeSource().includes("__peekLayoutAdapterMainInstalled"));
});

test("P5 lab 产物：适配器构建定义注入，M1 副本构建路径被短路", async () => {
  // behavioral check (bundle-string assertions are fragile):
  const focusId = makeStatusId();
  const env = makeEnv({ url: `/somebody/status/${focusId}`, src: "lab" });
  env.boot();
  const { cell } = buildCell({ statusId: focusId });
  env.document.body.appendChild(cell);
  await env.pushNavigate(`/somebody/status/${focusId}`);
  await env.timers.advance(1400); // MAIN world never booted here → ack timeout
  assert.equal(env.pane(), null, "M1 copy short-circuited in lab build");
  assert.equal(env.document.documentElement.getAttribute("data-peek-lad-state"), "failed",
    "no MAIN world booted here → honest main-unresponsive failure");
});
