#!/usr/bin/env node
// Build the Peek Native unpacked extension.
//
// Two artifacts, never the same directory:
//   default:  dist-extension-native/      — the M1-R stable carrier. The M2-B1
//             layout adapter is compiled OUT (define false, no MAIN-world
//             script, manifest untouched): behavior identical to M1-R.
//   lab:      dist-extension-native-lab/  — the M2-B1 experimental build
//             (PEEK_LAYOUT_ADAPTER=1 or --lab). Enables the native layout
//             adapter: content.js defines the flag true and the manifest gains
//             a dedicated MAIN-world content script. Never a default mode.
//
// Isolation contract (M1-A2): neither build EVER touches dist-extension/ (the
// Legacy build) and no output may contain the Legacy private-API bridge path
// in any form. Bundles are scanned for forbidden markers at build time and the
// build fails loudly if any appear; tests/native re-verifies independently.
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
const lab = process.env.PEEK_LAYOUT_ADAPTER === "1" || process.argv.includes("--lab");
const dist = lab
  ? path.resolve(root, "dist-extension-native-lab")
  : path.resolve(root, "dist-extension-native");
const legacyDist = path.resolve(root, "dist-extension");
const asset = path.join(root, "public", "assets", "tuzai-icon-source.png");
// Diagnostic builds: lab builds always; the default carrier only when
// explicitly building a measurement copy (PEEK_BUILD_DIAG=1). Diagnostics add
// a non-sensitive build-identity DOM marker plus capture/mount timestamps —
// nothing else. A pristine default build (no env) carries none of it.
const diag = lab || process.env.PEEK_BUILD_DIAG === "1";
// Controlled synchronous stall inside preview extraction (clock-validation
// builds only; PEEK_DIAG_DELAY_MS=50 → busy-wait that long before mounting).
const diagDelayMs = Math.max(0, Number(process.env.PEEK_DIAG_DELAY_MS || 0));

if (!dist.startsWith(root + path.sep)) throw new Error("Refusing to clean an output outside the project root");
if (dist === legacyDist) throw new Error("Refusing to overwrite the Legacy build output");
if (!existsSync(source)) throw new Error("Missing native extension source directory");
if (!existsSync(path.join(source, "src", "main.js"))) throw new Error("Missing native entry: native-extension/src/main.js");
if (!existsSync(asset)) throw new Error("Missing icon source: public/assets/tuzai-icon-source.png");

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
    __PEEK_LAYOUT_ADAPTER__: lab ? "true" : "false",
    // test-build diagnostics (see artifact-prologue.mjs); false = compiled out
    __PEEK_DIAG_STAMPS__: diag ? "true" : "false",
    __PEEK_DIAG_DELAY_MS__: String(diagDelayMs),
  },
};

await build({
  ...COMMON,
  entryPoints: [path.join(source, "src", "main.js")],
  outfile: path.join(dist, "content.js"),
  banner: { js: `// Peek Native ${lab ? "(M2-B1 lab)" : "(M1)"} — bundled content script. Source: native-extension/src/*.js` },
});

// Diagnostic builds stamp their identity FIRST, before any bundle code runs
// (scripts/artifact-prologue.mjs for the exact text and rationale). The scan
// below therefore covers the final file, prologue included.
const contentMode = lab ? "m2a" : "m1r";
if (diag) {
  const contentPath = path.join(dist, "content.js");
  const bundled = readFileSync(contentPath, "utf8");
  const buildId = buildIdFor(contentMode, bundled);
  writeFileSync(contentPath, artifactPrologue(buildId, contentMode) + bundled);
  console.log(`Artifact identity: build ${buildId} (mode ${contentMode}, diag stamps on${diagDelayMs ? `, ${diagDelayMs}ms preview stall` : ""})`);
}

// Lab build only: the MAIN-world adapter script (separate bundle, separate
// content-script entry with world "MAIN"). The default build never emits it.
if (lab) {
  if (!existsSync(path.join(source, "src", "layout-adapter", "main-world-entry.js"))) {
    throw new Error("Missing lab entry: native-extension/src/layout-adapter/main-world-entry.js");
  }
  await build({
    ...COMMON,
    entryPoints: [path.join(source, "src", "layout-adapter", "main-world-entry.js")],
    outfile: path.join(dist, "layout-adapter-main.js"),
    banner: { js: "// Peek Native (M2-B1 lab) — MAIN-world layout adapter. Source: native-extension/src/layout-adapter/*" },
  });
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

const bundleFiles = lab ? ["content.js", "layout-adapter-main.js"] : ["content.js"];
for (const file of bundleFiles) {
  const bundled = readFileSync(path.join(dist, file), "utf8");
  const offenders = FORBIDDEN.filter((re) => re.test(bundled)).map((re) => String(re));
  if (offenders.length) {
    throw new Error(`${file} contains forbidden markers (Legacy-bridge isolation violated): ${offenders.join(", ")}`);
  }
}

// Manifest: the default build copies it verbatim (M1-R contract). The lab
// build derives a clearly-labeled experimental manifest that additionally
// registers the MAIN-world adapter script.
if (!lab) {
  cpSync(path.join(source, "manifest.json"), path.join(dist, "manifest.json"));
} else {
  const manifest = JSON.parse(readFileSync(path.join(source, "manifest.json"), "utf8"));
  manifest.name = "Peek Native (M2-B1 Lab)";
  manifest.version = "0.10.0";
  manifest.description += "【实验构建：M2-B1 原生布局适配器已启用——左栏原生焦点帖 + 右栏原生评论；默认构建不含此模式。】";
  const xMatches = manifest.content_scripts[0].matches;
  manifest.content_scripts = [
    {
      matches: xMatches,
      js: ["layout-adapter-main.js"],
      run_at: "document_start",
      world: "MAIN",
    },
    ...manifest.content_scripts,
  ];
  writeFileSync(path.join(dist, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}

cpSync(path.join(source, "content.css"), path.join(dist, "content.css"));

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

const iconDir = path.join(dist, "icons");
mkdirSync(iconDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  await sharp(asset).resize(size, size, { fit: "cover" }).png().toFile(path.join(iconDir, `icon${size}.png`));
}

console.log(`Built unpacked Peek Native ${lab ? "(M2-B1 lab)" : "(M1)"} extension: ${dist}${diag ? " [diagnostics]" : ""}`);
