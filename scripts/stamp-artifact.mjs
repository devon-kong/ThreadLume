// Stamp an ALREADY-BUILT Peek Native artifact directory with the shared
// artifact-identity prologue (scripts/artifact-prologue.mjs).
//
// Used for frozen measurement baselines that predate the build-script
// integration (e.g. dist-extension-native-lab-b1r-baseline): run it on a
// STAGING COPY, never on the pristine baseline directory itself.
//
//   node scripts/stamp-artifact.mjs <distDir> <mode>
//
// The prologue is prepended to content.js; the build id is derived from the
// exact bytes of that bundle, so re-stamping the same file changes its id
// (append-only marker by design — a directory is stamped at most once).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { artifactPrologue, buildIdFor } from "./artifact-prologue.mjs";

const [dir, mode] = process.argv.slice(2);
if (!dir || !mode) {
  console.error("usage: node scripts/stamp-artifact.mjs <distDir> <mode>");
  process.exit(1);
}
if (!["m1r", "b1r", "m2a"].includes(mode)) throw new Error(`bad mode: ${mode}`);
const contentPath = path.join(dir, "content.js");
if (!existsSync(contentPath)) throw new Error(`missing ${contentPath}`);
const bundled = readFileSync(contentPath, "utf8");
if (bundled.includes("data-peek-artifact")) throw new Error(`${contentPath} is already stamped`);
const buildId = buildIdFor(mode, bundled);
writeFileSync(contentPath, artifactPrologue(buildId, mode) + bundled);
console.log(`stamped ${dir} → build ${buildId} (mode ${mode})`);
