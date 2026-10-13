// M2-B1-R — perf gate analysis (B4): reads perf-results-{lab,m1r,native}.json
// and computes the gate table honestly — medians, paired diffs, thresholds,
// missing samples, INCONCLUSIVE marking. No threshold is ever relaxed.
//   T1 gate: median regression ≤ max(50ms, 10% of M1-R same-caliber median)
//   T2 gate: median regression ≤ max(100ms, 10% of M1-R same-caliber median)
// T2 uses the native-reply-CANDIDATE caliber (documented limitation: current
// X DOM provides no parent-child proof for replies — same caliber all modes).
import { readFileSync, writeFileSync } from "node:fs";

const dir = new URL(".", import.meta.url).pathname;
const load = (m) => {
  try { return JSON.parse(readFileSync(`${dir}perf-results-${m}.json`, "utf8")); }
  catch { return null; }
};
const modes = { lab: load("lab"), m1r: load("m1r"), native: load("native") };

const median = (arr) => {
  const a = arr.filter((x) => x != null).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
// flatten: per kind → array of {ms, phase} or null
const collect = (data, field, { preScrollOnly = true } = {}) => {
  const byKind = {};
  if (!data) return byKind;
  for (const r of data.rounds) for (const s of r.samples) {
    if (!s.target || s.skipped) continue;
    const v = s[field];
    let val = null;
    if (typeof v === "number") val = { ms: v, phase: "pre-scroll" };
    else if (v && typeof v === "object" && v.ms != null) val = v;
    if (val && preScrollOnly && val.phase !== "pre-scroll") val = null;
    (byKind[s.sample] ??= []).push(val ? val.ms : null);
  }
  return byKind;
};
const paired = (a, b) => {
  // round-index pairing within each kind
  const out = [];
  const n = Math.min(a?.length ?? 0, b?.length ?? 0);
  for (let i = 0; i < n; i++) if (a[i] != null && b[i] != null) out.push(a[i] - b[i]);
  return out;
};

const T2FIELD = (data) => "t2aCandidate"; // candidate caliber (documented)
const kinds = ["video", "photos", "text", "highcomments"];

const table = [];
for (const kind of kinds) {
  const row = { kind };
  for (const [m, d] of Object.entries(modes)) {
    const t1 = collect(d, "t1")[kind] ?? [];
    const t2 = collect(d, T2FIELD(d))[kind] ?? [];
    row[m] = {
      t1: { vals: t1, median: median(t1), n: t1.filter((x) => x != null).length, missing: t1.filter((x) => x == null).length },
      t2: { vals: t2, median: median(t2), n: t2.filter((x) => x != null).length, missing: t2.filter((x) => x == null).length },
    };
  }
  // T4 close-relative: the harness stamps t4Left (detail left ≈ close click)
  // and t4Stable (stability) on ONE clock — their difference is exactly the
  // close→stable duration the contract defines, independent of stamp origin.
  for (const [m, d] of Object.entries(modes)) {
    const vals = [];
    if (d) for (const r of d.rounds) for (const s of r.samples) {
      if (s.sample !== kind || s.skipped) continue;
      const st = s.t4?.stable, lf = s.t4?.left;
      vals.push(typeof st === "number" && typeof lf === "number" ? Math.round(st - lf) : null);
    }
    row[m].t4 = { vals, median: median(vals), n: vals.filter((x) => x != null).length };
  }
  // paired diffs lab vs m1r (same round order)
  row.pairedT1 = paired(collect(modes.lab, "t1")[kind], collect(modes.m1r, "t1")[kind]);
  row.pairedT2 = paired(collect(modes.lab, T2FIELD(modes.lab))[kind], collect(modes.m1r, T2FIELD(modes.m1r))[kind]);
  table.push(row);
}

// gates
const gate = (kind, field) => {
  const row = table.find((r) => r.kind === kind);
  const base = row.m1r[field].median;
  const lab = row.lab[field].median;
  if (base == null || lab == null) return { verdict: "INCONCLUSIVE", reason: `missing data (m1r=${base}, lab=${lab})` };
  const threshold = field === "t1" ? Math.max(50, base * 0.10) : Math.max(100, base * 0.10);
  const delta = lab - base;
  return { verdict: delta <= threshold ? "PASS" : "FAIL", base, lab, delta: +delta.toFixed(1), threshold: +threshold.toFixed(1) };
};
const gates = {};
for (const kind of kinds) {
  gates[kind] = { t1: gate(kind, "t1"), t2: gate(kind, "t2") };
}

// Sensitivity (documented, not a gate replacement): M1-R's T1 is BIMODAL —
// its reading overlay can mount from the click cascade in ~20ms (local DOM
// extraction) or wait ~1s for X's own navigation render. Medians mixing the
// two paths are architecture noise, not adapter cost. The same-surface
// adapter-cost comparison is lab vs native (bare X): both measure X's own
// detail render.
const t1SameSurface = {};
for (const kind of kinds) {
  const row = table.find((r) => r.kind === kind);
  const labV = (collect(modes.lab, "t1")[kind] ?? []).filter((x) => x != null);
  const natV = (collect(modes.native, "t1")[kind] ?? []).filter((x) => x != null);
  const m1rSlow = (collect(modes.m1r, "t1")[kind] ?? []).filter((x) => x != null && x > 100);
  t1SameSurface[kind] = {
    labMedian: median(labV), nativeMedian: median(natV),
    labVsNativeDelta: median(labV) != null && median(natV) != null ? +(median(labV) - median(natV)).toFixed(1) : null,
    m1rSlowPathMedian: median(m1rSlow), m1rSlowPathN: m1rSlow.length, m1rAllN: (collect(modes.m1r, "t1")[kind] ?? []).filter((x) => x != null).length,
  };
}

// video identity + T4 + lab integrity summaries
const video = {};
for (const [m, d] of Object.entries(modes)) {
  if (!d) continue;
  const rows = [];
  for (const r of d.rounds) for (const s of r.samples) {
    if (s.sample !== "video") continue;
    rows.push({
      videoNode: s.video ? { appeared: Boolean(s.video.tag || s.video.missing !== undefined), firstPlayable: s.video.firstPlayableAt ?? null } : null,
      afterDeepScroll: s.videoIdentityAfterDeepScroll,
      integrity: s.labIntegrity ?? null,
    });
  }
  video[m] = rows;
}

const summary = {
  modes: Object.fromEntries(Object.entries(modes).map(([m, d]) => [m, d ? { rounds: d.rounds.length, env: d.env, wrapper: d.wrapper, idle: d.idle } : "MISSING"])),
  table, gates, t1SameSurface, video,
};
writeFileSync(`${dir}perf-analysis.json`, JSON.stringify(summary, null, 1));
console.log(JSON.stringify({ gates, t1SameSurface, t4med: table.map(r => ({ kind: r.kind, lab: r.lab.t4.median, m1r: r.m1r.t4.median, native: r.native.t4.median })), medians: table.map((r) => ({ kind: r.kind, m1rT1: r.m1r.t1.median, labT1: r.lab.t1.median, m1rT2: r.m1r.t2.median, labT2: r.lab.t2.median, m1rT4: r.m1r.t4.median, labT4: r.lab.t4.median })) }, null, 1));
