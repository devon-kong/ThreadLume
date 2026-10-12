// R3-R network census — fixed classifier + sanitized per-request evidence.
// Run with the r3 harness (registers the PoC for the R1 condition only; the
// native condition runs the identical payload without it) — see
// exploration-poc/r3-r/harness/census-run.mjs for the exact payload.
//
// Fixes over the R3 tool (P0-A1):
//  1. GraphQL operation names are parsed from the URL PATHNAME with a full
//     queryId charset [A-Za-z0-9_-]. The old regex ([a-zA-Z0-9]+) silently
//     mislabeled every op whose queryId contains "-" or "_" as REST — the R3
//     18:18 RECORDED blob itself shows TweetDetail / TweetResultByRestId /
//     CreatorStudioTabBarItem / ViewerBadgeCounts / ExploreSidebar mislabeled.
//  2. Full per-request records are kept (category, operation/redacted route,
//     method, relative ms) so any total can be recomputed independently —
//     nothing is hard-coded.
//  3. REST routes are redacted per segment (long numeric ids → :id, long hex
//     → :hash); query strings are never recorded; headers/bodies/cookies are
//     never read. The full URL exists only inside the classify() call frame.
//
// Method (unchanged): CDP Network.requestWillBeSent metadata only.
// page.events() returns AND clears the buffer; Performance API is unusable on
// X (X clears the resource-timing buffer — measured in R3).
export const SAMPLE_URL = "https://x.com/gefei55/status/2109304575786393643";
export const SAMPLE_AUTHOR_URL = "https://x.com/gefei55";

// Classify one request URL into { cat, op }. Never returns full URLs.
export function classify(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return { cat: "other", op: "(unparseable)" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    // blob:/data:/about:/chrome-extension: — record the scheme only
    return { cat: "other", op: u.protocol.replace(":", "") };
  }
  const p = u.pathname;
  if (/^\/i\/api\/graphql\/[A-Za-z0-9_-]+\/[A-Za-z0-9_]+/.test(p)) {
    const segs = p.split("/").filter(Boolean); // i, api, graphql, <queryId>, <Op>
    return { cat: "graphql", op: segs[4] };
  }
  if (p.startsWith("/i/api/graphql")) return { cat: "graphql", op: "(unparsed-shape)" };
  if (p.startsWith("/i/api/")) return { cat: "rest", op: redactRoute(p) };
  const host = u.hostname;
  if (/(^|\.)twimg\.com$/.test(host)) return { cat: "media", op: mediaOp(p) };
  if (/(^|\.)(x|twitter)\.com$/.test(host)) return { cat: "x-page", op: p.slice(0, 60) };
  return { cat: "third-party", op: host };
}

function redactRoute(p) {
  return p.split("/")
    .map((s) => (/^\d{5,}$/.test(s) ? ":id" : /^[0-9a-f-]{16,}$/i.test(s) ? ":hash" : s))
    .join("/")
    .slice(0, 80);
}

function mediaOp(p) {
  const segs = p.split("/").filter(Boolean);
  const kind = /\/(ext_tw_video_thumb|amplify_video_thumb|elmo_twitter_analysis|video_thumb)\//.test(p)
    ? "video-thumb"
    : /^\/media\//.test(p) ? "media-img"
    : /^\/card_img\//.test(p) ? "card-img"
    : segs[0] || "static";
  return kind;
}

// Turn raw CDP request events into sanitized minimal records.
export function recordsFromEvents(evts) {
  const reqs = (Array.isArray(evts) ? evts : []).filter((e) => e.method === "Network.requestWillBeSent");
  const ts = reqs.map((e) => e.params?.timestamp ?? 0);
  const t0 = ts.length ? Math.min(...ts) : 0;
  return reqs.map((e) => {
    const url = e.params?.request?.url || "";
    const { cat, op } = classify(url);
    return {
      cat, // graphql | rest | media | x-page | third-party | other
      op, // operation name (graphql) or redacted route (rest) / kind (media) / host (third-party)
      method: e.params?.request?.method || "?",
      rel: Math.round(((e.params?.timestamp ?? t0) - t0) * 1000), // relative ms within the window
    };
  });
}

// Aggregate sanitized records: per-op counts + totals recomputable from `requests`.
export function summarize(records) {
  const byOp = {};
  const categories = {};
  let graphqlTotal = 0;
  let restTotal = 0;
  for (const r of records) {
    const key = `${r.cat}:${r.op}`;
    byOp[key] = (byOp[key] || 0) + 1;
    categories[r.cat] = (categories[r.cat] || 0) + 1;
    if (r.cat === "graphql") graphqlTotal++;
    if (r.cat === "rest") restTotal++;
  }
  return {
    apiTotal: graphqlTotal + restTotal, // /i/api/ requests (graphql + REST)
    graphqlTotal,
    restTotal,
    categories,
    byOp: Object.fromEntries(Object.entries(byOp).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
    requests: records,
  };
}

export async function census(page) {
  const evts = await page.events();
  return summarize(recordsFromEvents(evts));
}
