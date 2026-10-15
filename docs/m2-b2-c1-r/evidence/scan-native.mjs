// Independent scan of the actual unpacked C1-R Native build; writes a sanitized summary.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const root = resolve("dist-extension-native-lab");
const files = ["content.js", "layout-adapter-main.js"];
const patterns = {
  fetchCall: /\bfetch\s*\(/g,
  xhr: /\bXMLHttpRequest\b/g,
  queryId: /\bqueryId\b/g,
  authorization: /\bAuthorization\b/g,
  csrf: /x-csrf-token|\bcsrf\b/gi,
  cookieRead: /document\.cookie/g,
  privateApiPath: /\/i\/api\//g,
  legacyBridge: /page-bridge|__tuzaiPageBridgeInstalled/g,
  webpackProbe: /webpackChunk|__webpack_require__/g,
};
const scanned = Object.fromEntries(files.map((file) => {
  const bytes = readFileSync(resolve(root, file));
  const source = bytes.toString("utf8");
  return [file, { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length,
    counts: Object.fromEntries(Object.entries(patterns).map(([key, regex]) => [key, [...source.matchAll(regex)].length])) }];
}));
const manifest = JSON.parse(readFileSync(resolve(root, "manifest.json"), "utf8"));
const result = { files: scanned, manifest: {
  manifest_version: manifest.manifest_version,
  permissions: manifest.permissions ?? [],
  host_permissions: manifest.host_permissions ?? [],
  background: manifest.background ?? null,
  matches: manifest.content_scripts?.flatMap((x) => x.matches ?? []) ?? [],
}, pass: Object.values(scanned).every((file) => Object.values(file.counts).every((n) => n === 0))
  && !(manifest.permissions?.length || manifest.host_permissions?.length || manifest.background) };
writeFileSync(resolve("docs/m2-b2-c1-r/evidence/security-scan.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
if (!result.pass) process.exitCode = 1;
