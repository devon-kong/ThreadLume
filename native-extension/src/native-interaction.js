import {t} from './i18n.js';
// Peek Native — native interaction adapter. The native controls own every real
// account action: the user personally likes, reposts, bookmarks, follows and
// replies on X's own UI. Peek never synthesizes account writes (no .click() on
// write controls, no write API). The left pane's action row only LOCATES the
// corresponding native control in the right column and highlights it; the copy
// says so, and the post-click feedback says so.

import { NS, PANE_ID } from "./constants.js";
import { focalCellByStatusId } from "./focal-extractor.js";
import { statusIdFromPath } from "./constants.js";

const ownedTimers = new Set();

export function ownedTimeout(fn, ms) {
  const h = setTimeout(() => {
    ownedTimers.delete(h);
    fn();
  }, ms);
  ownedTimers.add(h);
  return h;
}

export function clearOwnedTimeouts() {
  for (const h of ownedTimers) clearTimeout(h);
  ownedTimers.clear();
}

export function pulse(native) {
  if (!native) return false;
  native.scrollIntoView({ block: "center", behavior: "smooth" });
  const prev = native.style.outline;
  native.style.outline = "2px solid var(--peek-accent, #1d9bf0)";
  native.style.outlineOffset = "3px";
  ownedTimeout(() => {
    if (native.isConnected) native.style.outline = prev;
  }, 1600);
  return true;
}

// Honest per-action feedback, shown in place of the static note (no layout
// shift): what Peek did (located/focused) and what the USER still does.
const FEEDBACK = {
  reply: "已滚动到右栏并聚焦原生回复框——请亲自输入并发送。",
  retweet: "已在右栏定位原生转推控件并高亮——是否转推由你亲自点击决定。",
  like: "已在右栏定位原生点赞控件并高亮——是否点赞由你亲自点击决定。",
  bookmark: "已在右栏定位原生收藏控件并高亮——是否收藏由你亲自点击决定。",
  share: "链接已复制到剪贴板。"
};

function showFeedback(text) {
  const note = document.querySelector(`#${PANE_ID} .${NS}-note`);
  if (!note) return;
  if (note.dataset.staticText === undefined) note.dataset.staticText = note.textContent;
  note.textContent = t(text);
  ownedTimeout(() => {
    if (note.isConnected && note.dataset.staticText !== undefined) {
      note.textContent = note.dataset.staticText;
      delete note.dataset.staticText;
    }
  }, 2400);
}

export function onAction(event) {
  const btn = event.target.closest(`.${NS}-act`);
  if (!btn) return null;
  const act = btn.dataset.act;
  if (act === "share") {
    navigator.clipboard?.writeText(`https://x.com${location.pathname}`).catch(() => {});
    showFeedback(FEEDBACK.share);
    return { act, located: false };
  }
  const cell = focalCellByStatusId(statusIdFromPath());
  if (!cell) {
    showFeedback("未能在右栏找到该帖的原生控件——可手动滚动右栏操作。");
    return { act, located: false };
  }
  if (act === "reply") {
    // reveal the native composer for the focal post (user types and submits themselves)
    cell.scrollIntoView({ block: "start", behavior: "smooth" });
    ownedTimeout(() => {
      if (!cell.isConnected) return;
      cell.querySelector('[data-testid="tweetTextarea_0"], [data-testid="tweetButtonInline"]')?.focus?.();
    }, 450);
    showFeedback(FEEDBACK.reply);
    return { act, located: true };
  }
  // locate-and-highlight: the user performs the write on the native control.
  // Peek never clicks these controls and never constructs a write request.
  const name = act === "like" ? "like" : act === "retweet" ? "retweet" : "bookmark";
  const located = pulse(cell.querySelector(`[data-testid="${name}"], [data-testid="un${name}"]`));
  showFeedback(located ? FEEDBACK[act] ?? "已在右栏定位原生控件，请亲自操作。" : "未能在右栏找到该帖的原生控件——可手动滚动右栏操作。");
  return { act, located };
}
