#!/usr/bin/env node
// Build the Peek Native (M1) unpacked extension into dist-extension-native/.
//
// Isolation contract (M1-A2): this build NEVER touches dist-extension/ (the
// Legacy build) and its output must not contain the Legacy private-API bridge
// path in any form. The bundle is scanned for forbidden markers at build time
// and the build fails loudly if any appear; tests/native re-verifies the
// artifact independently.
//
// Bundle: esbuild (provided by the existing vite toolchain — no new runtime
// dependency), IIFE, unminified so reviewers and tests can read the artifact.
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "native-extension");
const dist = path.resolve(root, "dist-extension-native");
const legacyDist = path.resolve(root, "dist-extension");
const asset = path.join(root, "public", "assets", "tuzai-icon-source.png");

if (!dist.startsWith(root + path.sep)) throw new Error("Refusing to clean an output outside the project root");
if (dist === legacyDist) throw new Error("Refusing to overwrite the Legacy build output");
if (!existsSync(source)) throw new Error("Missing native extension source directory");
if (!existsSync(path.join(source, "src", "main.js"))) throw new Error("Missing native entry: native-extension/src/main.js");
if (!existsSync(asset)) throw new Error("Missing icon source: public/assets/tuzai-icon-source.png");

let build;
try {
  ({ build } = await import("esbuild"));
} catch {
  throw new Error("esbuild not found — run `npm install` first (esbuild ships with the vite toolchain)");
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await build({
  entryPoints: [path.join(source, "src", "main.js")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome100"],
  outfile: path.join(dist, "content.js"),
  minify: false,
  sourcemap: false,
  logLevel: "warning",
  legalComments: "none",
  banner: { js: "// Peek Native (M1) — bundled content script. Source: native-extension/src/*.js" }
});

// Build-time isolation gate: the artifact must not carry any Legacy-bridge
// marker. Keep this list in sync with tests/native/native-isolation.test.mjs.
const bundled = readFileSync(path.join(dist, "content.js"), "utf8");
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
const offenders = FORBIDDEN.filter((re) => re.test(bundled)).map((re) => String(re));
if (offenders.length) {
  throw new Error(`Native bundle contains forbidden markers (Legacy-bridge isolation violated): ${offenders.join(", ")}`);
}

cpSync(path.join(source, "manifest.json"), path.join(dist, "manifest.json"));
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

console.log(`Built unpacked Peek Native (M1) extension: ${dist}`);
