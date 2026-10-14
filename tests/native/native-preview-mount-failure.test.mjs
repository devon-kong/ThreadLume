// L4-S3 special check — mount-time exception safety.
//
// mountPreview() arms its state (P) BEFORE the DOM mount sequence, so an
// exception during appendChild / style insertion must not leave:
//   - an orphan overlay or a half-mounted node behind,
//   - an armed state that a later mount would "supersede" silently,
//   - an un-cleared timeout (the route-timeout timer registers only after a
//     successful mount — assert it never exists after a failed one),
// and the next capture must still work (no duplicate-id residue).
//
// Exercised through the REAL built lab artifact (diag build: the capture/mount
// stamps are present) with document.body.appendChild stubbed to throw once.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeEnv, buildCell, buildAuthor, buildTweetText, buildPhoto, makeStatusId,
} from "./native-env.mjs";

function mountListCell(env, statusId) {
  const author = buildAuthor({});
  const avatar = env.document.createElement("img");
  avatar.src = "https://pbs.twimg.com/profile_images/somebody/abc.jpg";
  author.prepend(avatar);
  const { cell, art } = buildCell({
    statusId,
    articleChildren: [author, buildTweetText("帖子的可见正文内容"), buildPhoto("https://pbs.twimg.com/media/abc.jpg")],
  });
  env.document.body.appendChild(cell);
  const tsLink = [...art.querySelectorAll("a[href] time")]
    .map((t) => t.closest("a"))
    .find((a) => (a.getAttribute("href") || "").includes(`/status/${statusId}`) && !a.closest('div[role="link"]'));
  return { cell, art, tsLink };
}

test("M1: appendChild failure during mount leaves no state, no DOM, no timer", async () => {
  const env = makeEnv({ url: "/home", src: "lab" });
  env.boot();
  const id = makeStatusId();
  const { tsLink } = mountListCell(env, id);
  // baseline: the route observer's safety-net poll timer is already armed by
  // boot; the assertion is that the failed mount adds nothing of its own
  const timersBefore = env.timers.pendingCount;

  const body = env.document.body;
  const realAppend = body.appendChild.bind(body);
  let throwNext = true;
  body.appendChild = (node) => {
    if (throwNext) { throwNext = false; throw new Error("simulated mount failure"); }
    return realAppend(node);
  };

  assert.throws(
    () => env.poc.preview.captureClick({ target: tsLink }),
    /simulated mount failure/,
  );

  // nothing survived the failure
  assert.equal(env.document.getElementById("peek-lad-preview"), null, "no orphan overlay");
  assert.equal(env.document.getElementById("peek-lad-preview-style"), null, "no orphan style");
  const snap = env.poc.preview.snapshot();
  assert.equal(snap.active, false, "preview state is idle, not armed-and-stuck");
  assert.equal(env.timers.pendingCount, timersBefore, "no route-timeout timer added by the failed mount");

  // a subsequent capture still works — no duplicate-id residue, fresh state
  const { tsLink: link2 } = mountListCell(env, makeStatusId());
  env.poc.preview.captureClick({ target: link2 });
  const snap2 = env.poc.preview.snapshot();
  assert.equal(snap2.active, true, "next capture mounts normally");
  assert.equal(env.document.querySelectorAll("#peek-lad-preview").length, 1, "exactly one overlay");
});

test("M2: the integrated click path swallows the mount failure and keeps X's click alive", async () => {
  const env = makeEnv({ url: "/home", src: "lab" });
  env.boot();
  const id = makeStatusId();
  const { cell, tsLink } = mountListCell(env, id);

  const body = env.document.body;
  const realAppend = body.appendChild.bind(body);
  body.appendChild = () => { throw new Error("always fails"); };

  // a REAL dispatched click goes through the route observer's capture handler,
  // which guards preview capture with try/catch — the failure must not escape
  // to other listeners, and the diag capture stamp must still have been written
  assert.doesNotThrow(() => {
    tsLink.dispatchEvent(new env.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  assert.ok(env.document.documentElement.getAttribute("data-peek-capture-at"),
    "diag capture stamp written before the guarded preview call");
  assert.equal(env.document.getElementById("peek-lad-preview"), null);
  assert.equal(env.timers.pendingCount > 0, true, "click cascade timers still armed (X's click observed)");

  // cleanup: restore and clear the cascade timers via the controllable wheel
  body.appendChild = realAppend;
  await env.timers.advance(1000);
});

test("M3: successful mounts stamp data-peek-mount-at (diag build only)", () => {
  const env = makeEnv({ url: "/home", src: "lab" });
  env.boot();
  const { tsLink } = mountListCell(env, makeStatusId());
  env.poc.preview.captureClick({ target: tsLink });
  assert.ok(env.document.documentElement.getAttribute("data-peek-mount-at"),
    "diag mount stamp present after a successful mount");
  assert.equal(env.poc.preview.snapshot().active, true);
});

test("M4: the default (non-diag) build stamps no probes", () => {
  const env = makeEnv({ url: "/home", src: "default" });
  env.boot();
  const { tsLink } = mountListCell(env, makeStatusId());
  tsLink.dispatchEvent(new env.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  assert.equal(env.document.documentElement.getAttribute("data-peek-capture-at"), null,
    "no capture probe in the default build");
});
