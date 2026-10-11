// Synthetic tests for TranslationScheduler — no network, no X, no DBC.
import test from "node:test";
import assert from "node:assert/strict";
import { TranslationScheduler, TranslationError } from "./translation-provider.mjs";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

test("caches results per reading context (second call hits cache)", async () => {
  let calls = 0;
  const s = new TranslationScheduler({ backend: async (r) => { calls += 1; return { text: `T:${r.text}` }; } });
  const req = { text: "hello", targetLanguage: "zh" };
  const a = await s.schedule(req);
  const b = await s.schedule(req);
  assert.equal(calls, 1);
  assert.equal(a.text, "T:hello");
  assert.equal(b.fromCache, true);
});

test("deduplicates concurrent identical requests into one backend call", async () => {
  let calls = 0;
  const gate = deferred();
  const s = new TranslationScheduler({ backend: async (r) => { calls += 1; await gate.promise; return { text: `T:${r.text}` }; } });
  const req = { text: "dup", targetLanguage: "zh" };
  const px = s.schedule(req);
  const py = s.schedule(req);
  await new Promise((r) => setTimeout(r, 10)); // both registered before the backend settles
  gate.resolve();
  const [x, y] = await Promise.all([px, py]);
  assert.equal(calls, 1);
  assert.equal(x.text, "T:dup");
  assert.equal(y.text, "T:dup");
});

test("caps backend concurrency at 2 and keeps queue order", async () => {
  let inFlight = 0, maxInFlight = 0;
  const gates = [deferred(), deferred(), deferred(), deferred(), deferred()];
  let i = 0;
  const s = new TranslationScheduler({
    concurrency: 2,
    backend: async () => {
      inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
      const g = gates[i++];
      await g.promise;
      inFlight -= 1;
      return { text: "ok" };
    }
  });
  const jobs = ["a", "b", "c", "d", "e"].map((t) => s.schedule({ text: t, targetLanguage: "zh" }));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(maxInFlight, 2);
  gates[0].resolve(); gates[1].resolve();
  await new Promise((r) => setTimeout(r, 20));
  gates[2].resolve(); gates[3].resolve(); gates[4].resolve();
  const results = await Promise.all(jobs);
  assert.deepEqual(results.map((r) => r.text), ["ok", "ok", "ok", "ok", "ok"]);
});

test("caller cancellation rejects with cancelled and stops the backend via signal", async () => {
  const s = new TranslationScheduler({ backend: async (r) => {
    return new Promise((resolve, reject) => {
      r.signal.addEventListener("abort", () => reject(r.signal.reason));
      setTimeout(() => resolve({ text: "late" }), 50);
    });
  } });
  const ac = new AbortController();
  const job = s.schedule({ text: "cancel-me", targetLanguage: "zh" }, { signal: ac.signal });
  ac.abort();
  await assert.rejects(job, (e) => e instanceof TranslationError && e.code === "cancelled");
});

test("slow backend times out with a clear error", async () => {
  const s = new TranslationScheduler({ timeoutMs: 30, backend: () => new Promise(() => {}) });
  await assert.rejects(s.schedule({ text: "slow", targetLanguage: "zh" }), (e) => e instanceof TranslationError && e.code === "timeout");
});

test("reset() makes queued and in-flight jobs stale; old results never surface", async () => {
  const gates = [deferred(), deferred()];
  let call = 0;
  const s = new TranslationScheduler({ backend: async () => {
    const n = call++;
    if (n < 2) await gates[n].promise;
    return { text: n < 2 ? "old-context" : "new-context" };
  } });
  const p1 = s.schedule({ text: "one", targetLanguage: "zh" });
  const p2 = s.schedule({ text: "two", targetLanguage: "zh" });
  await new Promise((r) => setTimeout(r, 10));
  s.reset(); // user switched post / closed reader
  gates[0].resolve(); gates[1].resolve();
  const r1 = await p1.catch((e) => e);
  const r2 = await p2.catch((e) => e);
  assert.equal(r1.code, "stale");
  assert.equal(r2 instanceof TranslationError && ["stale", "cancelled"].includes(r2.code), true, `unexpected: ${r2?.code}`);
  // new context re-requests the same text: served by a fresh backend call, never the old cache
  const after = await s.schedule({ text: "one", targetLanguage: "zh" });
  assert.equal(after.text, "new-context");
  assert.equal(after.fromCache, false);
});

test("backend failure becomes a typed error; caller keeps original text (non-blocking contract)", async () => {
  const s = new TranslationScheduler({ backend: async () => { throw new Error("upstream 500"); } });
  await assert.rejects(s.schedule({ text: "x", targetLanguage: "zh" }), (e) => e instanceof TranslationError && e.code === "backend");
});

test("peek() never serves entries from an older generation", async () => {
  const s = new TranslationScheduler({ backend: async (r) => ({ text: `T:${r.text}` }) });
  const req = { text: "gen", targetLanguage: "zh" };
  await s.schedule(req);
  assert.ok(s.peek(req));
  s.reset();
  assert.equal(s.peek(req), undefined);
});

test("cache eviction keeps size under the limit", async () => {
  const s = new TranslationScheduler({ cacheLimit: 3, backend: async (r) => ({ text: `T:${r.text}` }) });
  for (const t of ["1", "2", "3", "4", "5"]) await s.schedule({ text: t, targetLanguage: "zh" });
  assert.ok(s.cache.size <= 3, `cache size ${s.cache.size}`);
});
