import { test } from "node:test";
import assert from "node:assert/strict";
const analysis = await import(
  "../../native-extension/src/ai/usage-analysis.js"
).catch(() => ({}));
const now = new Date("2026-11-04T12:00:00").getTime();
const row = (id, elapsedMs, inputTokens, outputTokens, extra = {}) => ({
  id,
  startedAt: now,
  status: "success",
  operation: "generate",
  mode: "article",
  kind: "article",
  providerId: "one",
  providerName: "One",
  model: "m",
  elapsedMs,
  outputLanguage: "en",
  sourceId: "a".repeat(32),
  sourceTokens: 100,
  segmented: false,
  reusedNotes: false,
  requests: [
    {
      index: 1,
      phase: "single",
      status: "success",
      elapsedMs,
      inputTokens,
      inputSource: "reported",
      outputTokens,
      outputSource: outputTokens === null ? "unknown" : "reported",
      outputComplete: outputTokens !== null,
    },
  ],
  ...extra,
});
test("comparison uses successful complete generations for timing and separately counts failures, stop, interruption and probe", () => {
  assert.equal(typeof analysis.compareUsageModels, "function");
  const rows = [
    row("a", 1000, 100, 10),
    row("b", 3000, 300, 30),
    row("failed", 9000, 50, null, { status: "error" }),
    row("stop", 5000, 50, null, { status: "cancelled" }),
    row("interrupted", 5000, 50, null, { status: "interrupted" }),
    row("probe", 1, 1, 1, { operation: "probe" }),
    row("reused", 10, 5, 5, { reusedNotes: true }),
  ];
  const [model] = analysis.compareUsageModels(rows);
  assert.equal(model.generations, 6);
  assert.equal(model.successRate, 3 / 4);
  assert.equal(model.stopped, 1);
  assert.equal(model.interrupted, 1);
  assert.equal(model.eligible, 2);
  assert.equal(model.elapsedMs.value, 2000);
  assert.equal(model.inputTokens.value, 200);
  assert.equal(model.outputTokens.value, 20);
  const all = analysis.compareUsageModels(rows, { includeReused: true })[0];
  assert.equal(all.eligible, 3);
  assert.equal(all.elapsedMs.value, 1000);
});
test("unknown values stay out of sums and averages with explicit coverage and estimate provenance", () => {
  assert.equal(typeof analysis.summarizeUsage, "function");
  const rows = [
    row("a", 1000, 100, 10),
    row("b", 3000, 300, null),
    row("c", 2000, 200, 20, {
      requests: [
        {
          ...row("x", 1, 200, 20).requests[0],
          inputSource: "estimated",
          outputSource: "estimated",
        },
      ],
    }),
  ];
  const summary = analysis.summarizeUsage(rows);
  assert.equal(summary.inputTokens, 600);
  assert.equal(summary.outputTokens, 30);
  assert.equal(summary.outputKnown, 2);
  assert.equal(summary.outputSource, "mixed");
  assert.equal(summary.records, 3);
});
test("filtering handles time, model, task, input ranges and null-last sorting", () => {
  assert.equal(typeof analysis.filterUsageRecords, "function");
  const rows = [
    row("a", 1000, 100, 10),
    row("b", 3000, 300, 30),
    row("c", 4000, 400, null, { kind: "video", mode: "summary" }),
    row("expired", 5000, 500, 50, { startedAt: now - 31 * 86400000 }),
    row("probe", 2, 1, 1, { operation: "probe", mode: "probe", kind: "probe" }),
  ];
  assert.deepEqual(
    analysis
      .filterUsageRecords(
        rows,
        {
          range: "30",
          mode: "generate",
          min: "200",
          max: "450",
          sort: "output",
          direction: "desc",
        },
        now,
      )
      .map((r) => r.id),
    ["b", "c"],
  );
  assert.deepEqual(
    analysis
      .filterUsageRecords(
        rows,
        {
          range: "custom",
          from: "2026-11-04",
          to: "2026-11-04",
          mode: "summary",
          kind: "video",
        },
        now,
      )
      .map((r) => r.id),
    ["c"],
  );
  assert.deepEqual(
    analysis
      .filterUsageRecords(
        rows,
        { provider: JSON.stringify(["one", "m"]), mode: "probe" },
        now,
      )
      .map((r) => r.id),
    ["probe"],
  );
});
