// R3-R census classifier tests (P0-A1): the pathname-based classifier must
// label every GraphQL operation correctly — including queryIds containing
// "-" and "_", which the R3 tool mislabeled as REST.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, recordsFromEvents, summarize } from "../../r3/network-census.mjs";

test("A1 回归：queryId 含 -/_ 的 GraphQL 操作正确分类（R3 误判集）", () => {
  // the exact shapes recorded in R3's RECORDED blob, where these were
  // misclassified as rest:/i/api/graphql/...
  assert.equal(classify("https://x.com/i/api/graphql/3BlMtudy4N-d78ch7zTLZQ/TweetDetail").op, "TweetDetail");
  assert.equal(classify("https://x.com/i/api/graphql/3BlMtudy4N-d78ch7zTLZQ/TweetDetail").cat, "graphql");
  assert.equal(classify("https://x.com/i/api/graphql/xZfFqfOmKQu_OXekGI59mg/TweetResultByRestId").op, "TweetResultByRestId");
  assert.equal(classify("https://x.com/i/api/graphql/1KZj_GRTxmPaSrk8jIb1Yw/CreatorStudioTabBarItemQuery").op, "CreatorStudioTabBarItemQuery");
  assert.equal(classify("https://x.com/i/api/graphql/q4Npr1-FYRWyXsRzPckwEA/ViewerBadgeCounts").op, "ViewerBadgeCounts");
  assert.equal(classify("https://x.com/i/api/graphql/bY118dk8ns_5JzfzIMeiBw/ExploreSidebar").op, "ExploreSidebar");
  // pure alphanumerics still work (the old regex's only success case)
  assert.equal(classify("https://x.com/i/api/graphql/AbCdEf123456/DataSaverMode").op, "DataSaverMode");
});

test("A1 分类：REST 内部接口（含 /1.1/graphql/*.json 假的 graphql 路径）", () => {
  const c = classify("https://x.com/i/api/1.1/graphql/viewer_context.json?uid=123");
  assert.deepEqual(c, { cat: "rest", op: "/i/api/1.1/graphql/viewer_context.json" });
  assert.equal(classify("https://x.com/i/api/1.1/flow/timeline.json").cat, "rest");
  assert.equal(classify("https://x.com/i/api/fleets/v1/fleetline").cat, "rest");
  assert.equal(classify("https://x.com/i/api/1.1/hashflags.json").cat, "rest");
});

test("A1 脱敏：REST 路由中的数字 id 与长哈希被替换，查询串不记录", () => {
  const c = classify("https://x.com/i/api/1.1/friendships/create.json?user_id=1234567890");
  assert.equal(c.op, "/i/api/1.1/friendships/create.json");
  const withId = classify("https://x.com/i/api/9v2/status/123456789012345678");
  assert.equal(withId.op, "/i/api/9v2/status/:id");
  const withHex = classify("https://x.com/i/api/fb1/abc0123456789abcdef0123456789ab/metadata");
  assert.match(withId.op, /:id/);
  assert.equal(withHex.op.includes("abc0123456789abcdef"), false, "long hex segment redacted");
  const qs = classify("https://x.com/i/api/1.1/hashflags.json?q=SECRET&token=xyz");
  assert.equal(qs.op.includes("SECRET"), false, "query strings never recorded");
});

test("A1 分类：媒体/静态、第三方、其他协议", () => {
  assert.deepEqual(classify("https://pbs.twimg.com/media/Fabc-xyz?format=jpg&name=small"), { cat: "media", op: "media-img" });
  assert.equal(classify("https://pbs.twimg.com/ext_tw_video_thumb/123/pu/img/a.jpg").op, "video-thumb");
  assert.equal(classify("https://pbs.twimg.com/card_img/123/img/x").op, "card-img");
  assert.equal(classify("https://abs.twimg.com/responsive-web/client-web/main.3ab.js").op, "responsive-web");
  assert.deepEqual(classify("https://fonts.example-analytics.com/collect"), { cat: "third-party", op: "fonts.example-analytics.com" });
  assert.equal(classify("blob:https://x.com/abc-123").cat, "other");
  assert.equal(classify("data:image/png;base64,xxx").cat, "other");
  assert.equal(classify("wss://x.com/i/api/1.1/live_pipeline/xyz").cat, "other");
  assert.equal(classify("not a url").cat, "other");
});

test("A1 记录最小化：每条记录只含 cat/op/method/rel，无 URL", () => {
  const evts = [
    { method: "Network.requestWillBeSent", params: { timestamp: 1000.25, request: { url: "https://x.com/i/api/graphql/3BlMtudy4N-d78ch7zTLZQ/TweetDetail", method: "GET", headers: { authorization: "Bearer SECRET" } } } },
    { method: "Network.requestWillBeSent", params: { timestamp: 1000.75, request: { url: "https://pbs.twimg.com/media/Fabc.jpg", method: "GET" } } },
    { method: "Network.responseReceived", params: {} },
  ];
  const records = recordsFromEvents(evts);
  assert.equal(records.length, 2);
  for (const r of records) {
    assert.deepEqual(Object.keys(r).sort(), ["cat", "method", "op", "rel"]);
    assert.equal(JSON.stringify(r).includes("SECRET"), false);
    assert.equal(JSON.stringify(r).includes("https://"), false);
  }
  const s = summarize(records);
  assert.equal(s.apiTotal, 1);
  assert.equal(s.graphqlTotal, 1);
  assert.equal(s.byOp["graphql:TweetDetail"], 1);
});
