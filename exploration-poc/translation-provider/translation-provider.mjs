// TranslationProvider / TranslationScheduler — synthetic verification implementation.
// No network calls here: the backend is injected. DBC protocol/auth/quota are NOT
// assumed (task book 8.4); any backend that fulfils the contract below can plug in.
//
// Contract:
//   backend = async ({ text, sourceLanguage, targetLanguage, taskId, signal }) =>
//     { text: translatedText, sourceLanguage?, targetLanguage? }
//   The backend receives ONLY the fields the caller explicitly selected for
//   out-of-tab delivery (task book: 只发送已选定且被告知会外发的必要文本).

export class TranslationError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = "TranslationError";
    this.code = code; // "cancelled" | "timeout" | "backend" | "stale"
    this.cause = cause;
  }
}

export class TranslationScheduler {
  constructor({
    backend,
    concurrency = 2,        // task book: 翻译并发上限 2
    timeoutMs = 12000,
    cacheLimit = 300,       // per-tab in-memory cache cap
    now = () => Date.now()
  } = {}) {
    if (typeof backend !== "function") throw new Error("backend required");
    this.backend = backend;
    this.concurrency = Math.max(1, concurrency);
    this.timeoutMs = timeoutMs;
    this.cacheLimit = cacheLimit;
    this.now = now;
    this.generation = 0;        // bumped on close/post-switch; old results dropped
    this.cache = new Map();     // key -> { text, generation }
    this.inflight = new Map();  // key -> Promise<result> (dedup)
    this.queue = [];
    this.active = 0;
  }

  static cacheKey({ text, sourceLanguage, targetLanguage }) {
    return `${targetLanguage || ""}::${sourceLanguage || "auto"}::${text}`;
  }

  // generation-scoped read: entries from an older reading context never surface
  peek(request) {
    const hit = this.cache.get(TranslationScheduler.cacheKey(request));
    return hit && hit.generation === this.generation ? hit.result : undefined;
  }

  schedule(request, { signal } = {}) {
    const key = TranslationScheduler.cacheKey(request);
    const cached = this.peek(request);
    if (cached) return Promise.resolve({ ...cached, fromCache: true });
    const existing = this.inflight.get(key);
    if (existing) return existing; // dedup: same text shares one request AND one fate —
    // a caller-aborted twin rejects every sharer with "cancelled"; per-caller
    // cancellation requires per-caller wrappers above this scheduler.
    if (signal?.aborted) return Promise.reject(new TranslationError("cancelled", "aborted before start", signal.reason));

    const generation = this.generation;
    let job;
    const promise = new Promise((resolve, reject) => {
      job = { key, request, generation, resolve, reject, signal };
      this.queue.push(job);
    });
    job.owner = promise;
    // keep inflight keyed even while queued so duplicates coalesce;
    // pump only after the key is registered so sync paths cannot miss it
    this.inflight.set(key, promise);
    this.pump();
    return promise;
  }

  pump() {
    while (this.active < this.concurrency && this.queue.length) {
      const job = this.queue.shift();
      if (job.generation !== this.generation) {
        this.inflight.delete(job.key);
        job.reject(new TranslationError("stale", "reading context changed"));
        continue;
      }
      if (job.signal?.aborted) {
        this.inflight.delete(job.key);
        job.reject(new TranslationError("cancelled", "aborted while queued", job.signal.reason));
        continue;
      }
      this.active += 1;
      this.run(job).finally(() => {
        this.active -= 1;
        this.pump();
      });
    }
  }

  async run(job) {
    const { key, request, generation, resolve, reject, signal, owner } = job;
    const timeoutController = new AbortController();
    const onOuterAbort = () => timeoutController.abort(new TranslationError("cancelled", "caller aborted"));
    signal?.addEventListener("abort", onOuterAbort, { once: true });
    const timer = setTimeout(() => timeoutController.abort(new TranslationError("timeout", `translation timed out after ${this.timeoutMs}ms`)), this.timeoutMs);
    // The backend may ignore the abort signal; settle this job regardless.
    const aborts = new Promise((_, rejectAbort) => {
      timeoutController.signal.addEventListener("abort", () => rejectAbort(timeoutController.signal.reason), { once: true });
    });
    try {
      const result = await Promise.race([
        this.backend({ ...request, signal: timeoutController.signal }),
        aborts
      ]);
      if (generation !== this.generation) throw new TranslationError("stale", "reading context changed before completion");
      if (!result || typeof result.text !== "string" || !result.text.trim()) {
        throw new TranslationError("backend", "backend returned no translation");
      }
      const entry = { result: { text: result.text, sourceLanguage: result.sourceLanguage ?? request.sourceLanguage ?? "auto", targetLanguage: request.targetLanguage } };
      this.cache.set(key, { ...entry, generation });
      if (this.cache.size > this.cacheLimit) {
        const oldest = this.cache.keys().next().value;
        this.cache.delete(oldest);
      }
      resolve({ ...entry.result, fromCache: false });
    } catch (error) {
      reject(error instanceof TranslationError ? error : new TranslationError("backend", error?.message || "translation failed", error));
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onOuterAbort);
      if (this.inflight.get(key) === owner) this.inflight.delete(key);
    }
  }

  // Called on post switch / reader close: pending jobs resolve as stale,
  // cache from the old context stops being served. Never blocks the reader.
  reset() {
    this.generation += 1;
    this.cache.clear();
    this.inflight.clear();
    this.pump();
  }
}
