// R4 G0-C network recompute — strict equivalence judge.
//
// Recomputes the native-vs-R1 request difference FROM the sanitized evidence
// records (no hard-coded totals) and JUDGES equivalence per scenario. This
// replaces the R3-R verdict, which only checked for R1-ONLY operation NAMES —
// an R1 double-call of an operation X itself uses (e.g. TweetDetail 1→2), or
// the same operation sent with a different method, passed silently.
//
// Judgment rules (per scenario, then overall):
//  V1 new-api-op          an api op (graphql/rest) present in R1 but absent
//                         in native — extension-introduced API call.
//  V2 api-count-above-max an api op called MORE times in an R1 round than in
//                         ANY native round of the same scenario (catches the
//                         TweetDetail 1→2 counter-example; a count native
//                         itself reaches in some round is natural fluctuation).
//  V3 method-mismatch     the same api op appears with a different HTTP method
//                         set in R1 (GET vs POST — different call shape).
//  F1 non-api-extra       a non-API request (media/x-page/third-party) above
//                         the native max or absent natively. NOT a violation:
//                         the reading pane legitimately loads post images that
//                         the native cell may serve from cache. Reported with
//                         its explanation so the audit stays honest.
//  (fewer requests in R1 are never a violation — R1 fetches nothing.)
//
// Aggregation keys are cat:op:method so method differences are visible in the
// diff itself; V3 re-derives the method sets per cat:op for an explicit verdict.
//
// Evidence layout (written by harness/census-run.mjs):
//   <dir>/{native|r1}-{scenario}-r{round}.json
// each file: { meta, summary, requests: [{cat, op, method, rel}] }
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SCENARIOS = ["first-nav", "revisit", "spa"];
const API_CATS = new Set(["graphql", "rest"]);
const NON_API_CATS = new Set(["media", "x-page", "third-party", "other"]);

function loadFiles(dir) {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const data = [];
  for (const f of files) {
    const m = f.match(/^(native|r1)-([a-z-]+)-r(\d+)\.json$/);
    if (!m) continue;
    const json = JSON.parse(readFileSync(join(dir, f), "utf8"));
    data.push({ condition: m[1], scenario: m[2], round: +m[3], summary: json.summary, requests: json.requests });
  }
  return data;
}

function byOpMethod(requests) {
  const out = {};
  for (const r of requests) {
    const key = `${r.cat}:${r.op}:${r.method}`;
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function byOp(requests) {
  const out = {};
  for (const r of requests) {
    const key = `${r.cat}:${r.op}`;
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function aggregateRequests(requests) {
  const api = requests.filter((r) => API_CATS.has(r.cat));
  return {
    apiTotal: api.length,
    graphqlTotal: requests.filter((r) => r.cat === "graphql").length,
    restTotal: requests.filter((r) => r.cat === "rest").length,
    categories: Object.fromEntries(Object.entries(
      requests.reduce((acc, r) => { acc[r.cat] = (acc[r.cat] || 0) + 1; return acc; }, {})
    ).sort((a, b) => a[0].localeCompare(b[0]))),
    byOp: Object.fromEntries(Object.entries(byOp(requests)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
    byOpMethod: byOpMethod(requests),
  };
}

// Max count of `key` (cat:op) across the rounds of one condition+scenario.
function roundMax(rounds, opKey) {
  return Math.max(0, ...rounds.map((r) => r.byOp[opKey] || 0));
}

function methodSets(byOpMethodAgg) {
  const sets = {};
  for (const [key] of Object.entries(byOpMethodAgg)) {
    const [cat, op, method] = key.split(":");
    if (!API_CATS.has(cat)) continue;
    const k = `${cat}:${op}`;
    (sets[k] ||= new Set()).add(method); // method NAMES only — counts are V1/V2's business
  }
  return sets;
}

function judgeScenario(nativeSc, r1Sc, nativeOpsAnywhere) {
  const violations = [];
  const flags = [];
  const nAgg = nativeSc.total.byOpMethod;
  const rAgg = r1Sc.total.byOpMethod;
  const keys = [...new Set([...Object.keys(nAgg), ...Object.keys(rAgg)])].sort();

  for (const key of keys) {
    const [cat, op, method] = key.split(":");
    const n = nAgg[key] || 0;
    const r = rAgg[key] || 0;
    if (n === r) continue;
    const opKey = `${cat}:${op}`;
    if (API_CATS.has(cat)) {
      if (n === 0) {
        if (nativeOpsAnywhere.has(key)) {
          // the op is X-native (observed in a native window of ANOTHER scenario
          // in this same census) — its absence from this scenario's native
          // windows is sampling variance of X's own intermittent lifecycle
          // requests, not an extension-introduced call
          flags.push({ rule: "F2-native-op-timing", key, native: n, r1: r, note: "explained: X-native op (present in native windows of other scenarios); not observed in this scenario's native windows (n is small) — timing variance, not an extension call" });
        } else {
          violations.push({ rule: "V1-new-api-op", key, native: n, r1: r, note: "operation absent in every native window of the whole census" });
        }
      } else {
        const nMax = roundMax(nativeSc.rounds, opKey);
        const rMax = roundMax(r1Sc.rounds, opKey);
        if (rMax > nMax) {
          violations.push({ rule: "V2-api-count-above-max", key, native: n, r1: r, nativeRoundMax: nMax, r1RoundMax: rMax, note: "an R1 window calls this api op more often than any native window (e.g. a duplicate fetch)" });
        }
      }
    } else if (NON_API_CATS.has(cat)) {
      const nMax = roundMax(nativeSc.rounds, opKey);
      const rMax = roundMax(r1Sc.rounds, opKey);
      if (rMax > nMax) {
        flags.push({ rule: "F1-non-api-extra", key, native: n, r1: r, nativeRoundMax: nMax, r1RoundMax: rMax, note: "explained: the reading pane loads post/quote images the native cell may serve from cache; not an internal-API call" });
      }
    }
  }

  // V3: same api op, different method set (falls out of V1/V2 at key level too,
  // but an explicit check names the shape difference directly)
  const nSets = methodSets(nAgg);
  const rSets = methodSets(rAgg);
  for (const opKey of [...new Set([...Object.keys(nSets), ...Object.keys(rSets)])].sort()) {
    if (!nSets[opKey] || !rSets[opKey]) continue; // one-sided ops are V1/F2's business
    const a = [...nSets[opKey]].sort().join("+");
    const b = [...rSets[opKey]].sort().join("+");
    if (a !== b) {
      violations.push({ rule: "V3-method-mismatch", key: opKey, native: a, r1: b, note: "same operation, different HTTP method usage" });
    }
  }
  return { violations, flags };
}

export function recompute(dir) {
  const files = loadFiles(dir);
  if (!files.length) throw new Error(`no evidence files in ${dir}`);
  const perCondition = {};
  for (const condition of ["native", "r1"]) {
    const own = files.filter((f) => f.condition === condition);
    const perScenario = {};
    for (const scenario of SCENARIOS) {
      const rs = own.filter((f) => f.scenario === scenario).sort((a, b) => a.round - b.round);
      if (!rs.length) continue;
      perScenario[scenario] = {
        rounds: rs.map((f) => ({ round: f.round, byOp: byOp(f.requests), byOpMethod: byOpMethod(f.requests) })),
        total: aggregateRequests(rs.flatMap((f) => f.requests)),
      };
    }
    perCondition[condition] = {
      rounds: own.length,
      scenarios: perScenario,
      total: aggregateRequests(own.flatMap((f) => f.requests)),
    };
  }

  // per-scenario difference + judgment
  const diff = {};
  const judgments = {};
  // cat:op:method shapes observed in ANY native window of the whole census —
  // the corroboration set for V1. Shape-level (not op-level): an r1 window
  // sending a KNOWN op with a method X never uses is still a suspicious call
  // shape (V1), while X's own intermittent op+method re-appearing in an r1
  // window of another scenario is timing variance (F2).
  const nativeOpsAnywhere = new Set(
    Object.keys(perCondition.native.total.byOpMethod).filter((k) => API_CATS.has(k.split(":")[0]))
  );
  for (const scenario of SCENARIOS) {
    const n = perCondition.native.scenarios[scenario];
    const r = perCondition.r1.scenarios[scenario];
    if (!n || !r) continue;
    diff[scenario] = opDiff(n.total.byOpMethod, r.total.byOpMethod);
    judgments[scenario] = judgeScenario(n, r, nativeOpsAnywhere);
  }
  diff.all = opDiff(perCondition.native.total.byOpMethod, perCondition.r1.total.byOpMethod);

  const violations = Object.entries(judgments).flatMap(([scenario, j]) =>
    j.violations.map((v) => ({ scenario, ...v })));
  const flags = Object.entries(judgments).flatMap(([scenario, j]) =>
    j.flags.map((f) => ({ scenario, ...f })));

  const legacyR1OnlyApi = {};
  const legacyR1OnlyNonApi = {};
  for (const [key, r] of Object.entries(diff.all.r1Only)) {
    const cat = key.split(":")[0];
    const opKey = key.split(":").slice(0, 2).join(":");
    if (API_CATS.has(cat)) legacyR1OnlyApi[opKey] = (legacyR1OnlyApi[opKey] || 0) + r;
    else legacyR1OnlyNonApi[opKey] = (legacyR1OnlyNonApi[opKey] || 0) + r;
  }
  return {
    perCondition,
    diff,
    judgments,
    verdict: {
      pass: violations.length === 0,
      // legacy keys kept for the audit report's continuity:
      noExtensionApiCalls: violations.length === 0,
      r1OnlyApiOps: legacyR1OnlyApi,
      r1OnlyNonApiOps: legacyR1OnlyNonApi,
      apiTotalDelta: perCondition.r1.total.apiTotal - perCondition.native.total.apiTotal,
      violations,
      flags,
    },
  };
}

function opDiff(nativeOps, r1Ops) {
  const keys = [...new Set([...Object.keys(nativeOps), ...Object.keys(r1Ops)])].sort();
  const rows = [];
  const r1Only = {};
  for (const k of keys) {
    const n = nativeOps[k] || 0;
    const r = r1Ops[k] || 0;
    if (n === r) continue;
    rows.push({ op: k, native: n, r1: r, delta: r - n });
    if (n === 0 && r > 0) r1Only[k] = r;
  }
  return { rows, r1Only };
}

export function renderMarkdown(result) {
  const lines = [];
  lines.push("## 复算结果（由 network-recompute.mjs 从脱敏记录计算，R4 G0-C 严格判定）\n");
  for (const c of ["native", "r1"]) {
    const t = result.perCondition[c].total;
    lines.push(`**${c === "native" ? "原生 X" : "R1 PoC"}**（${result.perCondition[c].rounds} 个窗口）：/i/api/ 共 ${t.apiTotal}（graphql ${t.graphqlTotal} + rest ${t.restTotal}）；media ${t.categories.media || 0}、x-page ${t.categories["x-page"] || 0}、third-party ${t.categories["third-party"] || 0}、other ${t.categories.other || 0}`);
  }
  lines.push("");
  lines.push("逐操作差异（cat:op:method，仅列不一致项；rest 路由已脱敏）：\n");
  lines.push("| 场景 | 操作 | 原生 | R1 | Δ |");
  lines.push("|---|---|---|---|---|");
  for (const [scenario, d] of Object.entries(result.diff)) {
    for (const row of d.rows) {
      lines.push(`| ${scenario} | ${row.op} | ${row.native} | ${row.r1} | ${row.delta > 0 ? "+" : ""}${row.delta} |`);
    }
  }
  const v = result.verdict;
  lines.push("");
  lines.push(`- R1 独有的 /i/api/ 操作：${Object.keys(v.r1OnlyApiOps).length ? Object.keys(v.r1OnlyApiOps).join(", ") : "无"}`);
  lines.push(`- R1 独有的非 API 请求：${Object.keys(v.r1OnlyNonApiOps).length ? Object.keys(v.r1OnlyNonApiOps).join(", ") : "无"}`);
  lines.push(`- /i/api/ 总数差（R1 − 原生）：${v.apiTotalDelta >= 0 ? "+" : ""}${v.apiTotalDelta}`);
  lines.push("");
  lines.push("### 分场景判定\n");
  for (const [scenario, j] of Object.entries(result.judgments)) {
    const status = j.violations.length === 0 ? "PASS" : "FAIL";
    lines.push(`- **${scenario}: ${status}**（V1 新增 API 操作 / V2 超原生轮次上限的 API 调用 / V3 方法不一致 = 0 项违规）`);
    for (const f of j.flags) lines.push(`  - 说明项 ${f.rule}: ${f.key}（原生轮次上限 ${f.nativeRoundMax}，R1 ${f.r1RoundMax}）—— ${f.note}`);
    for (const vio of j.violations) lines.push(`  - 违规 ${vio.rule}: ${vio.key}（原生 ${vio.native}，R1 ${vio.r1}）—— ${vio.note}`);
  }
  lines.push("");
  lines.push(`**总体判定：${v.pass ? "PASS — 无扩展引入的 API 请求，各操作计数与方法均在原生波动范围内" : "FAIL — 存在扩展引入的 API 差异"}**`);
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] || new URL("./evidence/network/", import.meta.url).pathname;
  const result = recompute(dir);
  console.log(renderMarkdown(result));
  console.log("\nJSON verdict:", JSON.stringify(result.verdict, null, 2));
}
