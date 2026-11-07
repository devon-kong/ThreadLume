import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createCard } from "../../native-extension/src/ai/card.js";
import { DEFAULTS } from "../../native-extension/src/ai/preferences.js";
const record = (mode = "article") => ({
  id: mode,
  startedAt: 1800000000000,
  status: "running",
  operation: "generate",
  mode,
  kind: "article",
  providerId: "p",
  providerName: "Example",
  model: "example-model",
  configVersion: "v",
  contextTokens: 32768,
  stream: true,
  outputLanguage: "en",
  sourceTokens: 100,
  sourceId: "a".repeat(32),
  elapsedMs: 12000,
  queueMs: 100,
  segmented: false,
  reusedNotes: false,
  requests: [
    {
      index: 1,
      phase: "single",
      status: "running",
      elapsedMs: 10000,
      inputTokens: 8420,
      inputSource: "estimated",
      outputTokens: 999,
      outputSource: "estimated",
      outputComplete: false,
    },
  ],
});
test("reader shows elapsed and input while running, reveals output on completion, and preserves each view statistics", () => {
  const w = new JSDOM('<body><button id="comment">Comment</button></body>', {
    url: "https://x.com",
  }).window;
  const card = createCard({
    document: w.document,
    input: { kind: "article" },
    preferences: DEFAULTS,
  });
  w.document.body.append(card.root);
  try {
    card.set("article", "queued");
    assert.equal(typeof card.statistics, "function");
    card.statistics("article", record());
    const line = w.document.querySelector(".pk-ai-usage-summary");
    assert.match(line.textContent, /8,420/);
    assert.doesNotMatch(line.textContent, /999|Output/);
    w.document.getElementById("comment").focus();
    const body = w.document.querySelector(".pk-ai-body");
    body.scrollTop = 70;
    const done = {
      ...record(),
      status: "success",
      elapsedMs: 18600,
      requests: [
        {
          ...record().requests[0],
          status: "success",
          outputComplete: true,
          outputTokens: 926,
          outputSource: "reported",
        },
      ],
    };
    card.set("article", "success", { text: "Summary", statistics: done });
    assert.match(line.textContent, /18\.6/);
    assert.match(line.textContent, /926/);
    assert.equal(body.scrollTop, 70);
    assert.equal(w.document.activeElement.id, "comment");
    w.document.getElementById("pk-ai-tab-mindmap").click();
    card.set("mindmap", "queued");
    card.statistics("mindmap", {
      ...record("mindmap"),
      elapsedMs: 2000,
      requests: [],
    });
    assert.doesNotMatch(line.textContent, /8,420/);
    w.document.getElementById("pk-ai-tab-article").click();
    assert.match(line.textContent, /926/);
    card.updatePreferences({ ...DEFAULTS, uiLanguage: "zh-CN" });
    assert.match(line.textContent, /输入/);
  } finally {
    card.destroy();
    w.close();
  }
});
test("cached output is labeled in the reader status while the statistics line stays unavailable", () => {
  const w = new JSDOM("<body></body>", { url: "https://x.com" }).window;
  const card = createCard({
    document: w.document,
    input: { kind: "article" },
    preferences: DEFAULTS,
  });
  w.document.body.append(card.root);
  try {
    card.set("article", "success", { text: "Old", cached: true });
    assert.match(
      w.document.querySelector(".pk-ai-toolbar [role=status]").textContent,
      /Cached/,
    );
    const line = w.document.querySelector(".pk-ai-usage-summary");
    assert.doesNotMatch(line.textContent, /Cached/);
    assert.match(line.textContent, /unavailable/i);
  } finally {
    card.destroy();
    w.close();
  }
});

test("live elapsed time never moves backward on a delayed task snapshot and resets for a new task", () => {
  const w = new JSDOM("<body></body>", { url: "https://x.com" }).window;
  let clock = 100,
    tick;
  Object.defineProperty(w.performance, "now", { value: () => clock });
  w.setInterval = (callback) => {
    tick = callback;
    return 1;
  };
  w.clearInterval = () => {};
  const card = createCard({
    document: w.document,
    input: { kind: "article" },
    preferences: DEFAULTS,
  });
  w.document.body.append(card.root);
  try {
    card.set("article", "queued");
    card.statistics("article", { ...record(), elapsedMs: 1000 });
    clock = 1100;
    tick();
    assert.match(
      w.document.querySelector(".pk-ai-usage-summary").textContent,
      /2\.0/,
    );
    card.statistics("article", { ...record(), elapsedMs: 1800 });
    assert.match(
      w.document.querySelector(".pk-ai-usage-summary").textContent,
      /2\.0/,
    );
    card.set("article", "queued");
    card.statistics("article", { ...record(), id: "new-task", elapsedMs: 0 });
    assert.match(
      w.document.querySelector(".pk-ai-usage-summary").textContent,
      /0\.0/,
    );
  } finally {
    card.destroy();
    w.close();
  }
});
