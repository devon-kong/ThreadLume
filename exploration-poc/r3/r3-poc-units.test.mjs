// R3 offline unit tests for the mv3-poc content script's pure helpers.
// The real function source is lifted from content.js (single source of truth):
// the IIFE is executed against a minimal window/document stub with
// __PEEK_POC_TEST__ set, then the exposed helpers are exercised.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "..", "mv3-poc", "content.js"), "utf8");

function loadPoc() {
  const sandbox = {
    window: {},
    document: {
      documentElement: { getAttribute: () => null, setAttribute: () => {}, removeAttribute: () => {} },
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      head: { appendChild: () => {} },
      body: null,
    },
    location: { pathname: "/home" },
    history: {},
    setInterval: () => 0,
    setTimeout: (fn) => 0,
    queueMicrotask: () => {},
    MutationObserver: class { observe() {} disconnect() {} },
  };
  sandbox.window = sandbox; // window aliases global for the IIFE's guards
  sandbox.addEventListener = () => {};
  sandbox.navigation = undefined;
  sandbox.__PEEK_POC_TEST__ = true; // arm the test hook inside the IIFE
  const fn = new Function("window", "document", "location", "history", "setInterval", "setTimeout", "queueMicrotask", "MutationObserver", "navigator", source);
  fn(sandbox.window, sandbox.document, sandbox.location, sandbox.history, sandbox.setInterval, sandbox.setTimeout, sandbox.queueMicrotask, sandbox.MutationObserver, { clipboard: {} });
  return sandbox.window.__peekPocTest;
}

const poc = loadPoc();

test("parseCount: K/M suffixes, thousands separators, zero via aria, garbage → null", () => {
  assert.equal(poc.parseCount("1.2K"), 1200);
  assert.equal(poc.parseCount("3M"), 3_000_000);
  assert.equal(poc.parseCount("1,234"), 1234);
  assert.equal(poc.parseCount("0"), 0);
  assert.equal(poc.parseCount("2万"), null); // CJK units are not fabricated
  assert.equal(poc.parseCount(""), null);
  assert.equal(poc.parseCount(undefined), null);
});

test("fallbackText: drops UI lines, count-only lines, and the leading author block", () => {
  const art = {
    innerText: [
      "雨哥向前冲",
      "@xiangxiang103",
      "免费领 Cursor Pro：MLH Global Hack Week 保姆级图文教程",
      "3",
      "3",
      "11",
      "3,578",
      "实测日期：2026-10-11｜活动：MLH Global Hack Week",
      "显示翻译",
    ].join("\n"),
  };
  const text = poc.fallbackText(art);
  assert.ok(text.startsWith("免费领 Cursor Pro"), "body starts at the title, got: " + text.slice(0, 30));
  assert.ok(!/\n3\n/.test(text), "count-only lines filtered");
  assert.ok(!/显示翻译/.test(text), "UI lines filtered");
  assert.ok(text.includes("实测日期"), "body content preserved");
});

test("fallbackText: keeps author handles mentioned inside the body", () => {
  const art = { innerText: "作者\n@someone\n这条 @xiangxiang103 说得对\n正文继续" };
  const text = poc.fallbackText(art);
  assert.ok(text.includes("@xiangxiang103"), "in-body mentions preserved");
});

test("count contract: zero-count aria fallback shape (documented via parseCount)", () => {
  // The real countOf() derives zero from aria-label "0 喜欢次数。喜欢"; the pure
  // part is parseCount on the leading numeric token.
  assert.equal(poc.parseCount("0 喜欢次数。喜欢".match(/^([\d.,]+\s*[KMkM]?)/)[1].trim()), 0);
  assert.equal(poc.parseCount("1,282".match(/^([\d.,]+\s*[KMkM]?)/)[1].trim()), 1282);
});
