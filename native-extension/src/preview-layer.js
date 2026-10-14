// Peek M2-B2-A — instant reading preview (experimental lab build only).
//
// S1 design (docs/m2-b2-a/first-paint-analysis.md): M1-R's 19–20ms first paint
// was a RACE it won only 25% of the time — extraction ran after the route
// change was observed, so X's detail commit had often already unmounted the
// timeline cell. This layer removes the race: the capture-phase click listener
// (which runs BEFORE X's own handler touches anything) extracts the clicked
// cell's already-rendered DOM SYNCHRONOUSLY and mounts a transient,
// non-interactive reading preview. X's navigation then proceeds untouched;
// when the layout adapter pins the native focal article (ACTIVE + verified
// marker + split CSS), the preview is removed in the very same task — the
// native component takes over reading without an intermediate frame.
//
// State machine (one preview at a time, identified by { statusId, gen }):
//   IDLE → PREVIEW_READY            capture click: eligible cell extracted, overlay mounted
//   PREVIEW_READY → NATIVE_WAITING  route now points at the previewed id
//   NATIVE_WAITING → (handoff)      adapter ACTIVE: overlay removed same task, back to IDLE
//   ANY → CLEANUP → IDLE            route mismatch / route left / timeout /
//                                   adapter stop / superseding click / teardown
//
// Hard scope limits (S1-B):
//   - reads ONLY what the user can already see in the clicked cell (the same
//     data M1-R's fast path used): author, visible text, photo URLs, visible
//     quote summary, counts, a video POSTER — never a playable video element;
//   - no requests, no React internals, no media-node cloning, no writes;
//   - the overlay is pointer-events:none + aria-hidden: it can never block X's
//     own controls and is never read twice by assistive technology;
//   - it is removed on every exit path — no listener or timer survives it.

import { ESCAPED, statusIdFromPath } from "./constants.js";
import { extractFromArticle } from "./focal-extractor.js";
import { readTheme } from "./theme-adapter.js";
// M2-B2-B: preview geometry/palette come from the SAME source as the reader
// skin, so the handoff swaps content — never layout (pixel-continuous).
import { skinGeometry, skinPalette } from "./layout-adapter/reader-skin.js";

// The preview waits for X's SPA to commit the navigation it initiated. X
// commits in the click task itself (first-paint-analysis §Q4); if the URL is
// still the list after this long, no navigation is coming (blocked/aborted
// click) and the overlay must not linger. The NATIVE_WAITING phase needs no
// timer of its own: the adapter's bounded install budget (3s, fail-closed)
// and the route observer own every exit from there.
const PREVIEW_ROUTE_TIMEOUT_MS = 1200;

// Same region the adapter's fixed focal article will occupy, so the handoff
// swaps content — not layout. Below 980px the adapter's split never activates
// (LAYOUT_CSS media query), so no preview is offered there either.
const PREVIEW_MIN_VIEWPORT_PX = 980;
const PREVIEW_ID = "peek-lad-preview";
const PREVIEW_STYLE_ID = "peek-lad-preview-style";
const PREVIEW_Z_INDEX = 58; // strictly below the adapter's focal article (59)

let P = null; // { statusId, gen, phase: "ready" | "waiting", overlay, timer, mountedAt }
let genSeq = 0;

// ---------- capture (synchronous, click task) ----------

// Called from the route observer's capture-phase click listener on EVERY
// click. Everything up to the overlay mount is synchronous: the clicked cell
// is guaranteed to still be mounted because X's handler has not run yet.
export function captureClickForPreview(event) {
  // Clock-validation builds only (PEEK_DIAG_DELAY_MS=50): a deliberate
  // synchronous stall before extraction. The perf harness must include this
  // cost in t1a — a monitor that records t0 after the extension's own capture
  // handler would silently hide exactly this kind of in-handler work.
  /* eslint-disable no-undef */
  if (__PEEK_DIAG_STAMPS__ && __PEEK_DIAG_DELAY_MS__ > 0) {
    const busyUntil = performance.now() + __PEEK_DIAG_DELAY_MS__;
    while (performance.now() < busyUntil) { /* controlled stall, test builds only */ }
  }
  /* eslint-enable no-undef */
  const found = extractPreviewTarget(event);
  if (!found) {
    // a click that will not open a previewable detail must not leave a stale
    // overlay from an earlier click in the way
    if (P) clearPreview("click-elsewhere");
    return;
  }
  const { statusId, data, posterUrl } = found;
  // waiting implies the URL already points at this post, and
  // extractPreviewTarget refuses detail pages first — so this guard is
  // defensive only; kept because a same-id rebind would still be correct.
  if (P && P.statusId === statusId && P.phase === "waiting") return; // already handing off
  mountPreview(statusId, data, posterUrl);
}

// Eligibility + extraction. Returns null unless the click provably opens the
// cell's OWN post as a detail from a list context:
//   - current URL is a list (never preview on a detail page — the native
//     focal article is already the reader there, per the M1 boundary);
//   - the clicked link targets a /status/<id>;
//   - the containing cell's own timestamp link (NOT one nested in a quote
//     card) resolves to that same id — quote-card links and cross-post links
//     fail open: no preview, X navigates exactly as before.
function extractPreviewTarget(event) {
  if (statusIdFromPath()) return null; // already on a detail page
  // Modified or non-primary clicks belong to the browser (new tab / new
  // window) or to X's own handling — never to an instant preview of THIS
  // tab. Without this guard a ctrl/shift/alt+click would flash a ~1.2s
  // preview that only the route timeout clears (observed live, L4-S3).
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return null;
  if (event.button !== undefined && event.button !== 0) return null;
  if (window.innerWidth < PREVIEW_MIN_VIEWPORT_PX) return null;
  const a = event?.target?.closest?.('a[href*="/status/"]');
  if (!a) return null;
  const href = a.getAttribute("href") || "";
  const statusId = (href.match(/\/status\/(\d+)/) || [])[1];
  if (!statusId) return null;
  const cell = a.closest?.('[data-testid="cellInnerDiv"]');
  if (!cell) return null;
  // identity: the CELL's own post must be the link's target (the same
  // includes-caliber rule as focalCellByStatusId / the adapter's marker check)
  const ownLink = [...cell.querySelectorAll("a[href] time")]
    .filter((t) => !t.closest('div[role="link"]'))
    .find((t) => (t.closest("a")?.getAttribute("href") || "").includes(`/status/${statusId}`));
  if (!ownLink) return null;
  const art = cell.querySelector("article[data-testid='tweet']") || cell.querySelector("article");
  if (!art) return null;
  const data = extractFromArticle(art, statusId);
  if (!data || data.statusId !== statusId) return null;
  // video/GIF: the poster frame is information the user is already shown;
  // the video NODE itself is never copied, and a static poster is never
  // presented as playable (labeled as a preview, S1-B)
  const posterUrl = data.rich.video
    ? (art.querySelector("video")?.getAttribute("poster") || "")
    : "";
  return { statusId, data, posterUrl };
}

// ---------- mount / clear ----------

function mountPreview(statusId, data, posterUrl) {
  clearPreview("superseded");
  const gen = ++genSeq;
  const overlay = document.createElement("div");
  overlay.id = PREVIEW_ID;
  overlay.dataset.statusId = statusId; // invariant: preview shows the clicked post
  overlay.setAttribute("aria-hidden", "true");
  overlay.setAttribute("role", "presentation");
  overlay.innerHTML = previewHtml(data, posterUrl);
  // P is armed BEFORE the node enters the DOM (review P3 hardening): if
  // anything below throws, the overlay is still tracked by P and removable —
  // no orphan with a fixed id, no duplicate id on the next mount.
  P = { statusId, gen, phase: "ready", overlay, timer: 0, mountedAt: performance.now() };
  try {
    document.body?.appendChild(overlay);
    if (!document.getElementById(PREVIEW_STYLE_ID)) {
      const style = document.createElement("style");
      style.id = PREVIEW_STYLE_ID;
      style.textContent = previewCss();
      document.head?.appendChild(style);
    }
  } catch (err) {
    // mount failed mid-sequence (DOM insertion, style insert): drop the armed
    // state entirely — no orphan P, no un-cleared timer, no half-mounted
    // overlay — then let the caller's own guard see the failure.
    clearPreview("mount-failed");
    throw err;
  }
  // Test-build probe: when the overlay actually entered the DOM. Read against
  // data-peek-capture-at to decompose t1a (capture → extract → mount).
  /* eslint-disable no-undef */
  if (__PEEK_DIAG_STAMPS__) {
    try { document.documentElement.setAttribute("data-peek-mount-at", String(performance.now())); } catch { /* probe only */ }
  }
  /* eslint-enable no-undef */
  P.timer = setTimeout(() => {
    // only the "still on the list" state can time out; once the route has
    // confirmed, the adapter budget and route observer own every exit
    if (P && P.gen === gen && P.phase === "ready") clearPreview("route-timeout");
  }, PREVIEW_ROUTE_TIMEOUT_MS);
}

function previewHtml(data, posterUrl) {
  const handleAt = data.handle ? "@" + data.handle.replace(/^\//, "") : "";
  const photos = data.photos
    .map((u) => `<img class="ppl-photo" src="${ESCAPED(u)}" referrerpolicy="no-referrer" alt="">`)
    .join("");
  const text = data.textKnown
    ? `<div class="ppl-text">${ESCAPED(data.text)}</div>`
    : "";
  const video = data.rich.video
    ? `<div class="ppl-video">${posterUrl ? `<img class="ppl-poster" src="${ESCAPED(posterUrl)}" referrerpolicy="no-referrer" alt="">` : ""}<span class="ppl-video-note">视频/GIF · 静态预览，原生播放器接管后播放</span></div>`
    : "";
  const poll = data.rich.poll ? `<div class="ppl-rich">投票 · 原生组件接管后显示</div>` : "";
  const card = data.rich.card ? `<div class="ppl-rich">网站卡片 · 原生组件接管后显示</div>` : "";
  const quote = data.quote
    ? `<div class="ppl-quote"><div class="ppl-quote-author">${ESCAPED(data.quote.author ?? "未知作者")}</div><div>${ESCAPED(data.quote.text || "（引用正文未识别）")}</div></div>`
    : "";
  return `
    <div class="ppl-author">
      ${data.avatar ? `<img class="ppl-avatar" src="${ESCAPED(data.avatar)}" referrerpolicy="no-referrer" alt="">` : ""}
      <div><b>${ESCAPED(data.name)}</b><span>${ESCAPED(handleAt)}</span></div>
    </div>
    ${text}
    ${video}
    ${photos ? `<div class="ppl-photos">${photos}</div>` : ""}
    ${poll}${card}
    ${quote}
    <div class="ppl-counts">回复 ${data.reply.value ?? "·"} · 转推 ${data.retweet.value ?? "·"} · 喜欢 ${data.like.value ?? "·"}${data.timeText ? ` · ${ESCAPED(data.timeText)}` : ""}</div>`;
}

function previewCss() {
  // M2-B2-B: identical geometry and palette to the skinned focal card —
  // the overlay IS the card's first face, so the native takeover cannot shift
  // it by a pixel. pointer-events:none: the preview can never intercept.
  const theme = skinPalette(readTheme());
  const g = skinGeometry();
  return `
    #${PREVIEW_ID} {
      position: fixed;
      left: ${g.inset}px;
      top: ${g.topbarH + g.inset}px;
      bottom: ${g.inset}px;
      width: calc(52vw - ${g.inset + g.gap}px);
      box-sizing: border-box; overflow: hidden; z-index: ${PREVIEW_Z_INDEX};
      pointer-events: none; background: ${theme.card}; color: ${theme.fg};
      border: 1px solid ${theme.border};
      border-radius: ${g.radius}px;
      box-shadow: ${theme.shadow};
      padding: 16px;
      font-family: inherit;
    }
    #${PREVIEW_ID} .ppl-author { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
    #${PREVIEW_ID} .ppl-avatar { width: 40px; height: 40px; border-radius: 50%; }
    #${PREVIEW_ID} .ppl-author div { display: flex; flex-direction: column; line-height: 20px; }
    #${PREVIEW_ID} .ppl-author span { color: ${theme.dim}; font-size: 14px; }
    #${PREVIEW_ID} .ppl-text { font-size: 15px; line-height: 20px; white-space: pre-wrap; margin-bottom: 10px; }
    #${PREVIEW_ID} .ppl-photos { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; }
    #${PREVIEW_ID} .ppl-photo { width: 100%; border-radius: 12px; display: block; }
    #${PREVIEW_ID} .ppl-video { position: relative; margin-bottom: 10px; border-radius: 12px; overflow: hidden; background: rgba(0,0,0,0.04); }
    #${PREVIEW_ID} .ppl-poster { width: 100%; display: block; }
    #${PREVIEW_ID} .ppl-video-note { position: absolute; left: 8px; bottom: 8px; font-size: 12px; line-height: 16px;
      background: rgba(0,0,0,0.6); color: #fff; border-radius: 4px; padding: 2px 6px; }
    #${PREVIEW_ID} .ppl-rich { font-size: 13px; line-height: 18px; color: ${theme.dim};
      border: 1px solid ${theme.border}; border-radius: 12px; padding: 8px 10px; margin-bottom: 10px; }
    #${PREVIEW_ID} .ppl-quote { border: 1px solid ${theme.border}; border-radius: 12px; padding: 10px 12px; margin-bottom: 10px; font-size: 14px; line-height: 19px; }
    #${PREVIEW_ID} .ppl-quote-author { color: ${theme.fg}; font-weight: 700; margin-bottom: 2px; }
    #${PREVIEW_ID} .ppl-counts { font-size: 13px; line-height: 18px; color: ${theme.dim}; }`;
}

export function clearPreview(reason) {
  if (!P) return;
  if (P.timer) clearTimeout(P.timer);
  P.overlay?.remove();
  document.getElementById(PREVIEW_STYLE_ID)?.remove();
  P = null;
  return reason;
}

// ---------- lifecycle hooks (called by the route observer / controller) ----------

// Route observer, on every observed route change.
export function previewOnRouteChange(id) {
  if (!P) return;
  if (id === P.statusId) {
    if (P.phase === "ready") {
      P.phase = "waiting";
      if (P.timer) { clearTimeout(P.timer); P.timer = 0; }
    }
    return; // waiting: the adapter drives the handoff from here
  }
  // a different detail id, or the detail was left (id = null): the previewed
  // navigation did not happen. While still "ready" on a list page the URL has
  // simply not committed yet (route ticks keep firing) — the route timeout
  // owns that case; clearing here would kill every preview before it confirms.
  if (id || P.phase === "waiting") clearPreview(id ? "route-mismatch" : "route-left");
}

// Layout adapter controller: the session went ACTIVE, the focal marker was
// verified and the split CSS is mounted. Removing the overlay in THIS task
// means the first frame that shows the pinned native article is the first
// frame without the preview — no intermediate blank, no double focal post.
export function previewAdapterHandoff(focusUrlId) {
  if (!P) return;
  if (P.statusId !== focusUrlId) { clearPreview("handoff-mismatch"); return; }
  clearPreview("handoff");
}

// Layout adapter controller: the session failed, went dormant or was released
// — no handoff is coming for this navigation. The preview must leave before
// the user notices it, whatever phase it is in.
export function previewAdapterStopped(reason) {
  if (!P) return;
  clearPreview(`adapter-${reason}`);
}

// ---------- diagnostics ----------

export function previewSnapshot() {
  if (!P) return { active: false, phase: "idle", genSeq };
  return {
    active: true,
    phase: P.phase,
    statusId: P.statusId,
    gen: P.gen,
    overlayConnected: Boolean(P.overlay?.isConnected),
    timerArmed: P.timer !== 0,
    mountedAt: P.mountedAt,
  };
}
