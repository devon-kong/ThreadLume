// Shared data-only contract. Tokenization and storage stay in the worker.
export const USAGE_TTL = 30 * 86400000;
export const USAGE_LIMIT = 500;
export const usageNumber = (value) =>
  Number.isSafeInteger(value) && value >= 0 && value <= 100000000
    ? value
    : null;
const milliseconds = (value) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= USAGE_TTL
    ? Math.round(value)
    : null;
const text = (value, max) =>
  typeof value === "string" &&
  value.length <= max &&
  !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : "";
const identifier = (value) =>
  typeof value === "string" && /^[\w-]{1,100}$/.test(value) ? value : "";
export const USAGE_BUSY = new Set(["queued", "running"]);
const statuses = new Set([
  ...USAGE_BUSY,
  "success",
  "error",
  "cancelled",
  "interrupted",
]);
const sources = new Set(["reported", "estimated"]);

export function reportedUsage(value) {
  const result = {};
  for (const [key, count] of Object.entries({
    inputTokens: value?.prompt_tokens,
    outputTokens: value?.completion_tokens,
    reasoningTokens: value?.completion_tokens_details?.reasoning_tokens,
    cachedInputTokens: value?.prompt_tokens_details?.cached_tokens,
  })) {
    if (usageNumber(count) !== null) result[key] = count;
  }
  return result;
}

export function cleanUsageRequest(value) {
  if (
    !value ||
    !Number.isInteger(value.index) ||
    value.index < 1 ||
    value.index > 9 ||
    !["single", "segment", "integrate", "probe"].includes(value.phase) ||
    !statuses.has(value.status)
  )
    return null;
  const result = {
    index: value.index,
    phase: value.phase,
    status: value.status,
    elapsedMs: milliseconds(value.elapsedMs) ?? 0,
    outputComplete: value.outputComplete === true,
  };
  for (const side of ["input", "output"]) {
    result[side + "Tokens"] = usageNumber(value[side + "Tokens"]);
    result[side + "Source"] =
      result[side + "Tokens"] !== null && sources.has(value[side + "Source"])
        ? value[side + "Source"]
        : "unknown";
  }
  result.reasoningTokens = usageNumber(value.reasoningTokens);
  result.cachedInputTokens = usageNumber(value.cachedInputTokens);
  return result;
}

export function cleanUsageRecord(value) {
  if (
    !value ||
    !identifier(value.id) ||
    !Number.isSafeInteger(value.startedAt) ||
    value.startedAt < 0 ||
    !statuses.has(value.status) ||
    !["generate", "probe"].includes(value.operation) ||
    !["article", "summary", "mindmap", "probe"].includes(value.mode) ||
    !["article", "video", "probe"].includes(value.kind) ||
    !Array.isArray(value.requests) ||
    value.requests.length > 9
  )
    return null;
  const requests = value.requests.map(cleanUsageRequest);
  if (
    requests.some((r) => !r) ||
    new Set(requests.map((r) => r.index)).size !== requests.length
  )
    return null;
  return {
    id: value.id,
    startedAt: value.startedAt,
    status: value.status,
    operation: value.operation,
    mode: value.mode,
    kind: value.kind,
    providerId: identifier(value.providerId),
    providerName: text(value.providerName, 80),
    model: text(value.model, 200),
    configVersion: identifier(value.configVersion),
    contextTokens: usageNumber(value.contextTokens),
    stream: value.stream === true,
    outputLanguage: value.outputLanguage === "zh-CN" ? "zh-CN" : "en",
    sourceId:
      typeof value.sourceId === "string" &&
      /^[a-f0-9]{32}$/.test(value.sourceId)
        ? value.sourceId
        : null,
    sourceTokens: usageNumber(value.sourceTokens),
    elapsedMs: milliseconds(value.elapsedMs) ?? 0,
    queueMs: milliseconds(value.queueMs),
    segmented: value.segmented === true,
    reusedNotes: value.reusedNotes === true,
    requests,
  };
}

export function usageTotals(record) {
  const requests = record?.requests || [],
    result = {
      requests: requests.length,
      requestMs: requests.reduce((sum, r) => sum + r.elapsedMs, 0),
    };
  for (const side of ["input", "output"]) {
    const known = requests.filter((r) => r[side + "Tokens"] !== null);
    result[side + "Tokens"] = known.length
      ? known.reduce((sum, r) => sum + r[side + "Tokens"], 0)
      : null;
    result[side + "Known"] = known.length;
    result[side + "Source"] = !known.length
      ? "unknown"
      : known.length < requests.length
        ? "partial"
        : known.every((r) => r[side + "Source"] === "reported")
          ? "reported"
          : known.every((r) => r[side + "Source"] === "estimated")
            ? "estimated"
            : "mixed";
  }
  result.outputComplete =
    requests.length > 0 &&
    requests.every((r) => r.outputComplete && r.outputTokens !== null);
  return result;
}
