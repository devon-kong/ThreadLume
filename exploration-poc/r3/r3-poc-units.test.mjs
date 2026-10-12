// R3 offline unit tests for the mv3-poc content script's pure helpers.
// R3-R adaptation: fallbackText was intentionally changed (P0-C1) to identify
// engagement counts from DOM structure instead of deleting every bare-number
// line, so its two scenarios now run against structural jsdom fixtures via the
// shared harness (../r3-r/tests/poc-env.mjs). parseCount and the aria-zero
// contract are unchanged. The expanded suite lives in ../r3-r/tests/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeEnv, buildCell, buildAuthor, buildActionBar } from "../r3-r/tests/poc-env.mjs";

function loadPoc() {
  const env = makeEnv();
  const poc = env.boot();
  return poc;
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

test("fallbackText (R3-R structural): drops action-bar counts and UI lines, keeps body incl. numbers", () => {
  const env = makeEnv();
  const body = (t) => { const d = env.document.createElement("div"); d.textContent = t; return d; };
  const { art } = buildCell({
    statusId: "2109304575786393643",
    articleChildren: [
      buildAuthor(),
      body("免费领 Cursor Pro：MLH Global Hack Week 保姆级图文教程"),
      body("2026"),
      body("实测日期：2026-10-11｜活动：MLH Global Hack Week"),
      buildActionBar({ reply: "3", retweet: "3", like: "11", bookmark: "3,578" }),
      body("显示翻译"),
    ],
  });
  const text = poc.fallbackText(art);
  assert.ok(text.startsWith("免费领 Cursor Pro"), "body starts at the title, got: " + text.slice(0, 30));
  assert.ok(/\n2026\n/.test("\n" + text + "\n"), "bare number body lines are content (R3-R fix)");
  assert.ok(text.includes("实测日期"), "body content preserved");
  assert.ok(!text.includes("3,578"), "action-bar counts excluded structurally");
  assert.ok(!text.includes("显示翻译"), "UI lines filtered");
});

test("fallbackText: keeps author handles mentioned inside the body", () => {
  const env = makeEnv();
  const body = (t) => { const d = env.document.createElement("div"); d.textContent = t; return d; };
  const { art } = buildCell({
    statusId: "2109304575786393644",
    articleChildren: [buildAuthor(), body("作者"), body("@someone"), body("这条 @xiangxiang103 说得对"), body("正文继续")],
  });
  const text = poc.fallbackText(art);
  assert.ok(text.includes("@xiangxiang103"), "in-body mentions preserved");
});

test("count contract: zero-count aria fallback shape (documented via parseCount)", () => {
  // The real countOf() derives zero from aria-label "0 喜欢次数。喜欢"; the pure
  // part is parseCount on the leading numeric token.
  assert.equal(poc.parseCount("0 喜欢次数。喜欢".match(/^([\d.,]+\s*[KMkM]?)/)[1].trim()), 0);
  assert.equal(poc.parseCount("1,282".match(/^([\d.,]+\s*[KMkM]?)/)[1].trim()), 1282);
});
