import { test } from "node:test";
import assert from "node:assert/strict";
import { AIService } from "../../native-extension/src/ai/service.js";
import { ProviderStore } from "../../native-extension/src/ai/provider-store.js";
import { createCustomTransport } from "../../native-extension/src/ai/custom-transport.js";
const area = () => {
  const data = {};
  return {
    data,
    get: async (k) =>
      typeof k === "string"
        ? { [k]: structuredClone(data[k]) }
        : structuredClone(data),
    set: async (v) => Object.assign(data, structuredClone(v)),
    remove: async (k) => delete data[k],
  };
};
const input = {
  kind: "article",
  focusId: "123",
  url: "https://x.com/a/status/123",
  title: "private title",
  text: "private source",
};
async function fixture({ enabled = false, wait } = {}) {
  const storage = { local: area(), session: area() };
  const providers = new ProviderStore({ storage, probe: async () => {} });
  let calls = 0;
  const transport = createCustomTransport({
    hasPermission: async () => true,
    fetchImpl: async () => {
      calls++;
      await wait?.();
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: { role: "assistant", content: '{"text":"Summary"}' },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      });
    },
  });
  const service = new AIService({
    storage,
    providers,
    requestCustom: (p, key, i, mode, signal, binding, emit, language) =>
      transport.generate(p, key, i, mode, signal, emit, language),
  });
  await service.init();
  await providers.save(
    {
      name: "Example",
      protocol: "chat-completions",
      baseURL: "https://api.example.test/v1",
      model: "example",
    },
    "private-key",
  );
  await service.savePreferences({ saveUsageHistory: enabled });
  return { service, storage, providers, calls: () => calls };
}
test("default-off generation returns statistics without persisting numeric generation measurements", async () => {
  const f = await fixture(),
    events = [];
  const result = await f.service.generate("a", input, "article", {
    onProgress: (e) => events.push(e),
    outputLanguage: "en",
  });
  assert.ok(result.statistics);
  assert.equal(result.statistics.requests[0].inputTokens, 100);
  assert.equal(result.statistics.requests[0].outputTokens, 20);
  await new Promise((r) => setTimeout(r, 0));
  await f.service.metricsWrite;
  assert.equal(f.storage.local.data.aiUsageHistoryV1, undefined);
  assert.equal(f.storage.session.data.aiPerformanceV12, undefined);
  const cached = f.storage.local.data.aiCache;
  assert.equal(JSON.stringify(cached).includes("inputTokens"), false);
  assert.equal(JSON.stringify(cached).includes("elapsedMs"), false);
  assert.equal(JSON.stringify(cached).includes("usageId"), false);
  assert.ok(events.some((e) => e.stage === "statistics"));
});
test("shared generation produces one durable task and cached reads add no invocation", async () => {
  let release, entered;
  const started = new Promise((r) => (entered = r));
  const f = await fixture({
    enabled: true,
    wait: () => {
      entered();
      return new Promise((r) => (release = r));
    },
  });
  const first = f.service.generate("a", input, "article", {
    outputLanguage: "en",
  });
  await started;
  const second = f.service.generate("b", input, "article", {
    outputLanguage: "en",
  });
  await new Promise((r) => setTimeout(r, 5));
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.statistics.id, b.statistics.id);
  assert.equal(f.calls(), 1);
  assert.equal(typeof f.service.usageSnapshot, "function");
  const history = await f.service.usageSnapshot();
  assert.equal(history.records.length, 1);
  assert.equal(history.records[0].status, "success");
  const cached = await f.service.generate("c", input, "article", {
    outputLanguage: "en",
  });
  assert.equal(cached.cached, true);
  assert.equal(cached.statistics.id, a.statistics.id);
  assert.equal((await f.service.usageSnapshot()).records.length, 1);
  const data = JSON.stringify(f.storage.local.data.aiUsageHistoryV1);
  for (const value of [
    "private-key",
    "private title",
    "private source",
    "https://",
  ])
    assert.equal(data.includes(value), false);
});
test("turning collection off lets the admitted task finish recording and excludes subsequent tasks", async () => {
  let release, entered;
  const started = new Promise((r) => (entered = r));
  let blocked = true;
  const f = await fixture({
    enabled: true,
    wait: () => {
      if (!blocked) return;
      blocked = false;
      entered();
      return new Promise((r) => (release = r));
    },
  });
  const pending = f.service.generate("a", input, "article", {
    outputLanguage: "en",
  });
  await started;
  await f.service.savePreferences({ saveUsageHistory: false });
  release();
  await pending;
  await f.service.generate("b", { ...input, text: "Other source" }, "article", {
    outputLanguage: "en",
  });
  assert.equal((await f.service.usageSnapshot()).records.length, 1);
  const rows = f.storage.session.data.aiPerformanceV12 || [];
  assert.equal(
    rows.some((r) => r.owner === "b"),
    false,
  );
});
test("clearing while generation runs prevents its terminal callback from restoring history or cache statistics", async () => {
  let release, entered;
  const started = new Promise((r) => (entered = r)),
    f = await fixture({
      enabled: true,
      wait: () => {
        entered();
        return new Promise((r) => (release = r));
      },
    });
  const pending = f.service.generate("a", input, "article", {
    outputLanguage: "en",
  });
  await started;
  assert.equal(typeof f.service.clearUsageHistory, "function");
  await f.service.clearUsageHistory();
  release();
  await pending;
  assert.equal((await f.service.usageSnapshot()).records.length, 0);
  assert.equal(
    JSON.stringify(f.storage.local.data.aiCache).includes("usageId"),
    false,
  );
});

test("a closed initial statistics observer cannot fail another shared recipient", async () => {
  const f = await fixture();
  const first = f.service.generate("one", input, "article", {
    onProgress: () => {
      throw Error("closed");
    },
    outputLanguage: "en",
  });
  const second = f.service.generate("two", input, "article", {
    outputLanguage: "en",
  });
  await assert.doesNotReject(first);
  assert.equal((await second).text, "Summary");
  assert.equal(f.calls(), 1);
});

test("clearing also removes a session measurement write that was already in flight", async () => {
  let releaseNetwork, networkEntered;
  const networkStarted = new Promise((resolve) => (networkEntered = resolve)),
    f = await fixture({
      enabled: true,
      wait: () => {
        networkEntered();
        return new Promise((resolve) => (releaseNetwork = resolve));
      },
    });
  let releaseStorage, storageEntered;
  const storageStarted = new Promise((resolve) => (storageEntered = resolve)),
    set = f.storage.session.set;
  let block = true;
  f.storage.session.set = async (value) => {
    if (value.aiPerformanceV12 && block) {
      block = false;
      storageEntered();
      await new Promise((resolve) => (releaseStorage = resolve));
    }
    return set(value);
  };
  const generation = f.service.generate("owner", input, "article", {
    outputLanguage: "en",
  });
  await Promise.all([networkStarted, storageStarted]);
  const clearing = f.service.clearUsageHistory();
  releaseStorage();
  await clearing;
  assert.equal(f.storage.session.data.aiPerformanceV12, undefined);
  releaseNetwork();
  await generation;
  await f.service.metricsWrite;
  assert.equal(f.storage.session.data.aiPerformanceV12, undefined);
});

test("cancel returns the received stream output measurement before rejecting its generation owner", async () => {
  const storage = { local: area(), session: area() },
    providers = new ProviderStore({ storage, probe: async () => {} });
  const transport = createCustomTransport({
    hasPermission: async () => true,
    fetchImpl: async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                "data: " +
                  JSON.stringify({
                    choices: [
                      {
                        index: 0,
                        delta: { content: '{"text":"Received draft' },
                        finish_reason: null,
                      },
                    ],
                  }) +
                  "\n\n",
              ),
            );
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
  });
  const service = new AIService({
    storage,
    providers,
    requestCustom: (p, key, i, mode, signal, binding, emit, language) =>
      transport.generate(p, key, i, mode, signal, emit, language),
  });
  await service.init();
  await providers.save(
    {
      name: "Example",
      protocol: "chat-completions",
      baseURL: "https://api.example.test/v1",
      model: "m",
      stream: true,
    },
    "test-key",
  );
  let visible;
  const partial = new Promise((resolve) => (visible = resolve));
  const pending = service.generate("owner", input, "article", {
    outputLanguage: "en",
    onProgress: (event) => {
      if (event.stage === "partial") visible();
    },
  });
  pending.catch(() => {});
  await partial;
  const snapshots = service.cancel("owner");
  assert.ok(Array.isArray(snapshots));
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].status, "cancelled");
  assert.ok(snapshots[0].requests[0].outputTokens > 0);
  assert.equal(snapshots[0].requests[0].outputSource, "estimated");
  assert.equal(snapshots[0].requests[0].outputComplete, false);
  await assert.rejects(pending, /Cancelled|CANCELLED/);
});
