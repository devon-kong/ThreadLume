// Peek Native — the reading view: left reading pane rendering and the in-place
// field refresh used by the two decoupled upgrades (detail hydration, show-more
// expansion). Remounting the pane is reserved for genuine route changes; field
// refreshes never remount (no flicker, scroll position preserved).

import { NS, PANE_ID, STYLE_ID, ESCAPED } from "./constants.js";
import { focalCellByStatusId } from "./focal-extractor.js";

let richScanUntil = 0; // bounded window for late media-hydration rescan

export function setRichScanWindow(fromNowMs) {
  richScanUntil = performance.now() + fromNowMs;
}
export const richScanActive = () => performance.now() <= richScanUntil;

function richNoteText(labels) {
  return `此帖含${labels.join("、")}——右侧栏顶部原生格完整承载媒体与互动，可滚动到该处直接操作。`;
}

export function fmtCount(c) {
  if (!c.known) return "未知";
  if (c.value === null) return "未知";
  return c.value.toLocaleString("en-US");
}

export function quoteHtml(q) {
  return `<div class="${NS}-quote-author">${ESCAPED(q.author ?? "未知作者")}</div>
        <div>${ESCAPED(q.text || "（引用正文未识别）")}</div>
        ${q.photos.map((u) => `<img class="${NS}-photo" src="${ESCAPED(u)}" referrerpolicy="no-referrer" alt="">`).join("")}`;
}

function richLabelsOf(rich) {
  return [
    rich.video && "视频/GIF",
    rich.poll && "投票",
    rich.card && "网站卡片",
    rich.article && "X Article"
  ].filter(Boolean);
}

// In-place field refresh for the two decoupled upgrades (detail hydration,
// show-more expansion): swap text/photos/counts/time/quote without
// remounting the pane — no flicker, scroll position preserved.
// Text monotonicity (R4 review P2-1): once the show-more upgrade has written
// the FULL body (`data-peek-full-text`), a later hydration refresh carrying
// the collapsed detail body must never regress the pane back to truncated
// text — it still refreshes counts/time/photos/quote.
export function updatePaneInPlace(pane, data) {
  const textEl = pane.querySelector(`.${NS}-text`);
  if (textEl && data.textKnown && textEl.dataset.peekFullText !== "1") {
    textEl.textContent = data.text;
    textEl.classList.remove(`${NS}-unknown`);
  }
  const photosEl = pane.querySelector(`.${NS}-photos`);
  if (photosEl) photosEl.innerHTML = data.photos.map((u) => `<img class="${NS}-photo" src="${ESCAPED(u)}" referrerpolicy="no-referrer" alt="">`).join("");
  const countsEl = pane.querySelector(`.${NS}-counts`);
  if (countsEl) countsEl.textContent = `回复 ${fmtCount(data.reply)} · 转推 ${fmtCount(data.retweet)} · 喜欢 ${fmtCount(data.like)} · 书签 ${fmtCount(data.bookmark)}${data.timeText ? ` · ${ESCAPED(data.timeText)}` : ""}`;
  const quoteEl = pane.querySelector(`.${NS}-quote`);
  if (data.quote && quoteEl) quoteEl.innerHTML = quoteHtml(data.quote);
  else if (!data.quote && quoteEl) quoteEl.remove();
  else if (data.quote && !quoteEl) {
    const note = pane.querySelector(`.${NS}-rich-note`);
    const div = document.createElement("div");
    div.className = `${NS}-quote`;
    div.innerHTML = quoteHtml(data.quote);
    (note || pane.querySelector(`.${NS}-counts`))?.before(div);
  }
  if (!pane.querySelector(`.${NS}-rich-note`) && (data.rich.video || data.rich.poll || data.rich.card || data.rich.article)) {
    appendRichNote(pane, richLabelsOf(data.rich));
  }
}

function appendRichNote(pane, labels) {
  const note = document.createElement("div");
  note.className = `${NS}-rich-note`;
  note.textContent = richNoteText(labels);
  pane.querySelector(`.${NS}-counts`)?.before(note);
}

// The pane's rich-note is rendered at build time. If the native cell's media
// hydrates later (video race measured in R3), append the note then — once.
// The rescan is bounded to a window after mount (media hydration lands in the
// first seconds in practice); afterwards the tick stops scanning the focal
// cell every 500ms.
export function syncRichNote(activeStatusId) {
  const pane = document.getElementById(PANE_ID);
  if (!pane || pane.querySelector(`.${NS}-rich-note`)) return;
  if (!richScanActive()) return;
  const cell = focalCellByStatusId(activeStatusId);
  if (!cell) return;
  const video = Boolean(cell.querySelector('[data-testid="videoPlayer"], video'));
  const poll = Boolean(cell.querySelector('[data-testid="poll"], [role="group"] [data-testid="vote"]'));
  const card = Boolean(cell.querySelector('[data-testid="card.wrapper"]'));
  if (!video && !poll && !card) return;
  appendRichNote(pane, [video && "视频/GIF", poll && "投票", card && "网站卡片"].filter(Boolean));
}

export function renderPane(data, { brandIconUrl, onAction, onClose, actionNote }) {
  const pane = document.createElement("div");
  pane.id = PANE_ID;
  pane.dataset.statusId = data.statusId; // invariant: pane shows the URL's post
  const q = data.quote;
  const handleAt = data.handle ? "@" + data.handle.replace(/^\//, "") : "";
  const richLabels = richLabelsOf(data.rich);
  const brandImg = brandIconUrl
    ? `<img class="${NS}-brand-icon" src="${ESCAPED(brandIconUrl)}" alt="">`
    : "";
  pane.innerHTML = `
      <header class="${NS}-bar">
        <button class="${NS}-close" title="关闭" aria-label="关闭阅读视图">✕</button>
        ${brandImg}<span class="${NS}-brand">Peek</span>
        <a class="${NS}-open" target="_blank" rel="noopener" href="https://x.com${ESCAPED(location.pathname)}">在 X 打开</a>
      </header>
      <div class="${NS}-body">
        <div class="${NS}-author">
          <img src="${ESCAPED(data.avatar)}" referrerpolicy="no-referrer" alt="">
          <div><b>${ESCAPED(data.name)}</b><span>${ESCAPED(handleAt)}</span></div>
        </div>
        ${data.textKnown ? `<div class="${NS}-text">${ESCAPED(data.text)}</div>` : `<div class="${NS}-text ${NS}-unknown">正文未识别</div>`}
        <div class="${NS}-photos">${data.photos.map((u) => `<img class="${NS}-photo" src="${ESCAPED(u)}" referrerpolicy="no-referrer" alt="">`).join("")}</div>
        ${q ? `<div class="${NS}-quote">${quoteHtml(q)}</div>` : ""}
        ${richLabels.length ? `<div class="${NS}-rich-note">${richNoteText(richLabels)}</div>` : ""}
        <div class="${NS}-counts">回复 ${fmtCount(data.reply)} · 转推 ${fmtCount(data.retweet)} · 喜欢 ${fmtCount(data.like)} · 书签 ${fmtCount(data.bookmark)}${data.timeText ? ` · ${ESCAPED(data.timeText)}` : ""}</div>
        <div class="${NS}-actions" role="toolbar" aria-label="定位右栏原生互动控件（不会代替你执行）">
          <button class="${NS}-act" data-act="reply" title="滚动到右栏原生回复框，由你亲自输入发送">定位回复</button>
          <button class="${NS}-act" data-act="retweet" title="定位右栏原生转推控件，由你亲自点击">定位转推</button>
          <button class="${NS}-act" data-act="like" title="定位右栏原生点赞控件，由你亲自点击">定位点赞</button>
          <button class="${NS}-act" data-act="bookmark" title="定位右栏原生收藏控件，由你亲自点击">定位收藏</button>
          <button class="${NS}-act" data-act="share" title="复制本帖链接">复制链接</button>
        </div>
        <div class="${NS}-note">${actionNote}</div>
      </div>`;
  pane.querySelector(`.${NS}-close`).addEventListener("click", onClose);
  pane.querySelector(`.${NS}-actions`).addEventListener("click", onAction);
  document.body.appendChild(pane);
  return pane;
}

export function removePaneAndStyle() {
  document.getElementById(PANE_ID)?.remove();
  document.getElementById(STYLE_ID)?.remove();
  document.documentElement.removeAttribute(`data-${NS}`);
}

export function paneMounted() {
  return Boolean(document.getElementById(PANE_ID));
}

export function mountedPane() {
  return document.getElementById(PANE_ID);
}
