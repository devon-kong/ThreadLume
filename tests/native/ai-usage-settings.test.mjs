import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { setUILanguage } from "../../native-extension/src/i18n.js";
const module = await import(
  "../../native-extension/src/ai/usage-settings.js"
).catch(() => ({}));
const row = (i) => ({
  id: "job-" + i,
  startedAt: Date.now() - i * 1000,
  status: "success",
  operation: "generate",
  mode: "article",
  kind: "article",
  providerId: "p",
  providerName: "Example",
  model: "m",
  configVersion: "v",
  contextTokens: 32768,
  outputLanguage: "en",
  sourceId: "a".repeat(32),
  sourceTokens: 100,
  elapsedMs: 1000 + i,
  queueMs: 0,
  segmented: false,
  reusedNotes: false,
  requests: [
    {
      index: 1,
      phase: "single",
      status: "success",
      elapsedMs: 1000,
      inputTokens: 100,
      outputTokens: 10,
      inputSource: "reported",
      outputSource: "reported",
      outputComplete: true,
    },
  ],
});
test("data view paginates actual records, filters status and shows model aggregates", async () => {
  assert.equal(typeof module.createUsageSettings, "function");
  setUILanguage("en");
  const w = new JSDOM("<body><main></main></body>").window;
  let prefs = { saveUsageHistory: false },
    page;
  const mount = () =>
    w.document.querySelector("main").replaceChildren(page.render());
  page = module.createUsageSettings({
    document: w.document,
    preferences: () => prefs,
    onSave: (next) => {
      prefs = next;
      mount();
    },
    onChange: mount,
    send: async () => ({
      schema: 1,
      persistence: "ready",
      records: Array.from({ length: 51 }, (_, i) => row(i)),
    }),
  });
  await page.load();
  assert.equal(w.document.querySelectorAll("[data-usage-row]").length, 50);
  w.document.getElementById("pk-usage-next").click();
  assert.equal(w.document.querySelectorAll("[data-usage-row]").length, 1);
  const status = w.document.getElementById("pk-usage-status");
  status.value = "error";
  status.dispatchEvent(new w.Event("change"));
  assert.equal(w.document.querySelectorAll("[data-usage-row]").length, 0);
  const again = w.document.getElementById("pk-usage-status");
  again.value = "";
  again.dispatchEvent(new w.Event("change"));
  w.document.getElementById("pk-usage-comparison").click();
  assert.match(
    w.document.querySelector(".pk-usage-table").textContent,
    /Median elapsed/,
  );
  assert.match(
    w.document.querySelector(".pk-usage-table").textContent,
    /100\.0%/,
  );
  const toggle = w.document.getElementById("pk-pref-saveUsageHistory");
  toggle.checked = true;
  toggle.dispatchEvent(new w.Event("change"));
  assert.equal(prefs.saveUsageHistory, true);
  w.close();
});
test("clear requires confirmation and loading acknowledgements cannot restore older history", async () => {
  assert.equal(typeof module.createUsageSettings, "function");
  setUILanguage("en");
  const w = new JSDOM("<body><main></main></body>").window;
  let calls = 0,
    page,
    release;
  const mount = () =>
    w.document.querySelector("main").replaceChildren(page.render());
  page = module.createUsageSettings({
    document: w.document,
    preferences: () => ({ saveUsageHistory: true }),
    onSave() {},
    onChange: mount,
    send: async (action) => {
      if (action === "clearUsageHistory") {
        calls++;
        return { schema: 1, persistence: "ready", records: [] };
      }
      if (release) return { schema: 1, persistence: "ready", records: [] };
      return new Promise((r) => (release = r));
    },
  });
  mount();
  const reading = page.load();
  w.confirm = () => false;
  w.document.getElementById("pk-usage-clear").click();
  assert.equal(calls, 0);
  w.confirm = () => true;
  await page.clear();
  release({ schema: 1, persistence: "ready", records: [row(1)] });
  await reading;
  assert.equal(calls, 1);
  assert.equal(w.document.querySelectorAll("[data-usage-row]").length, 0);
  w.close();
});
