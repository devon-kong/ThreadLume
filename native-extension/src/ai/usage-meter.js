// Worker-only measurement. No prompt, response, endpoint or credential is retained.
import { md5 } from "./protocol.js";
import { estimateTokens } from "./request-budget.js";
import { cleanUsageRecord, cleanUsageRequest, USAGE_BUSY } from "./usage.js";

export function createUsageTask({
  id = crypto.randomUUID(),
  provider,
  input,
  mode,
  outputLanguage = "en",
  history,
  save = false,
  onChange = () => {},
  clock = () => performance.now(),
  now = Date.now,
} = {}) {
  const started = clock(),
    ticket = history?.ticket();
  const source = input
    ? JSON.stringify([
        input.kind,
        input.url,
        input.title,
        input.text,
        input.duration || 0,
        input.cues || null,
      ])
    : null;
  const row = {
    id,
    startedAt: now(),
    status: "queued",
    operation: mode === "probe" ? "probe" : "generate",
    mode,
    kind: input?.kind || "probe",
    providerId: provider?.id || "",
    providerName: provider?.name || "",
    model: provider?.model || "",
    configVersion: provider?.version || "",
    contextTokens: provider?.contextTokens ?? 32768,
    stream: provider?.stream === true,
    outputLanguage,
    sourceId: source ? md5(source) : null,
    sourceTokens: input
      ? estimateTokens(
          input.kind === "video"
            ? JSON.stringify(input.cues.map((c) => c.text))
            : input.text,
        )
      : null,
    elapsedMs: 0,
    queueMs: null,
    segmented: false,
    reusedNotes: false,
    requests: [],
  };
  const elapsed = () => Math.max(0, Math.round(clock() - started));
  const snapshot = () =>
    cleanUsageRecord({
      ...row,
      elapsedMs: USAGE_BUSY.has(row.status) ? elapsed() : row.elapsedMs,
    });
  function changed() {
    const value = snapshot();
    if (save) history?.write(value, ticket);
    onChange(value);
  }
  changed();
  return {
    snapshot,
    get saved() {
      return save && history?.current(ticket);
    },
    get warning() {
      return save && history?.state() === "unavailable";
    },
    event(event) {
      if (!USAGE_BUSY.has(row.status)) return;
      if (event.stage === "executing") {
        row.status = "running";
        row.queueMs = elapsed();
      } else if (event.stage === "plan") {
        row.segmented = true;
        row.reusedNotes = event.requests === 1;
      } else if (event.stage === "usage") {
        const request = cleanUsageRequest(event.request);
        if (!request) return;
        row.requests = row.requests.filter((r) => r.index !== request.index);
        row.requests.push(request);
        row.requests.sort((a, b) => a.index - b.index);
      } else return;
      changed();
    },
    finish(status) {
      if (!USAGE_BUSY.has(row.status)) return;
      row.status = ["success", "error", "cancelled"].includes(status)
        ? status
        : "error";
      row.elapsedMs = elapsed();
      for (const request of row.requests)
        if (USAGE_BUSY.has(request.status)) {
          request.status = row.status;
          request.outputComplete = false;
        }
      changed();
    },
  };
}
