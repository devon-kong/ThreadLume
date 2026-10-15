// Recompute C1 gates from raw, sanitized same-browser runs. Missing values
// remain missing; no run or target is silently discarded to improve medians.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const dir = resolve("docs/m2-b2-c1/evidence");
const read = (name) => JSON.parse(readFileSync(resolve(dir, name), "utf8"));
const a = read("perf-baseline.json");
const b = read("perf-c1-final.json");
const flat = (x) => x.rounds.flatMap((r) => r.samples.map((s) => ({ round: r.round, ...s })));
const rowsA = flat(a), rowsB = flat(b);
if (rowsA.length !== rowsB.length || rowsA.length !== 8) throw new Error("paired protocol expected 2 x 4 raw samples");
for (let i = 0; i < rowsA.length; i++) {
  if (rowsA[i].sample !== rowsB[i].sample || rowsA[i].target !== rowsB[i].target || rowsA[i].round !== rowsB[i].round) {
    throw new Error(`sample identity differs at row ${i}`);
  }
}
const num = (v) => typeof v === "number" && Number.isFinite(v);
const median = (values) => {
  const v = values.filter(num).sort((x, y) => x - y);
  return v.length ? (v[Math.floor((v.length - 1) / 2)] + v[Math.floor(v.length / 2)]) / 2 : null;
};
const fields = {
  t1a: (x) => x.t1a,
  t1b: (x) => x.t1b,
  t2a: (x) => x.t2aCandidate?.ms,
  t2b: (x) => x.t2bCandidate?.ms,
  t4a: (x) => x.t4?.a,
  t4b: (x) => x.t4?.stable,
};
const metrics = Object.fromEntries(Object.entries(fields).map(([name, get]) => {
  const valuesA = rowsA.map(get), valuesB = rowsB.map(get);
  const paired = rowsA.map((row, i) => ({ sample: row.sample, round: row.round,
    baseline: num(valuesA[i]) ? valuesA[i] : null,
    c1: num(valuesB[i]) ? valuesB[i] : null,
    delta: num(valuesA[i]) && num(valuesB[i]) ? valuesB[i] - valuesA[i] : null,
  }));
  const medA = median(valuesA), medB = median(valuesB);
  return [name, { baseline: { n: valuesA.filter(num).length, median: medA }, c1: { n: valuesB.filter(num).length, median: medB },
    medianDelta: medA !== null && medB !== null ? medB - medA : null,
    pairedN: paired.filter((x) => x.delta !== null).length,
    maxPairedDelta: paired.some((x) => x.delta !== null) ? Math.max(...paired.map((x) => x.delta).filter(num)) : null,
    paired,
  }];
}));
const gates = {
  t1a: metrics.t1a.c1.n === 8 && metrics.t1a.c1.median <= 100 && metrics.t1a.maxPairedDelta <= 30,
  t1b: metrics.t1b.c1.n === 8 && metrics.t1b.medianDelta <= Math.max(50, metrics.t1b.baseline.median * 0.1)
    && metrics.t1b.maxPairedDelta <= Math.max(50, metrics.t1b.baseline.median * 0.1),
  // Candidate visibility is sampled only when X puts a candidate in the
  // measured viewport. A median from fewer than half of the pairs cannot
  // establish a sustained non-regression gate for all content classes.
  t2b: metrics.t2b.pairedN >= 4 ? metrics.t2b.medianDelta <= Math.max(100, metrics.t2b.baseline.median * 0.1) : null,
  t4b: metrics.t4b.c1.n === 8 && metrics.t4b.medianDelta <= Math.max(150, metrics.t4b.baseline.median * 0.1)
    && metrics.t4b.maxPairedDelta <= Math.max(150, metrics.t4b.baseline.median * 0.1),
};
const extract = (rows) => rows.map((x) => ({ sample: x.sample, round: x.round, identity: x.identity,
  skipped: x.skipped ?? null, videoSame: x.videoIdentityAfterDeepScroll?.sameElement ?? null,
  focalCount: x.labIntegrity?.focalCount ?? null, state: x.labIntegrity?.state ?? null,
  longTasksDeep: x.longTasksDuringDeepScroll ?? null,
  domBefore: x.heapDom?.beforeClick?.dom ?? null, domAfter: x.heapDom?.afterScroll?.dom ?? null,
  heapBeforeMiB: x.heapDom?.beforeClick?.heap ?? null, heapAfterMiB: x.heapDom?.afterScroll?.heap ?? null,
  resources: x.resources ?? null,
}));
const result = { protocol: "same TaskSpace, account, viewport, sample order and B2-B monitor; 2 x 4 per variant",
  historicalB2BMediansAreNotUsedForGate: true, metrics, gates, baselineRows: extract(rowsA), c1Rows: extract(rowsB) };
writeFileSync(resolve(dir, "perf-analysis.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ gates, summary: Object.fromEntries(Object.entries(metrics).map(([k, x]) => [k, {
  baseline: x.baseline, c1: x.c1, delta: x.medianDelta, pairedN: x.pairedN,
  maxPairedDelta: x.maxPairedDelta,
}])) }, null, 2));
