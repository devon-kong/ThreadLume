import { test } from "node:test";
import assert from "node:assert/strict";
const historyModule = await import(
  "../../native-extension/src/ai/usage-history.js"
).catch(() => ({}));
const meterModule = await import(
  "../../native-extension/src/ai/usage-meter.js"
).catch(() => ({}));
const area = () => {
  const data = {};
  return {
    data,
    get: async (key) => ({ [key]: structuredClone(data[key]) }),
    set: async (values) => Object.assign(data, structuredClone(values)),
  };
};
const now = 1800000000000;
function row(id, startedAt = now) {
  return {
    id,
    startedAt,
    status: "success",
    operation: "generate",
    kind: "article",
    mode: "article",
    providerId: "p",
    providerName: "Example",
    model: "model",
    configVersion: "v",
    contextTokens: 32768,
    stream: false,
    outputLanguage: "en",
    sourceId: "a".repeat(32),
    sourceTokens: 10,
    elapsedMs: 100,
    queueMs: 10,
    segmented: false,
    reusedNotes: false,
    requests: [
      {
        index: 1,
        phase: "single",
        status: "success",
        elapsedMs: 80,
        inputTokens: 20,
        inputSource: "reported",
        outputTokens: 5,
        outputSource: "reported",
        outputComplete: true,
      },
    ],
  };
}
async function create(storage = area(), clock = () => now) {
  assert.equal(typeof historyModule.createUsageHistory, "function");
  const history = historyModule.createUsageHistory({ storage, now: clock });
  await history.init();
  return { history, storage };
}
test("history bounds tasks to 500 and 30 days and removes expired records durably", async () => {
  let time = now;
  const { history, storage } = await create(undefined, () => time),
    ticket = history.ticket();
  for (let i = 0; i < 502; i++)
    history.write(row("job-" + i, now - 502 + i), ticket);
  history.write(row("expired", now - 30 * 86400000 - 1), ticket);
  assert.equal(history.snapshot().records.length, 500);
  assert.equal(history.snapshot().records[0].id, "job-501");
  await history.flush();
  assert.equal(storage.data.aiUsageHistoryV1.records.length, 500);
  time += 30 * 86400000 + 1;
  assert.equal(history.snapshot().records.length, 0);
  await history.flush();
  assert.equal(storage.data.aiUsageHistoryV1.records.length, 0);
});
test("clear invalidates late writers and cannot be undone by an older storage write", async () => {
  const { history, storage } = await create();
  let release, started;
  const entered = new Promise((r) => (started = r)),
    set = storage.set;
  let block = true;
  storage.set = async (values) => {
    if (block) {
      block = false;
      started();
      await new Promise((r) => (release = r));
    }
    return set(values);
  };
  const ticket = history.ticket();
  history.write(row("old"), ticket);
  await entered;
  const cleared = history.clear();
  history.write(row("old"), ticket);
  release();
  await cleared;
  await history.flush();
  assert.deepEqual(storage.data.aiUsageHistoryV1.records, []);
  history.write(row("new"), history.ticket());
  await history.flush();
  assert.equal(history.snapshot().records[0].id, "new");
});
test("restart marks unfinished tasks interrupted and persistence uses a strict field whitelist", async () => {
  const { history, storage } = await create();
  history.write(
    {
      ...row("pending"),
      status: "running",
      key: "private-key",
      rawResponse: "private-response",
      url: "https://x.com/private",
    },
    history.ticket(),
  );
  await history.flush();
  const text = JSON.stringify(storage.data);
  for (const secret of [
    "private-key",
    "private-response",
    "https://x.com/private",
  ])
    assert.equal(text.includes(secret), false);
  const restored = (await create(storage)).history;
  assert.equal(restored.snapshot().records[0].status, "interrupted");
});
test("empty initialization writes nothing and storage failure retains memory with unavailable status", async () => {
  const { history, storage } = await create();
  assert.deepEqual(storage.data, {});
  storage.set = async () => {
    throw Error("quota");
  };
  history.write(row("memory"), history.ticket());
  await history.flush();
  assert.equal(history.snapshot().persistence, "unavailable");
  assert.equal(history.snapshot().records.length, 1);
});
test("task meter replaces repeated request counters and sums segment plus integration totals", async () => {
  assert.equal(typeof meterModule.createUsageTask, "function");
  const { history } = await create();
  let clock = 0;
  const task = meterModule.createUsageTask({
    id: "task",
    provider: { id: "p", name: "Example", model: "m", version: "v" },
    input: {
      kind: "article",
      url: "https://x.com/a/status/123",
      title: "T",
      text: "private source",
    },
    mode: "article",
    outputLanguage: "en",
    history,
    save: true,
    clock: () => clock,
    now: () => now,
  });
  clock = 20;
  task.event({ stage: "executing" });
  task.event({ stage: "plan", total: 2, requests: 3 });
  const req = (index, inputTokens, outputTokens, phase) => ({
    stage: "usage",
    request: {
      index,
      phase,
      status: "success",
      elapsedMs: 100,
      inputTokens,
      inputSource: "reported",
      outputTokens,
      outputSource: "reported",
      outputComplete: true,
    },
  });
  task.event(req(1, 100, 10, "segment"));
  task.event(req(1, 100, 10, "segment"));
  task.event(req(2, 200, 20, "segment"));
  task.event(req(3, 50, 5, "integrate"));
  clock = 400;
  task.finish("success");
  await history.flush();
  const record = task.snapshot();
  const { usageTotals } = await import(
    "../../native-extension/src/ai/usage.js"
  );
  const totals = usageTotals(record);
  assert.equal(totals.inputTokens, 350);
  assert.equal(totals.outputTokens, 35);
  assert.equal(totals.requestMs, 300);
  assert.equal(record.queueMs, 20);
  assert.equal(record.elapsedMs, 400);
  assert.equal(record.requests.length, 3);
  assert.equal(
    JSON.stringify(history.snapshot()).includes("private source"),
    false,
  );
});
test("disabled meter keeps runtime statistics exclusively in memory", async () => {
  assert.equal(typeof meterModule.createUsageTask, "function");
  const { history, storage } = await create();
  const task = meterModule.createUsageTask({
    id: "off",
    provider: { id: "p", name: "Example", model: "m" },
    input: { kind: "article", title: "T", text: "Text" },
    mode: "article",
    history,
    save: false,
    now: () => now,
  });
  task.finish("success");
  await history.flush();
  assert.equal(task.snapshot().status, "success");
  assert.equal(history.snapshot().records.length, 0);
  assert.deepEqual(storage.data, {});
});

test("a failed history read preserves unknown durable data while accepting memory-only updates", async () => {
  const storage = area();
  storage.data.aiUsageHistoryV1 = { schema: 1, records: [row("existing")] };
  storage.get = async () => {
    throw Error("unavailable");
  };
  const { history } = await create(storage);
  history.write(row("new"), history.ticket());
  await history.flush();
  assert.equal(storage.data.aiUsageHistoryV1.records[0].id, "existing");
  assert.equal(history.snapshot().persistence, "unavailable");
  assert.equal(history.snapshot().records[0].id, "new");
});

test("a failed older write cannot consume a newer clear operation", async () => {
  const storage = area();
  storage.data.aiUsageHistoryV1 = { schema: 1, records: [row("old")] };
  const { history } = await create(storage);
  let entered,
    release,
    calls = 0;
  const started = new Promise((resolve) => (entered = resolve)),
    set = storage.set;
  storage.set = async (value) => {
    calls++;
    if (calls === 1) {
      entered();
      await new Promise((resolve) => (release = resolve));
      throw Error("temporary failure");
    }
    return set(value);
  };
  history.write(row("pending"), history.ticket());
  await started;
  const clearing = history.clear();
  release();
  await clearing;
  assert.equal(calls, 2);
  assert.deepEqual(storage.data.aiUsageHistoryV1.records, []);
  assert.equal(history.snapshot().persistence, "ready");
});
