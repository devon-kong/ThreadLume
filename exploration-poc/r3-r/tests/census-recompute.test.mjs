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

test("复算：真实 R3-R 证据可读，判定由逐请求记录自洽推导", () => {
  // smoke: the committed evidence set recomputes cleanly (no synthetic data).
  // R4 G0-C note: the strict judge found real R3-R evidence non-equivalent
  // (spa: rest flow/timeline.json POST above the native round max — the old
  // name-only judge passed it). Whether that variance is X-natural or layout-
  // induced needs click-aligned windows, which the R4 census records; this
  // smoke asserts the tool's self-consistency on real data, not a verdict.
  const dir = new URL("../evidence/network/", import.meta.url).pathname;
  const result = recompute(dir);
  assert.ok(result.perCondition.native.rounds >= 2, "native evidence present");
  assert.ok(result.perCondition.r1.rounds >= 2, "r1 evidence present");
  assert.equal(result.verdict.pass, result.verdict.violations.length === 0, "pass ⇔ no violations");
  for (const v of result.verdict.violations) {
    assert.ok(["V1-new-api-op", "V2-api-count-above-max", "V3-method-mismatch"].includes(v.rule), "violations are named rules");
    assert.ok(result.judgments[v.scenario], "each violation belongs to a judged scenario");
  }
});

// ---------- R4 G0-C: the strict judge must catch shape differences ----------

test("G0-C 反例①：原生 TweetDetail=1、R1=2 不得判定为等价", () => {
  const dir = mkdtempSync(join(tmpdir(), "r3r-recompute-"));
  try {
    writeEvidence(dir, "native", "spa", 1, [GQL("TweetDetail")]);
    writeEvidence(dir, "r1", "spa", 1, [GQL("TweetDetail"), GQL("TweetDetail")]);
    const result = recompute(dir);
    assert.equal(result.verdict.pass, false, "a doubled api call is not equivalence");
    assert.ok(result.verdict.violations.some((v) => v.rule === "V2-api-count-above-max" && v.key === "graphql:TweetDetail:GET"),
      "V2 flags the count above the native round max");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("G0-C 反例②：同一操作 GET → POST（方法不一致）不得判定为等价", () => {
  const dir = mkdtempSync(join(tmpdir(), "r3r-recompute-"));
  try {
    writeEvidence(dir, "native", "first-nav", 1, [GQL("TweetDetail")]);
    writeEvidence(dir, "r1", "first-nav", 1, [{ cat: "graphql", op: "TweetDetail", method: "POST", rel: 100 }]);
    const result = recompute(dir);
    assert.equal(result.verdict.pass, false);
    assert.ok(result.verdict.violations.some((v) => v.rule === "V1-new-api-op" && v.key === "graphql:TweetDetail:POST"),
      "the POST variant is an operation shape native never sent");
    assert.ok(result.verdict.violations.some((v) => v.rule === "V3-method-mismatch" && v.key === "graphql:TweetDetail"),
      "V3 names the method difference explicitly");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("G0-C 反例③：单窗口重复调用（原生 [1,1]、R1 [2,1]）必须 FAIL", () => {
  const dir = mkdtempSync(join(tmpdir(), "r3r-recompute-"));
  try {
    writeEvidence(dir, "native", "first-nav", 1, [GQL("TweetDetail")]);
    writeEvidence(dir, "native", "first-nav", 2, [GQL("TweetDetail")]);
    writeEvidence(dir, "r1", "first-nav", 1, [GQL("TweetDetail"), GQL("TweetDetail")]);
    writeEvidence(dir, "r1", "first-nav", 2, [GQL("TweetDetail")]);
    const result = recompute(dir);
    assert.equal(result.verdict.pass, false, "aggregate equality (3 vs 3) must not hide a doubled window");
    const v = result.verdict.violations.find((x) => x.rule === "V2-api-count-above-max");
    assert.equal(v.r1RoundMax, 2);
    assert.equal(v.nativeRoundMax, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("G0-C 自然波动：原生自身出现过的次数不算违规", () => {
  const dir = mkdtempSync(join(tmpdir(), "r3r-recompute-"));
  try {
    writeEvidence(dir, "native", "first-nav", 1, [GQL("TweetDetail")]);
    writeEvidence(dir, "native", "first-nav", 2, [GQL("TweetDetail"), GQL("TweetDetail")]); // X itself fluctuates
    writeEvidence(dir, "r1", "first-nav", 1, [GQL("TweetDetail"), GQL("TweetDetail")]);
    writeEvidence(dir, "r1", "first-nav", 2, [GQL("TweetDetail")]);
    const result = recompute(dir);
    assert.equal(result.verdict.pass, true, "counts within the observed native variance pass");
    assert.equal(result.verdict.violations.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("G0-C 非 API 差异（媒体）是说明项不是违规：面板 <img> 命中缓存与否属预期", () => {
  const dir = mkdtempSync(join(tmpdir(), "r3r-recompute-"));
  try {
    writeEvidence(dir, "native", "first-nav", 1, [GQL("TweetDetail"), { cat: "media", op: "media-img", method: "GET", rel: 10 }, { cat: "media", op: "media-img", method: "GET", rel: 20 }]);
    writeEvidence(dir, "r1", "first-nav", 1, [GQL("TweetDetail"), { cat: "media", op: "media-img", method: "GET", rel: 10 }, { cat: "media", op: "media-img", method: "GET", rel: 20 }, { cat: "media", op: "media-img", method: "GET", rel: 30 }]);
    const result = recompute(dir);
    assert.equal(result.verdict.pass, true, "media extras are not internal-API violations");
    assert.equal(result.verdict.violations.length, 0);
    assert.ok(result.verdict.flags.some((f) => f.rule === "F1-non-api-extra" && f.key === "media:media-img:GET"),
      "the extra media load is reported as an explained flag");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("G0-C 分场景独立判断：一个场景违规即整体 FAIL，其余场景仍各自 PASS", () => {
  const dir = mkdtempSync(join(tmpdir(), "r3r-recompute-"));
  try {
    for (const round of [1, 2]) {
      writeEvidence(dir, "native", "first-nav", round, [GQL("TweetDetail")]);
      writeEvidence(dir, "r1", "first-nav", round, [GQL("TweetDetail")]);
      writeEvidence(dir, "native", "spa", round, [GQL("TweetDetail")]);
      writeEvidence(dir, "r1", "spa", round, [GQL("TweetDetail"), GQL("TweetDetail")]);
    }
    const result = recompute(dir);
    assert.equal(result.verdict.pass, false, "one failing scenario fails the overall verdict");
    assert.equal(result.judgments["first-nav"].violations.length, 0, "the clean scenario is judged on its own");
    assert.ok(result.judgments.spa.violations.length > 0, "the failing scenario is named");
    assert.ok(result.verdict.violations.every((v) => v.scenario === "spa"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
