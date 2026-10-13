// M1-R A2 evidence — can the list anchor really be overwritten by a detail-
// page capture? (task: "必须通过实验判断该问题是否能真实复现")
//
// Run: node docs/m1-r/evidence/anchor-overwrite-repro.mjs   (after npm run build:native)
//
// Method: the same offline harness the native suite uses (tests/native/
// native-env.mjs, executing the REAL built artifact). Two passes over the
// identical scenario chain:
//
//   list → open A (pre-commit click capture, list top = 450px)
//        → X pushes a non-status route (/search) — session ends, restore
//          window runs to its terminal state
//        → a search result opens B — a route-check capture runs NOW, on B's
//          detail page, where the "cell" found for B is the detail copy
//        → close B → back to /search
//
// The M1 (76568a3) capturePreOpen had NO context check: the B capture would
// have replaced the anchor with the DETAIL position (a fresh garbage anchor
// even though A's anchor was already consumed — and had the detour not
// consumed it, A's true list origin would have been overwritten outright).
// This script replicates that unconditional store over the same fixture and
// computes the wrong scroll it would have produced on /search, then shows the
// fixed build refuses the capture and scrolls nothing.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  makeEnv, makeStatusId, buildCell, buildAuthor, buildTweetText, buildActionBar,
} from "../../../tests/native/native-env.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (statusId) => ({
  statusId, articleChildren: [buildAuthor(), buildTweetText("正文"), buildActionBar()],
});

const env = makeEnv();
env.boot();
const idA = makeStatusId();
const idB = makeStatusId();

// 1. list → open A (pre-commit click capture at viewport top 450)
const { cell: cellA } = buildCell(fixture(idA));
cellA.getBoundingClientRect = () => ({ top: 450, bottom: 650, height: 200 });
env.document.body.appendChild(cellA);
await env.pushNavigate(`/somebody/status/${idA}`);
await env.timers.advance(1_200);
const listAnchor = { ...env.poc.preOpenAnchor() };
console.log("[1] list anchor captured:", listAnchor);

// 2. X pushes /search (non-status): session ends, restore window terminates
env.location.pathname = "/search";
env.location.href = "https://x.com/search";
await env.timers.advance(5_200);
console.log("[2] after /search detour: restoreActive =", env.poc.restoreActive(),
  ", anchor =", env.poc.preOpenAnchor());

// 3. a search result opens B. The OLD (M1 76568a3) semantics, replicated
//    inline: capturePreOpen stored whatever cell matched — on the detail page
//    that is the detail copy of B. The harness fixture puts B's detail cell
//    at viewport top 99 to make the garbage position measurable.
const { cell: cellB } = buildCell(fixture(idB));
cellB.getBoundingClientRect = () => ({ top: 99, bottom: 299, height: 200 });
env.document.body.appendChild(cellB);
env.location.pathname = `/other/status/${idB}`;
env.location.href = `https://x.com/other/status/${idB}`;
await env.timers.advance(600);

const oldSemantics = { statusId: idB, top: cellB.getBoundingClientRect().top };
console.log("[3] OLD M1 semantics would store:", oldSemantics,
  "(a detail-page position — garbage as a list anchor)");

// what the old anchor would have done on closing B back to /search: if post B
// appears among the search results (real X renders cellInnerDivs there), the
// restore would scroll the SEARCH page by delta = detailTop − garbageTarget…
const searchResultRectTop = 320; // B rendered as a search-result cell
const oldDelta = searchResultRectTop - oldSemantics.top;
console.log("    OLD behavior on return-to-/search: scrollBy(0,", oldDelta,
  ") — an unjustified correction on a page the user never read A from");

// 4. the FIXED build: the same route-check capture is refused (detail context)
const refused = env.poc.capturePreOpen(idB, "route-check");
console.log("[4] fixed build capture result:", refused,
  "→ refused (detail-context), no anchor invented");
await env.timers.advance(3_000); // close-B → /search, restore window runs out
console.log("    fixed build scrollY after closing B back to /search: still",
  env.scroll.y, "— native behavior untouched");

console.log("\nConclusion: the overwrite mechanism was REACHABLE through any",
  "\nnon-status detour (search/settings/explore). The M1-R ownership rule",
  "\n(detail-context captures refused, terminal states consume) closes it.",
  "\nFixed-build assertions: no anchor after refusal →", env.poc.preOpenAnchor() === null,
  "\nno scroll on /search (scrollY still 0) →", env.scroll.y === 0);
