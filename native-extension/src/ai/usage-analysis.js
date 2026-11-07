import { usageTotals, USAGE_BUSY } from "./usage.js";
export const usageModelKey = (record) =>
  JSON.stringify([record.providerId, record.model]);

export function filterUsageRecords(records, filters = {}, now = Date.now()) {
  let start = 0,
    end = Infinity;
  if (filters.range === "today") {
    const day = new Date(now);
    day.setHours(0, 0, 0, 0);
    start = day.getTime();
  }
  if (["7", "30"].includes(filters.range))
    start = now - Number(filters.range) * 86400000;
  if (filters.range === "custom") {
    if (filters.from) start = new Date(filters.from + "T00:00:00").getTime();
    if (filters.to) {
      const day = new Date(filters.to + "T00:00:00");
      day.setDate(day.getDate() + 1);
      end = day.getTime();
    }
  }
  const rows = records.filter((row) => {
    const totals = usageTotals(row);
    return (
      row.startedAt >= start &&
      row.startedAt < end &&
      (!filters.provider || usageModelKey(row) === filters.provider) &&
      (!filters.mode ||
        filters.mode === "all" ||
        (filters.mode === "generate"
          ? row.operation === "generate"
          : filters.mode === "summary"
            ? row.operation === "generate" && row.mode !== "mindmap"
            : row.mode === filters.mode)) &&
      (!filters.status || row.status === filters.status) &&
      (!filters.kind || row.kind === filters.kind) &&
      (!filters.language || row.outputLanguage === filters.language) &&
      (!filters.processing ||
        (filters.processing === "segmented") === row.segmented) &&
      (!["fresh", "reused"].includes(filters.reuse) ||
        (filters.reuse === "reused") === row.reusedNotes) &&
      (!filters.source ||
        row.sourceId?.includes(filters.source.trim().toLowerCase())) &&
      (filters.min === "" ||
        filters.min === undefined ||
        (totals.inputTokens !== null &&
          totals.inputTokens >= Number(filters.min))) &&
      (filters.max === "" ||
        filters.max === undefined ||
        (totals.inputTokens !== null &&
          totals.inputTokens <= Number(filters.max)))
    );
  });
  const value = (row) =>
    filters.sort === "elapsed"
      ? row.elapsedMs
      : filters.sort === "input"
        ? usageTotals(row).inputTokens
        : filters.sort === "output"
          ? USAGE_BUSY.has(row.status)
            ? null
            : usageTotals(row).outputTokens
          : row.startedAt;
  return rows.sort((a, b) => {
    const av = value(a),
      bv = value(b);
    if (av === null) return bv === null ? 0 : 1;
    if (bv === null) return -1;
    return (
      (filters.direction === "asc" ? 1 : -1) * (av - bv) ||
      b.startedAt - a.startedAt
    );
  });
}

export function summarizeUsage(records) {
  const totals = records.map((row) => {
    const values = usageTotals(row);
    return USAGE_BUSY.has(row.status)
      ? { ...values, outputTokens: null, outputSource: "unknown" }
      : values;
  });
  const summary = {
    records: records.length,
    generations: records.filter((r) => r.operation === "generate").length,
    requests: totals.reduce((sum, t) => sum + t.requests, 0),
  };
  for (const side of ["input", "output"]) {
    const known = totals.filter((t) => t[side + "Tokens"] !== null);
    summary[side + "Tokens"] = known.length
      ? known.reduce((sum, t) => sum + t[side + "Tokens"], 0)
      : null;
    summary[side + "Known"] = known.length;
    summary[side + "Source"] = !known.length
      ? "unknown"
      : known.every((t) => t[side + "Source"] === "reported")
        ? known.length < totals.length
          ? "partial"
          : "reported"
        : "mixed";
  }
  return summary;
}

function metric(rows, read, { median = false, source } = {}) {
  const values = rows
      .map(read)
      .filter((value) => value !== null)
      .sort((a, b) => a - b),
    count = values.length;
  const value = !count
    ? null
    : median
      ? (values[Math.floor((count - 1) / 2)] + values[Math.floor(count / 2)]) /
        2
      : values.reduce((sum, n) => sum + n, 0) / count;
  return {
    value,
    known: count,
    total: rows.length,
    source:
      source &&
      rows.every((row) => usageTotals(row)[source + "Source"] === "reported")
        ? "reported"
        : source
          ? "mixed"
          : "reported",
  };
}

export function compareUsageModels(records, { includeReused = false } = {}) {
  const groups = new Map();
  for (const row of records) {
    if (row.operation !== "generate") continue;
    const key = usageModelKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()]
    .map((rows) => {
      const eligible = rows.filter(
        (row) =>
          row.status === "success" &&
          (includeReused || !row.reusedNotes) &&
          usageTotals(row).outputComplete,
      );
      const success = rows.filter(
          (row) => row.status === "success" && row.requests.length,
        ).length,
        failed = rows.filter(
          (row) => row.status === "error" && row.requests.length,
        ).length;
      return {
        providerId: rows[0].providerId,
        providerName: rows[0].providerName,
        model: rows[0].model,
        generations: rows.length,
        success,
        failed,
        successRate: success + failed ? success / (success + failed) : null,
        stopped: rows.filter((row) => row.status === "cancelled").length,
        interrupted: rows.filter((row) => row.status === "interrupted").length,
        eligible: eligible.length,
        elapsedMs: metric(eligible, (row) => row.elapsedMs, { median: true }),
        inputTokens: metric(eligible, (row) => usageTotals(row).inputTokens, {
          source: "input",
        }),
        outputTokens: metric(eligible, (row) => usageTotals(row).outputTokens, {
          source: "output",
        }),
      };
    })
    .sort(
      (a, b) => b.generations - a.generations || a.model.localeCompare(b.model),
    );
}
