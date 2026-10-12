// R3-R network recompute — recalculates the request distribution and the
// native-vs-R1 difference FROM the sanitized evidence records (no hard-coded
// totals). Used by the audit report, the CLI below, and the offline test
// (which feeds synthetic evidence and asserts the computed diff, including a
// deliberate R1-only operation — proving the checker can fail).
//
// Evidence layout (written by harness/census-run.mjs):
//   <dir>/{native|r1}-{scenario}-r{round}.json
// each file: { meta, summary, requests: [{cat, op, method, rel}] }
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SCENARIOS = ["first-nav", "revisit", "spa"];

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

function aggregateRequests(requests) {
  const byOp = {};
  const categories = {};
  for (const r of requests) {
    const key = `${r.cat}:${r.op}`;
    byOp[key] = (byOp[key] || 0) + 1;
    categories[r.cat] = (categories[r.cat] || 0) + 1;
  }
  const api = requests.filter((r) => r.cat === "graphql" || r.cat === "rest");
  return {
    apiTotal: api.length,
    graphqlTotal: requests.filter((r) => r.cat === "graphql").length,
    restTotal: requests.filter((r) => r.cat === "rest").length,
    categories,
    byOp,
  };
}

export function recompute(dir) {
  const files = loadFiles(dir);
  if (!files.length) throw new Error(`no evidence files in ${dir}`);
  const perCondition = {};
  for (const condition of ["native", "r1"]) {
    const own = files.filter((f) => f.condition === condition);
    const perScenario = {};
    for (const scenario of SCENARIOS) {
      const rs = own.filter((f) => f.scenario === scenario);
      if (!rs.length) continue;
      const all = rs.flatMap((f) => f.requests);
      perScenario[scenario] = { rounds: rs.length, ...aggregateRequests(all) };
    }
    perCondition[condition] = {
      rounds: own.length,
      scenarios: perScenario,
      total: aggregateRequests(own.flatMap((f) => f.requests)),
    };
  }
  // difference per scenario, plus the aggregate over all rounds
  const diff = {};
  for (const scenario of SCENARIOS) {
    const n = perCondition.native.scenarios[scenario];
    const r = perCondition.r1.scenarios[scenario];
    if (!n || !r) continue;
    diff[scenario] = opDiff(n.byOp, r.byOp);
  }
  diff.all = opDiff(perCondition.native.total.byOp, perCondition.r1.total.byOp);
  const extensionAddedApi = Object.entries(diff.all.r1Only)
    .filter(([key]) => key.startsWith("graphql:") || key.startsWith("rest:"));
  const extensionAddedNonApi = Object.entries(diff.all.r1Only)
    .filter(([key]) => !key.startsWith("graphql:") && !key.startsWith("rest:"));
  return {
    perCondition,
    diff,
    verdict: {
      r1OnlyApiOps: Object.fromEntries(extensionAddedApi),
      r1OnlyNonApiOps: Object.fromEntries(extensionAddedNonApi),
      apiTotalDelta: perCondition.r1.total.apiTotal - perCondition.native.total.apiTotal,
      noExtensionApiCalls: extensionAddedApi.length === 0,
      noExtensionNonApiCalls: extensionAddedNonApi.length === 0,
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
  lines.push("## 复算结果（由 network-recompute.mjs 从脱敏记录计算）\n");
  for (const c of ["native", "r1"]) {
    const t = result.perCondition[c].total;
    lines.push(`**${c === "native" ? "原生 X" : "R1 PoC"}**（${result.perCondition[c].rounds} 个窗口）：/i/api/ 共 ${t.apiTotal}（graphql ${t.graphqlTotal} + rest ${t.restTotal}）；media ${t.categories.media || 0}、x-page ${t.categories["x-page"] || 0}、third-party ${t.categories["third-party"] || 0}、other ${t.categories.other || 0}`);
  }
  lines.push("");
  lines.push("逐操作差异（仅列不一致项；rest 路由已脱敏）：\n");
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
  return lines.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] || new URL("./evidence/network/", import.meta.url).pathname;
  const result = recompute(dir);
  console.log(renderMarkdown(result));
  console.log("\nJSON verdict:", JSON.stringify(result.verdict, null, 2));
}
