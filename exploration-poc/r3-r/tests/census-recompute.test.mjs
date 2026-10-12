// R3-R recompute-tool tests: the recomputation must derive everything from the
// saved sanitized records — including the ability to FAIL when the R1 records
// contain an extension-only operation (a hard-coded pass would not).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recompute } from "../network-recompute.mjs";

function writeEvidence(dir, condition, scenario, round, requests) {
  const summary = {
    apiTotal: requests.filter((r) => r.cat === "graphql" || r.cat === "rest").length,
  };
  writeFileSync(
    join(dir, `${condition}-${scenario}-r${round}.json`),
    JSON.stringify({ meta: { condition, scenario, round }, summary, requests }),
  );
}

const GQL = (op) => ({ cat: "graphql", op, method: "GET", rel: 100 });
const REST = (route) => ({ cat: "rest", op: route, method: "GET", rel: 200 });

test("复算：两条件一致时 verdict 为无扩展新增请求，计数全部由记录重导", () => {
  const dir = mkdtempSync(join(tmpdir(), "r3r-recompute-"));
  try {
    for (const round of [1, 2]) {
      writeEvidence(dir, "native", "first-nav", round, [GQL("TweetDetail"), REST("/i/api/1.1/hashflags.json"), REST("/i/api/1.1/hashflags.json")]);
      writeEvidence(dir, "r1", "first-nav", round, [GQL("TweetDetail"), REST("/i/api/1.1/hashflags.json"), REST("/i/api/1.1/hashflags.json")]);
    }
    const result = recompute(dir);
    assert.equal(result.perCondition.native.total.apiTotal, 6);
    assert.equal(result.perCondition.r1.total.apiTotal, 6);
    assert.equal(result.verdict.noExtensionApiCalls, true);
    assert.equal(result.verdict.apiTotalDelta, 0);
    assert.deepEqual(result.diff.all.rows, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("复算：R1 记录含扩展独有操作时必须判 FAIL（工具能失败）", () => {
  const dir = mkdtempSync(join(tmpdir(), "r3r-recompute-"));
  try {
    writeEvidence(dir, "native", "first-nav", 1, [GQL("TweetDetail"), REST("/i/api/1.1/hashflags.json")]);
    writeEvidence(dir, "r1", "first-nav", 1, [GQL("TweetDetail"), REST("/i/api/1.1/hashflags.json"), GQL("UserTweets")]);
    const result = recompute(dir);
    assert.equal(result.verdict.noExtensionApiCalls, false, "an R1-only graphql op must fail the check");
    assert.deepEqual(result.verdict.r1OnlyApiOps, { "graphql:UserTweets": 1 });
    assert.equal(result.verdict.apiTotalDelta, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("复算：summary 字段被无视，结论只来自逐请求记录", () => {
  const dir = mkdtempSync(join(tmpdir(), "r3r-recompute-"));
  try {
    // summary lies (says 5) but the records hold 2 — recompute must report 2
    writeFileSync(join(dir, "native-first-nav-r1.json"), JSON.stringify({
      meta: {},
      summary: { apiTotal: 5 },
      requests: [GQL("TweetDetail"), REST("/i/api/1.1/hashflags.json")],
    }));
    writeFileSync(join(dir, "r1-first-nav-r1.json"), JSON.stringify({
      meta: {},
      summary: { apiTotal: 5 },
      requests: [GQL("TweetDetail"), REST("/i/api/1.1/hashflags.json")],
    }));
    const result = recompute(dir);
    assert.equal(result.perCondition.native.total.apiTotal, 2, "counts derive from records");
    assert.equal(result.perCondition.r1.total.apiTotal, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("复算：真实 R3-R 证据可读且 verdict 与工具输出一致", () => {
  // smoke: the committed evidence set recomputes cleanly (no synthetic data)
  const dir = new URL("../evidence/network/", import.meta.url).pathname;
  const result = recompute(dir);
  assert.ok(result.perCondition.native.rounds >= 2, "native evidence present");
  assert.ok(result.perCondition.r1.rounds >= 2, "r1 evidence present");
  assert.equal(result.verdict.noExtensionApiCalls, true, "R1-only API ops must stay empty");
});
