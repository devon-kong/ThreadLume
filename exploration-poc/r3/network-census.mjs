// R3 network census — reproducible payload for the 18:18 comparison in
// r3-network-audit.md. Run with the r3 harness (registers the PoC for the R1
// condition only; the native condition runs the identical payload without it):
//   exploration-poc/r3/run.sh /dev/null   # then paste, or adapt paths
// Constraints honored: request metadata ONLY (URL → operation name + count).
// No headers, no bodies, no credentials, no fetch wrapping.
//
// Method:
//   1. page.cdp("Network.enable")
//   2. goto("about:blank") then goto(SAMPLE_URL)  — cold load, buffer resets
//   3. wait 7000ms
//   4. evts = await page.events()                 — buffered CDP events
//   5. filter method === "Network.requestWillBeSent", keep URLs containing "/i/api/"
//   6. classify: graphql/<hash>/<OpName> → "graphql:<OpName>"; else "rest:<path>"
//
// Why not performance.getEntriesByType("resource"): X clears the resource-timing
// buffer on live pages (measured: total=0 after a full detail load), so the
// Performance API under-reports. The CDP Network domain observes at protocol
// level and is immune to page-side clearing.
export const SAMPLE_URL = "https://x.com/gefei55/status/2109304575786393643";

export function classify(url) {
  const m = url.match(/graphql\/([a-zA-Z0-9]+)\/([A-Za-z]+)/);
  if (m) return "graphql:" + m[2];
  return "rest:" + url.replace(/^https?:\/\/[^/]+/, "").split("?")[0].slice(0, 60);
}

export async function census(page) {
  const evts = await page.events();
  const reqs = (Array.isArray(evts) ? evts : []).filter(e => e.method === "Network.requestWillBeSent");
  const api = reqs.filter(e => (e.params?.request?.url || "").includes("/i/api/"));
  const byOp = {};
  for (const e of api) {
    const op = classify(e.params.request.url);
    byOp[op] = (byOp[op] || 0) + 1;
  }
  return { apiTotal: api.length, byOp };
}

// Recorded results (2026-10-12, logged-in ego-browser session, cold load ×2):
export const RECORDED = {
  native: {
    apiTotal: 18,
    byOp: {
      "rest:/i/api/1.1/graphql/viewer_context.json": 4,
      "graphql:DataSaverMode": 1,
      "rest:/i/api/1.1/hashflags.json": 1,
      "rest:/i/api/1.1/flow/timeline.json": 2,
      "rest:/i/api/graphql/1KZj_GRTxmPaSrk8jIb1Yw/CreatorStudioTabBarIte": 1,
      "rest:/i/api/graphql/3BlMtudy4N-d78ch7zTLZQ/TweetDetail": 1,
      "rest:/i/api/graphql/xZfFqfOmKQu_OXekGI59mg/TweetResultByRestId": 1,
      "rest:/i/api/graphql/q4Npr1-FYRWyXsRzPckwEA/ViewerBadgeCounts": 1,
      "rest:/i/api/fleets/v1/fleetline": 2,
      "rest:/i/api/fleets/v1/avatar_content": 2,
      "graphql:getAltTextPromptPreference": 1,
      "rest:/i/api/graphql/bY118dk8ns_5JzfzIMeiBw/ExploreSidebar": 1,
    },
  },
  r1: {
    apiTotal: 18,
    note: "operation distribution identical to native (18:18, per-op match)",
    paneBuilt: true,
  },
};
