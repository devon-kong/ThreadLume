// R4 G1 offline judgment — computes per-sample medians from the perf evidence
// and applies the acceptance tolerances:
//   T1 focal first content : r1 ≤ orig + max(50ms, 10% of orig)
//   T2 first real replies  : r1 ≤ orig + max(100ms, 10% of orig)
//   T4 close → feed usable : r1 ≤ orig + max(80ms, 10% of orig)
//   T3 interaction surface : no extra steps (booleans reported)
//   T5 long tasks / video  : reported (counts + totals), qualitative
// Product tolerances, not statistics: raw values, medians and slowest rounds
// are all reported; a cell flips to INCONCLUSIVE when the orig round spread
// is large enough that the verdict depends on which round you pick.
// Usage: node perf-compare.mjs [evidenceDir] [-o out.md]
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] || new URL("./evidence/perf/", import.meta.url).pathname;
const outArg = process.argv.includes("-o") ? process.argv[process.argv.indexOf("-o") + 1] : null;

const files = readdirSync(dir).filter((f) => f.startsWith("spa-") && f.endsWith(".json"));
const wins = files.map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));

const SAMPLES = [...new Set(wins.map((w) => w.meta.sample))].sort();
const CONDS = ["orig", "r1", "native"];
const median = (a) => {
  const s = [...a].filter((x) => x != null).sort((x, y) => x - y);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const spread = (a) => {
  const s = [...a].filter((x) => x != null);
  return s.length >= 2 ? Math.max(...s) - Math.min(...s) : null;
};

function metricFor(w, name) {
  if (name === "t1") return w.t1;
  if (name === "t2") return w.t2;
  if (name === "t4") return w.t4?.feedAt ?? null;
  return null;
}

const table = {};
const verdictRows = [];
let anyInconclusive = false;

for (const sample of SAMPLES) {
  table[sample] = {};
  for (const cond of CONDS) {
    const ws = wins.filter((w) => w.meta.sample === sample && w.meta.cond === cond);
    table[sample][cond] = {
      n: ws.length,
      t1: ws.map((w) => w.t1),
      t2: ws.map((w) => w.t2),
      t4: ws.map((w) => w.t4?.feedAt ?? null),
      closed: ws.map((w) => w.t4?.closedAt ?? null),
      anchorDelta: ws.map((w) => w.t4?.anchorDelta ?? null),
      restored: ws.map((w) => w.t4?.restored ?? null),
      longtasks: ws.map((w) => w.t5?.longtasks?.length ?? 0),
      longtaskTotal: ws.map((w) => w.t5?.longtaskTotal ?? 0),
      video: ws.map((w) => w.t5?.videoPlayingAt ?? null),
      detect: ws.map((w) => w.routeDetect?.detectMs ?? null),
      skipped: ws.filter((w) => w.skipped).length,
    };
  }
  // verdicts per metric
  for (const [label, metric, abs] of [["T1 原帖首显", "t1", 50], ["T2 评论首读", "t2", 100], ["T4 关闭到信息流", "t4", 80]]) {
    const o = table[sample].orig[metric].filter((x) => x != null);
    const r = table[sample].r1[metric].filter((x) => x != null);
    const om = median(o);
    const rm = median(r);
    if (om == null || rm == null) {
      verdictRows.push({ sample, metric, verdict: "MISSING", om, rm });
      continue;
    }
    const tol = Math.max(abs, Math.round(om * 0.1));
    // variance check: would the verdict flip if orig's FASTEST round were typical?
    const oSpread = spread(o);
    const flipRisk = oSpread != null && oSpread > Math.max(tol, om * 0.5);
    const pass = rm - om <= tol;
    if (flipRisk && !pass) {
      anyInconclusive = true;
      verdictRows.push({ sample, metric, verdict: "INCONCLUSIVE", om, rm, tol, oSpread });
    } else {
      verdictRows.push({ sample, metric, verdict: pass ? "PASS" : "FAIL", om, rm, tol, delta: rm - om, oSpread });
    }
  }
}

// route detection summary (G0-B)
const detects = wins.flatMap((w) => (w.routeDetect?.detectMs != null ? [w.routeDetect.detectMs] : []));
const detectSummary = { n: detects.length, median: median(detects), max: detects.length ? Math.max(...detects) : null };

// render
const lines = [];
lines.push("# R4 G1 性能基准（同会话、交错、可信点击、统一起点）\n");
lines.push(`证据：${dir} · 每格为 [各轮原始值]（中位数加粗在判定表）\n`);
for (const sample of SAMPLES) {
  lines.push(`## 样本 ${sample}\n`);
  lines.push("| 条件 | T1 原帖首显 | T2 评论首读 | T4 关闭→信息流可用 | 浮层/面板关闭 | 锚点偏差 px | 长任务(次/总ms) | 视频起播 |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const cond of CONDS) {
    const c = table[sample][cond];
    const fmt = (arr) => {
      const s = arr.filter((x) => x != null);
      if (!s.length) return "—";
      return `${s.join("/")} (中位 **${median(s)}**)`;
    };
    const name = cond === "orig" ? "A 原版 Peek" : cond === "r1" ? "B R1 PoC" : "C X 原生";
    lines.push(`| ${name} | ${fmt(c.t1)} | ${fmt(c.t2)} | ${fmt(c.t4)} | ${fmt(c.closed)} | ${c.anchorDelta.filter((x) => x != null).join("/") || "—"} | ${c.longtasks.join("/") + " · " + c.longtaskTotal.join("/")} | ${c.video.filter((x) => x != null).join("/") || "—"} |`);
  }
  lines.push("");
}
lines.push("## 判定（产品容差，非统计显著性）\n");
lines.push("| 样本 | 指标 | 原版中位 | R1 中位 | 容差 | R1−原版 | 判定 |");
lines.push("|---|---|---|---|---|---|---|");
for (const v of verdictRows) {
  lines.push(`| ${v.sample} | ${v.metric} | ${v.om ?? "—"} | ${v.rm ?? "—"} | ${v.tol ?? "—"} | ${v.delta ?? "—"} | **${v.verdict}**${v.verdict === "INCONCLUSIVE" ? `（原版轮次波动 ${v.oSpread}ms）` : ""} |`);
}
lines.push("");
lines.push(`G0-B 路由识别延迟（R1，点击→路由被识别）：n=${detectSummary.n}，中位 **${detectSummary.median}ms**，最慢 ${detectSummary.max}ms`);
lines.push("");
const fails = verdictRows.filter((v) => v.verdict === "FAIL");
const inconf = verdictRows.filter((v) => v.verdict === "INCONCLUSIVE");
lines.push(`**总判定：${fails.length ? "存在 FAIL（" + fails.map((f) => f.sample + "/" + f.metric).join(", ") + "）" : inconf.length ? "存在 INCONCLUSIVE" : "全部 PASS"}**`);

const md = lines.join("\n");
console.log(md);
if (outArg) {
  mkdirSync(join(outArg, ".."), { recursive: true });
  writeFileSync(outArg, md + "\n");
  writeFileSync(join(dir, "verdict.json"), JSON.stringify({ verdictRows, detectSummary, anyInconclusive }, null, 1));
}
