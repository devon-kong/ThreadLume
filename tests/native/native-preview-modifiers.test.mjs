// L4-S3/P1 test — modified and non-primary clicks must never mount an
// instant preview. Observed live (L4-S3): shift+click on a timestamp mounted
// a ~1.2s preview that only the route timeout cleared; ctrl/shift/alt+click
// and middle-click belong to the browser (new tab / new window), not to this
// tab's reader.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeEnv, buildCell, buildAuthor, buildTweetText, makeStatusId,
} from "./native-env.mjs";

function mountListCell(env, statusId) {
  const author = buildAuthor({});
  const { cell, art } = buildCell({
    statusId,
    articleChildren: [author, buildTweetText("帖子的可见正文内容")],
  });
  env.document.body.appendChild(cell);
  const tsLink = [...art.querySelectorAll("a[href] time")]
    .map((t) => t.closest("a"))
    .find((a) => (a.getAttribute("href") || "").includes(`/status/${statusId}`) && !a.closest('div[role="link"]'));
  return { cell, tsLink };
}

const MODIFIERS = [
  ["ctrl", { ctrlKey: true }],
  ["meta", { metaKey: true }],
  ["shift", { shiftKey: true }],
  ["alt", { altKey: true }],
];

for (const [name, mod] of MODIFIERS) {
  test(`K1-${name}: ${name}+click on the timestamp mounts no preview`, () => {
    const env = makeEnv({ url: "/home", src: "lab" });
    env.boot();
    const { tsLink } = mountListCell(env, makeStatusId());
    env.poc.preview.captureClick({ target: tsLink, button: 0, ...mod });
    assert.equal(env.poc.preview.snapshot().active, false, `${name}+click must stay idle`);
    assert.equal(env.document.getElementById("peek-lad-preview"), null);
  });
}

test("K2: non-primary button (middle-click semantics) mounts no preview", () => {
  const env = makeEnv({ url: "/home", src: "lab" });
  env.boot();
  const { tsLink } = mountListCell(env, makeStatusId());
  env.poc.preview.captureClick({ target: tsLink, button: 1 });
  assert.equal(env.poc.preview.snapshot().active, false);
});

test("K3: a plain left-click still mounts the preview (guard is not overbroad)", () => {
  const env = makeEnv({ url: "/home", src: "lab" });
  env.boot();
  const { tsLink } = mountListCell(env, makeStatusId());
  env.poc.preview.captureClick({ target: tsLink, button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false });
  assert.equal(env.poc.preview.snapshot().active, true);
  assert.ok(env.document.getElementById("peek-lad-preview"));
});
