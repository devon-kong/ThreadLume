// Produce the exact paired C1 browser protocol from the checked-in B2-B
// harness. Both variants use the same TaskSpace, page, four posts, two rounds,
// metric definitions and waits. The old virtualizer timing probe is omitted:
// C1 does not call X private React methods even for a benchmark.
// Usage: node prepare-perf-run.mjs <task-space-id> <baseline|c1-final> <output.mjs>
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const [spaceIdRaw, variant, output] = process.argv.slice(2);
const spaceId = Number(spaceIdRaw);
if (!Number.isInteger(spaceId) || spaceId <= 0 || !["baseline", "c1-final"].includes(variant) || !output) {
  throw new Error("usage: node prepare-perf-run.mjs <task-space-id> <baseline|c1-final> <output.mjs>");
}
const source = resolve("docs/m2-b2-b/evidence/perf.mjs");
let script = readFileSync(source, "utf8");
function replaceOnce(from, to) {
  if (!script.includes(from)) throw new Error(`B2-B protocol changed; missing: ${from.slice(0, 60)}`);
  script = script.replace(from, to);
}
replaceOnce('const MODE = typeof __MODE__ !== "undefined" ? __MODE__\n  : (typeof process !== "undefined" && process.env?.MODE) || "UNSET-MODE";', 'const MODE = "m2a";');
replaceOnce('const ROUNDS = Number(process.env.ROUNDS_N || 4);', 'const ROUNDS = 2;');
replaceOnce('const task = await taskSpace("peek l4 perf " + MODE);', `const task = await taskSpace(${spaceId});`);
replaceOnce('const page = task.page("p1");', `const page = task.page("p1");\nconst VARIANT = "${variant}";`);
const probeStart = script.indexOf('// ---------------- idle + wrapper overhead ----------------');
const outputStart = script.indexOf('import { writeFileSync } from "node:fs";', probeStart);
if (probeStart < 0 || outputStart < 0) throw new Error("B2-B protocol changed; cannot omit private-method probe");
script = script.slice(0, probeStart) + script.slice(outputStart);
replaceOnce('writeFileSync(`/Users/devon/claude/peek-main/docs/m2-b2-b/evidence/perf-results-${MODE}.json`, JSON.stringify(out, null, 1));',
  'writeFileSync(`/Users/devon/claude/peek-main/docs/m2-b2-c1/evidence/perf-${VARIANT}.json`, JSON.stringify(out, null, 1));');
writeFileSync(output, script);
