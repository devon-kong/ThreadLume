// M1-A2 build-isolation verification: the Native build must not carry any
// Legacy private-API bridge path, and the build outputs must stay independently
// installable. All checks run against the real build artifacts. (The Legacy
// source tree was archived from the worktree in S2-20261015; the legacy
// *path* stays reserved, and the historic manifest assertions live in
// archive/peek-before-source-prune-20261015.)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeSource, NATIVE_DIST } from "./native-env.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

// ---------- Native artifact isolation (A3 verification items 1-8) ----------

const FORBIDDEN_IN_ARTIFACT = [
  [/XMLHttpRequest/, "无 XHR 包装（A3-3）"],
  [/\bwebpackChunk\b/, "无 webpack 运行时探测（A3-4）"],
  [/__webpack_require__/, "无 webpack require 探测（A3-4）"],
  [/\bfetch\s*\(/, "无主动 fetch（A3-2/A3-3）"],
  [/queryId/, "无 GraphQL queryId（A3-2）"],
  [/x-csrf-token/i, "无认证请求元数据捕获（A3-5）"],
  [/\bbearer\s+[A-Za-z0-9]/i, "无 token 捕获（A3-5）"],
  [/document\.cookie/, "无凭据读取（A3-5）"],
  [/page-bridge/, "无 Legacy 桥接引用（A3-1）"],
  [/chrome\.(scripting|tabs|cookies|webRequest|declarativeNetRequest|storage|runtime|action)/, "无扩展后台 API 使用"],
  [/hls\.min|hls\.js/i, "不打包已不需要的 hls.js（A3 体积要求）"],
  [/peek-poc/, "无 PoC 命名残留"],
  [/__peekPoc/, "无 PoC 测试钩子残留"]
];

test("隔离：Native 产物不包含任何 Legacy 桥接/私有接口标记", () => {
  const src = nativeSource();
  const offenders = FORBIDDEN_IN_ARTIFACT.filter(([re]) => re.test(src));
  assert.equal(offenders.length, 0, `forbidden markers found: ${offenders.map(([, label]) => label).join("; ")}`);
});

test("隔离：Native 构建产物目录中不存在 page-bridge.js / vendor/hls / popup", () => {
  const files = walk(NATIVE_DIST).map((p) => p.slice(NATIVE_DIST.length + 1));
  assert.equal(files.some((f) => /page-bridge/.test(f)), false, "no page-bridge file in the native build");
  assert.equal(files.some((f) => /vendor\/hls/.test(f)), false, "no vendored hls in the native build");
  assert.equal(files.some((f) => /popup/.test(f)), false, "no popup in the M1 native build");
  assert.ok(files.includes("content.js"), "content.js present");
  assert.ok(files.includes("content.css"), "content.css present");
  assert.ok(files.includes("manifest.json"), "manifest.json present");
});

test("隔离：Native manifest 无 MAIN world 注入、无多余权限、无 web_accessible_resources", () => {
  const manifest = JSON.parse(readFileSync(join(NATIVE_DIST, "manifest.json"), "utf8"));
  for (const cs of manifest.content_scripts ?? []) {
    assert.notEqual(cs.world, "MAIN", "no MAIN world content script");
    assert.ok((cs.js ?? []).every((f) => !/page-bridge/.test(f)), "no page-bridge in the script list");
  }
  assert.ok(!("permissions" in manifest) || (manifest.permissions ?? []).length === 0, "no permissions requested");
  assert.ok(!("host_permissions" in manifest) || (manifest.host_permissions ?? []).length === 0, "no host permissions beyond content-script matches");
  assert.equal(manifest.web_accessible_resources, undefined, "no web accessible resources");
  assert.equal(manifest.action, undefined, "no popup/action in the M1 native build");
  assert.equal(manifest.background, undefined, "no service worker in the M1 native build");
  assert.ok(manifest.name.includes("Native"), "distinct display name vs Legacy");
  assert.notEqual(manifest.version, "0.8.10", "distinct version vs Legacy");
});

test("隔离：Native 源码目录同样不包含禁止标记（纵深防御）", () => {
  const srcDir = join(repoRoot, "native-extension");
  for (const file of walk(srcDir).filter((f) => f.endsWith(".js") || f.endsWith(".json"))) {
    const src = readFileSync(file, "utf8");
    for (const [re, label] of FORBIDDEN_IN_ARTIFACT) {
      assert.equal(re.test(src), false, `${label} — in ${file}`);
    }
  }
});

test("隔离：无 fetch/XHR 的动态调用形态（eval/new Function/Function 构造器）", () => {
  const src = nativeSource();
  assert.equal(/\bnew Function\b/.test(src), false, "no dynamic code construction");
  assert.equal(/\beval\s*\(/.test(src), false, "no eval");
});

// ---------- The reserved Legacy path stays unreachable ----------

test("G9：Native 构建不触碰保留的 Legacy 产物路径（路径守卫）", () => {
  // The native build must never write outside dist-extension-native; verify
  // by asserting the reserved legacy dist dir resolves to a distinct path.
  const legacyDist = join(repoRoot, "dist-extension");
  assert.notEqual(resolve(NATIVE_DIST), resolve(legacyDist));
  const nativeScript = readFileSync(join(repoRoot, "scripts", "build-extension-native.mjs"), "utf8");
  assert.match(nativeScript, /dist-extension-native/);
  // and the native build keeps a hard guard against targeting the legacy path
  assert.match(nativeScript, /Refusing to overwrite the Legacy build output/);
});

test("G9：Native 在缺失 Legacy 桥接全局时功能不失败（离线环境即无桥接）", async () => {
  // Every jsdom boot in this suite runs with NO TuzaiPhosphorIcons, no
  // TuzaiBrandIconDataUrl from the legacy vendor chain (brand icon comes from
  // the native vendor only, and its absence must be tolerated too).
  const { makeEnv, makeStatusId, mountCell, buildAuthor, buildTweetText, buildActionBar } = await import("./native-env.mjs");
  const env = makeEnv();
  env.boot();
  const id = makeStatusId();
  await env.pushNavigate(`/somebody/status/${id}`);
  mountCell(env, { statusId: id, articleChildren: [buildAuthor(), buildTweetText("正文"), buildActionBar()] });
  await env.timers.advance(1_500);
  assert.ok(env.pane(), "pane builds with zero legacy globals present");
});
