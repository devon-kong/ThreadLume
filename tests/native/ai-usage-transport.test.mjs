import { test } from "node:test";
import assert from "node:assert/strict";
import { createCustomTransport } from "../../native-extension/src/ai/custom-transport.js";
const config = {
  name: "Example",
  protocol: "chat-completions",
  baseURL: "https://api.example.test/v1",
  model: "example",
};
const input = {
  kind: "article",
  focusId: "123",
  url: "https://x.com/a/status/123",
  title: "Title",
  text: "Source text",
};
const choice = (content) => ({
  choices: [{ finish_reason: "stop", message: { role: "assistant", content } }],
});
const frame = (value) => "data: " + JSON.stringify(value) + "\n\n";
async function generate(envelope, stream = false) {
  const events = [],
    bodies = [];
  const transport = createCustomTransport({
    hasPermission: async () => true,
    fetchImpl: async (_, options) => {
      bodies.push(JSON.parse(options.body));
      return stream
        ? new Response(envelope, {
            headers: { "content-type": "text/event-stream" },
          })
        : Response.json(envelope);
    },
  });
  const result = await transport.generate(
    { ...config, stream },
    "secret",
    input,
    "article",
    undefined,
    (e) => events.push(e),
    "en",
  );
  return {
    result,
    events,
    bodies,
    requests: events.filter((e) => e.stage === "usage"),
  };
}
test("nonstream usage replaces local estimates without leaking response content or changing request parameters", async () => {
  const r = await generate({
    ...choice('{"text":"Done"}'),
    usage: {
      prompt_tokens: 123,
      completion_tokens: 45,
      prompt_tokens_details: { cached_tokens: 12 },
      completion_tokens_details: { reasoning_tokens: 30 },
    },
  });
  assert.equal(r.result.text, "Done");
  assert.ok(r.requests.length >= 2);
  assert.equal(r.requests[0].request.status, "running");
  assert.equal(r.requests[0].request.inputSource, "estimated");
  const last = r.requests.at(-1).request;
  assert.equal(last.inputTokens, 123);
  assert.equal(last.outputTokens, 45);
  assert.equal(last.reasoningTokens, 30);
  assert.equal(last.cachedInputTokens, 12);
  assert.equal(last.inputSource, "reported");
  assert.equal(last.status, "success");
  assert.equal(last.outputComplete, true);
  assert.equal(JSON.stringify(r.requests).includes("Done"), false);
  assert.equal(JSON.stringify(r.requests).includes("secret"), false);
  assert.deepEqual(Object.keys(r.bodies[0]).sort(), [
    "max_tokens",
    "messages",
    "model",
    "stream",
  ]);
});
test("usage-only stream terminal frames are retained and repeated counters replace rather than accumulate", async () => {
  const content = '{"text":"Done"}';
  const body =
    frame({
      choices: [{ index: 0, delta: { content }, finish_reason: null }],
      usage: { prompt_tokens: 100 },
    }) +
    frame({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) +
    frame({
      choices: [],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    }) +
    frame({
      choices: [],
      usage: { prompt_tokens: 100, completion_tokens: 20 },
    }) +
    "data: [DONE]\n\n";
  const r = await generate(body, true),
    last = r.requests.at(-1)?.request;
  assert.ok(last);
  assert.equal(last.inputTokens, 100);
  assert.equal(last.outputTokens, 20);
  assert.equal(last.outputSource, "reported");
});
test("invalid or missing usage is estimated from full generated JSON", async () => {
  const r = await generate({
      ...choice('{"text":"Done"}'),
      usage: { prompt_tokens: -5, completion_tokens: "20" },
    }),
    last = r.requests.at(-1)?.request;
  assert.ok(last);
  assert.equal(last.inputSource, "estimated");
  assert.equal(last.outputSource, "estimated");
  assert.ok(last.inputTokens > 0);
  assert.ok(last.outputTokens > 0);
  assert.equal(last.reasoningTokens, null);
});
test("schema failure still emits known numeric usage and never reports successful output", async () => {
  const events = [],
    transport = createCustomTransport({
      hasPermission: async () => true,
      fetchImpl: async () =>
        Response.json({
          ...choice("invalid JSON"),
          usage: { prompt_tokens: 101, completion_tokens: 11 },
        }),
    });
  await assert.rejects(
    transport.generate(
      config,
      "secret",
      input,
      "article",
      undefined,
      (e) => events.push(e),
      "en",
    ),
  );
  const last = events.filter((e) => e.stage === "usage").at(-1)?.request;
  assert.ok(last);
  assert.equal(last.inputTokens, 101);
  assert.equal(last.outputTokens, 11);
  assert.equal(last.status, "error");
});

test("actual segmented runner labels all calls and note reuse sends only a new integration request", async () => {
  const inputLong = {
      ...input,
      text: "A fact with a condition, not a guarantee. ".repeat(1800),
    },
    events = [];
  const transport = createCustomTransport({
    hasPermission: async () => true,
    fetchImpl: async (_, options) => {
      const body = JSON.parse(options.body),
        source = JSON.parse(body.messages[1].content);
      return Response.json({
        ...choice(
          JSON.stringify(
            source.core
              ? {
                  points: [
                    { text: "Conditions matter", refs: [source.core[0][0]] },
                  ],
                }
              : { text: "Overview" },
          ),
        ),
        usage: { prompt_tokens: 100, completion_tokens: 10 },
      });
    },
  });
  const { prepareChatBuilder, normalizeEndpoint } = await import(
    "../../native-extension/src/ai/custom-provider.js"
  );
  const small = { ...config, contextTokens: 8192 },
    executor = transport.bind(
      { ...normalizeEndpoint(small.baseURL), contextTokens: 8192 },
      prepareChatBuilder(small),
    );
  await executor.generate(
    "key",
    inputLong,
    "article",
    undefined,
    (event) => events.push(event),
    "en",
  );
  const complete = events.filter(
    (event) => event.stage === "usage" && event.request.status === "success",
  );
  assert.ok(complete.length > 1);
  assert.deepEqual(
    complete.map((e) => e.request.index),
    Array.from({ length: complete.length }, (_, i) => i + 1),
  );
  assert.equal(complete.at(-1).request.phase, "integrate");
  assert.ok(complete.slice(0, -1).every((e) => e.request.phase === "segment"));
  const reused = [];
  await executor.generate(
    "key",
    inputLong,
    "article",
    undefined,
    (event) => reused.push(event),
    "en",
  );
  assert.equal(reused.find((e) => e.stage === "plan").requests, 1);
  assert.equal(
    reused.filter((e) => e.stage === "usage" && e.request.status === "success")
      .length,
    1,
  );
});
