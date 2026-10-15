import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (variant, round) => JSON.parse(readFileSync(resolve(dir, `perf-${variant}-r${round}.json`), "utf8"));
const runs = [read("b2b", 1), read("c1r", 1), read("c1r", 2), read("b2b", 2)];
for (const run of runs) {
  const hash = run.variant === "b2b" ? "3abb7ea0aa" : "de549bd02f";
  if (run.expectedHash !== hash || run.results.length !== 3) throw new Error("unexpected run identity or sample count");
  for (const row of run.results) {
    if (!row.identity?.build?.endsWith(hash) || row.identity?.mode !== "m2a" || row.identity?.conflict) {
      throw new Error(`wrong browser artifact: ${run.variant} r${run.round} ${row.sample}`);
    }
    if (row.navigation !== "OPENED" || !row.actualHit?.reached || !row.actualHitBefore?.isTarget) {
      throw new Error(`invalid click: ${run.variant} r${run.round} ${row.sample}`);
    }
    if (row.t2b == null && !row.nullReason) throw new Error("unclassified T2b null");
  }
}
const median = (xs) => {
  const sorted = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const by = (variant, round, sample) => runs.find((r) => r.variant === variant && r.round === round)
  .results.find((r) => r.sample === sample);
const samples = ["ordinary-video", "high-comment", "multi-level"];
const pairs = [1, 2].flatMap((round) => samples.map((sample) => {
  const a = by("b2b", round, sample), b = by("c1r", round, sample);
  return { round, sample, b2b: a, c1r: b };
}));
const fields = ["t1a", "t1b", "t2a", "t2b", "t4a", "t4b"];
const metrics = {};
for (const field of fields) {
  const raw = pairs.map(({ round, sample, b2b, c1r }) => ({
    round, sample,
    b2b: Number.isFinite(b2b[field]) ? Math.round(b2b[field] * 10) / 10 : null,
    c1r: Number.isFinite(c1r[field]) ? Math.round(c1r[field] * 10) / 10 : null,
    delta: Number.isFinite(b2b[field]) && Number.isFinite(c1r[field])
      ? Math.round((c1r[field] - b2b[field]) * 10) / 10 : null,
    invalid: { b2b: b2b[field] == null ? (b2b.nullReason || "NOT_APPLICABLE") : null,
      c1r: c1r[field] == null ? (c1r.nullReason || "NOT_APPLICABLE") : null },
  }));
  const valid = raw.filter((x) => x.delta !== null);
  metrics[field] = {
    pairedN: valid.length, attemptedPairs: raw.length, pairedRate: valid.length / raw.length,
    b2bMedian: median(valid.map((x) => x.b2b)), c1rMedian: median(valid.map((x) => x.c1r)),
    medianPairedDelta: median(valid.map((x) => x.delta)),
    slowestValid: valid.length ? Math.max(...valid.flatMap((x) => [x.b2b, x.c1r])) : null,
    raw,
  };
}
const t1a = metrics.t1a, t1b = metrics.t1b, t2b = metrics.t2b, t4b = metrics.t4b;
const gates = {
  t1aCandidate: t1a.pairedN === 4 && t1a.c1rMedian <= 100 && t1a.medianPairedDelta <= 30,
  t1b: t1b.pairedN === 6 && t1b.medianPairedDelta <= Math.max(50, t1b.b2bMedian * .1),
  t2bCandidate: t2b.pairedN >= 6 && new Set(t2b.raw.filter((x) => x.delta !== null).map((x) => x.sample)).size >= 2
    && t2b.medianPairedDelta <= Math.max(100, t2b.b2bMedian * .1),
  t4b: t4b.pairedN === 6 && t4b.medianPairedDelta <= Math.max(150, t4b.b2bMedian * .1),
};
const result = { protocol: "one browser, 3 preregistered public samples, AB/BA, monitor-before-click, no pre-T2b deep scroll",
  sampledBuilds: { b2b: "3abb7ea0aa", c1r: "de549bd02f" }, metrics, gates,
  t2bVerified: { n: 0, reason: "X public DOM did not expose stable parent identity" },
  videoIdentityInPerf: "immediate deep-scroll check only; separate settled same-element test required" };
writeFileSync(resolve(dir, "perf-analysis.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ gates, summary: Object.fromEntries(fields.map((x) => [x, {
  n: metrics[x].pairedN, baseline: metrics[x].b2bMedian, c1r: metrics[x].c1rMedian,
  pairedDelta: metrics[x].medianPairedDelta, slowest: metrics[x].slowestValid,
}])) }, null, 2));
