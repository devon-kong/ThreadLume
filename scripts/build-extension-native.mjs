#!/usr/bin/env node
// Build the ThreadLume unpacked extension — the SINGLE product artifact.
//
// Since the S3 unification (2026-10-15) there is exactly one build:
//   dist-extension-native/  — the C1-R native two-column reader. The former
//   default M1-R carrier and the experimental dist-extension-native-lab/
//   build no longer exist: the MAIN-world layout adapter, the instant reading
//   preview and the reader skin ARE the product, so the adapter define is
//   always true and the manifest always registers the MAIN-world script.
//   The retired `--lab` flag / PEEK_LAYOUT_ADAPTER env are rejected loudly so
//   no stale command can ever regenerate a second artifact.
//
// Isolation contract (M1-A2, unchanged): the build NEVER touches dist-extension/
// (the reserved Legacy path) and no output may contain the Legacy private-API
// bridge path in any form. Bundles are scanned for forbidden markers at build
// time and the build fails loudly if any appear; tests/native re-verifies
// independently.
//
// Bundle: esbuild (a direct devDependency), IIFE, unminified so reviewers and
// tests can read the artifact.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { artifactPrologue, buildIdFor } from "./artifact-prologue.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "native-extension");
const dist = path.resolve(root, "dist-extension-native");
const legacyDist = path.resolve(root, "dist-extension");
const asset = path.join(root, "public", "brand", "icon.svg");

if (process.env.PEEK_LAYOUT_ADAPTER === "1" || process.argv.includes("--lab")) {
  throw new Error("PEEK_LAYOUT_ADAPTER / --lab were retired by the S3 unification: there is a single build now — run `node scripts/build-extension-native.mjs` (or npm run build)");
}
// Diagnostic stamps are ALWAYS on for the unified build (they were always on
// for the lab build this replaces): the non-sensitive build-identity marker on
// <html> is how the measurement harness recognizes a correctly loaded build.
// Controlled synchronous stall inside preview extraction (clock-validation
// builds only; PEEK_DIAG_DELAY_MS=50 → busy-wait that long before mounting).
const diagDelayMs = Math.max(0, Number(process.env.PEEK_DIAG_DELAY_MS || 0));
// Internal measurement-mode tag kept for continuity with the committed perf
// the retained performance test monitor: do not repurpose.
const contentMode = "m2a";

if (!dist.startsWith(root + path.sep)) throw new Error("Refusing to clean an output outside the project root");
if (dist === legacyDist) throw new Error("Refusing to overwrite the Legacy build output");
if (!existsSync(source)) throw new Error("Missing native extension source directory");
if (!existsSync(path.join(source, "src", "main.js"))) throw new Error("Missing native entry: native-extension/src/main.js");
if (!existsSync(path.join(source, "src", "layout-adapter", "main-world-entry.js"))) {
  throw new Error("Missing MAIN-world entry: native-extension/src/layout-adapter/main-world-entry.js");
}
if (!existsSync(asset)) throw new Error("Missing icon source: public/brand/icon.svg");

let build;
try {
  ({ build } = await import("esbuild"));
} catch {
  throw new Error("esbuild not found — run `npm install` first (esbuild is a direct devDependency)");
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

const COMMON = {
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome100"],
  minify: false,
  sourcemap: false,
  logLevel: "warning",
  legalComments: "none",
  define: {
    __PEEK_LAYOUT_ADAPTER__: "true",
    // test-build diagnostics (see artifact-prologue.mjs); always on, see above
    __PEEK_DIAG_STAMPS__: "true",
    __PEEK_DIAG_DELAY_MS__: String(diagDelayMs),
  },
};

await build({
  ...COMMON,
  entryPoints: [path.join(source, "src", "main.js")],
  outfile: path.join(dist, "content.js"),
  banner: { js: "// ThreadLume — bundled content script. Source: native-extension/src/*.js" },
});

// Diagnostic stamps go FIRST, before any bundle code runs
// (scripts/artifact-prologue.mjs for the exact text and rationale). The scan
// below therefore covers the final file, prologue included.
{
  const contentPath = path.join(dist, "content.js");
  const bundled = readFileSync(contentPath, "utf8");
  const buildId = buildIdFor(contentMode, bundled);
  writeFileSync(contentPath, artifactPrologue(buildId, contentMode) + bundled);
  console.log(`Artifact identity: build ${buildId} (mode ${contentMode}${diagDelayMs ? `, ${diagDelayMs}ms preview stall` : ""})`);
}

// The MAIN-world layout adapter script (separate bundle, separate
// content-script entry with world "MAIN" registered in the manifest).
await build({
  ...COMMON,
  entryPoints: [path.join(source, "src", "layout-adapter", "main-world-entry.js")],
  outfile: path.join(dist, "layout-adapter-main.js"),
  banner: { js: "// ThreadLume — MAIN-world layout adapter. Source: native-extension/src/layout-adapter/*" },
});

// AI background and settings are separate bundles. Neither is imported by MAIN.
for (const [entry, output] of [["background.js", "ai-background.js"], ["settings.js", "ai-settings.js"]]) {
  await build({ ...COMMON, entryPoints: [path.join(source, "src", "ai", entry)], outfile: path.join(dist, output) });
}

// Build-time isolation gate: no artifact may carry any Legacy-bridge marker.
// Keep this list in sync with tests/native/native-isolation.test.mjs.
const FORBIDDEN = [
  /XMLHttpRequest/,
  /\bwebpackChunk/,
  /__webpack_require__/,
  /\bfetch\s*\(/,
  /\bfetch\b\s*[.=(]/,
  /queryId/,
  /x-csrf-token/i,
  /\bauthorization\b/i,
  /\bbearer\s+[A-Za-z0-9]/i,
  /document\.cookie/,
  /page-bridge/,
  /chrome\.(scripting|tabs|cookies|webRequest|declarativeNetRequest)/,
  /hls\.js|hls\.min/i
];

for (const file of ["content.js", "layout-adapter-main.js"]) {
  const bundled = readFileSync(path.join(dist, file), "utf8");
  const offenders = FORBIDDEN.filter((re) => re.test(bundled)).map((re) => String(re));
  if (offenders.length) {
    throw new Error(`${file} contains forbidden markers (Legacy-bridge isolation violated): ${offenders.join(", ")}`);
  }
}

// Manifest: copied verbatim from the source and validated — the source
// manifest IS the product manifest (MAIN-world adapter first at
// document_start, ISOLATED carrier at document_idle, AI optional-domain boundary).
const manifest = JSON.parse(readFileSync(path.join(source, "manifest.json"), "utf8"));
const mainEntry = (manifest.content_scripts ?? []).find((c) => c.world === "MAIN");
if (!mainEntry || !mainEntry.js?.includes("layout-adapter-main.js") || mainEntry.run_at !== "document_start") {
  throw new Error("native-extension/manifest.json must register layout-adapter-main.js as a document_start MAIN-world content script");
}
if (JSON.stringify(manifest.permissions) !== JSON.stringify(["storage", "declarativeNetRequestWithHostAccess"]) ||
    JSON.stringify(manifest.optional_host_permissions) !== JSON.stringify(["https://*/*"]) ||
    manifest.host_permissions || manifest.optional_permissions || manifest.background?.service_worker !== "ai-background.js" || manifest.web_accessible_resources) {
  throw new Error("Native AI permission boundary violated");
}
const aiWorker = readFileSync(path.join(dist, "ai-background.js"), "utf8");
const aiSettings = readFileSync(path.join(dist, "ai-settings.js"), "utf8");
for (const [file, code] of [["ai-background.js", aiWorker], ["ai-settings.js", aiSettings]]) {
  const rules = FORBIDDEN.filter(re => !/fetch|scripting/.test(re.source) && !(file === "ai-background.js" && /authorization/.test(re.source)));
  if (file === "ai-settings.js") rules.push(/\bfetch\s*\(/, /chrome\.(tabs|scripting|declarativeNetRequest)/);
  else rules.push(/chrome\.(cookies|webRequest)/, /(?:updateDynamicRules|updateEnabledRulesets|webRequest)\s*\(/);
  const offenders = rules.filter(re => re.test(code));
  if (offenders.length) throw new Error(`${file} violated AI isolation: ${offenders}`);
}
// Authorization is permitted only in the custom worker transport. X remains
// covered by the unmodified forbidden list above; settings cannot fetch.
if (!/credentials: ["']omit["']/.test(aiWorker) || !/redirect: ["']error["']/.test(aiWorker) ||
    !aiWorker.includes('TRUSTED_CONTEXTS')) throw new Error("Custom provider transport/storage boundary violated");
cpSync(path.join(source, "manifest.json"), path.join(dist, "manifest.json"));

cpSync(path.join(source, "content.css"), path.join(dist, "content.css"));
cpSync(path.join(source, "ai.css"), path.join(dist, "ai.css"));
cpSync(path.join(source, "settings.html"), path.join(dist, "settings.html"));
for (const file of ["LICENSE", "THIRD_PARTY_NOTICES.md", "PRIVACY.md"]) cpSync(path.join(root,file),path.join(dist,file));

// Brand icon: same inline data-URL approach as the Legacy build, generated
// locally before content.js so an extension reload never depends on an
// invalidated chrome.runtime.getURL() context.
const brandVendorDir = path.join(dist, "vendor", "brand");
const inlineBrandIcon = await sharp(asset).resize(48, 48, { fit: "cover" }).png().toBuffer();
mkdirSync(brandVendorDir, { recursive: true });
writeFileSync(
  path.join(brandVendorDir, "icon.js"),
  `globalThis.TuzaiBrandIconDataUrl = ${JSON.stringify(`data:image/png;base64,${inlineBrandIcon.toString("base64")}`)};\n`
);

cpSync(path.join(root,"public","brand"),path.join(dist,"brand"),{recursive:true});

const iconDir = path.join(dist, "icons");
mkdirSync(iconDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  await sharp(size===16?path.join(root,"public","brand","icon-small.svg"):asset).resize(size, size, { fit: "cover" }).png().toFile(path.join(iconDir, `icon${size}.png`));
}

console.log(`Built unpacked ThreadLume extension: ${dist}`);

// DNR is worker-owned and limited to session rules; X scans above are unchanged.
for (const method of aiWorker.matchAll(/\bdnr\.([A-Za-z]+)\s*\(/g)) {
  if (!["getSessionRules", "updateSessionRules"].includes(method[1])) throw new Error("Unapproved DNR method");
}
for (const name of ["origin-probe.html", "origin-probe-page.js"]) {
  if (existsSync(path.join(dist,name))) throw new Error("Experiment page in product artifact");
}
if (/peek-yuanjing-probe|yuanjing-origin-probe/.test(aiWorker)) throw new Error("Experiment message in product artifact");
