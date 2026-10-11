// Peek Native Carrier PoC v2 — second-round fixes (review: devon-kong/peek-exploration).
// ISOLATED content script, detail pages only. Zero permissions, zero internal-API calls.
//
// Round-2 P0 fixes applied here:
//  P0-2 routing: no history.pushState/replaceState wrapping (an ISOLATED-world wrapper
//    cannot observe the main world's SPA calls). Route observation = popstate + hashchange
//    + Navigation API (when exposed to this world) + a bounded 500ms pathname poll as the
//    correctness net. Status-id changes rebuild; non-detail routes tear down.
//  P0-2 close: history-aware close. history.back() only when this document actually
//    observed an in-session X route change; a directly-opened (external) detail page just
//    dismisses the enhancement instead of leaving X.
//  P0-3 focal: focal cell located by URL status id (never "first article" — reply detail
//    pages start with ancestor cells). Full quote text (no 160-char cut). Photo URLs kept
//    verbatim (query params preserved). K/M-suffix counts parsed numerically; missing
//    values render as 未知, never 0. Rich-media focal posts (video/GIF/poll/card) keep the
//    native cell visible — the left pane never pretends to carry what it cannot.
//  P0-1 layout: left pane and right cells share one reference container (vw), X's right
//    rail and left nav are removed from layout while reading, and the pane follows X's
//    light/dark theme via computed colors.
//  Interaction mirror: the pane's action bar mirrors native counts/states and delegates
//    clicks to the native buttons (isTrusted=false, class-3 automation per task book 8.3).
//    NO write is executed by this PoC or its verification; writes remain NOT_TESTED.

(() => {
  "use strict";

  if (window.__peekPocInstalled) return; // extension-reload idempotency
  window.__peekPocInstalled = true;

  const NS = "peek-poc";
  const PANE_ID = `${NS}-pane`;
  const STYLE_ID = `${NS}-style`;
  const ROUTE_POLL_MS = 500;
  const THEMES = ["auto", "light", "dark"];
  const ESCAPED = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  let activeStatusId = null;
  let buildToken = 0;
  let themeObserver = null;
  let sessionNavigated = false; // this document saw an in-session X route change

  const statusIdFromPath = () => (location.pathname.match(/\/status\/(\d+)/) || [])[1] || null;
  const isDetailPath = () => Boolean(statusIdFromPath());

  // ---------- route observation (no history wrapping) ----------

  function checkRoute() {
    const id = statusIdFromPath();
    if (id !== activeStatusId) {
      const previous = activeStatusId;
      activeStatusId = id;
      if (previous !== null || id !== null) sessionNavigated = true;
      if (id) {
        removeReader();
        buildReader();
      } else {
        removeReader();
      }
    } else if (id && document.getElementById(PANE_ID)) {
      // React may remount the focal cell and drop the tag; re-tag while reading.
      // Also re-apply theme on the bounded poll: cheap and robust against any
      // theme-change mutation the observers might miss.
      ensureFocalTag(id);
      applyTheme();
    }
  }

  function ensureFocalTag(id) {
    if (document.querySelector(`[data-testid="cellInnerDiv"].${NS}-focal-cell`)) return;
    if (document.documentElement.getAttribute(`data-${NS}`) !== "on") return;
    focalCellByStatusId(id)?.classList.add(`${NS}-focal-cell`);
  }

  window.addEventListener("popstate", () => queueMicrotask(checkRoute));
  window.addEventListener("hashchange", () => queueMicrotask(checkRoute));
  if (typeof window.navigation?.addEventListener === "function") {
    // Fires for same-document navigations initiated by any world that shares this
    // session history; guarded because isolated-world exposure may vary by version.
    try {
      window.navigation.addEventListener("navigate", () => queueMicrotask(checkRoute));
    } catch { /* fall back to poll + popstate */ }
  }
  setInterval(checkRoute, ROUTE_POLL_MS); // bounded correctness net; no X internals

  // ---------- theme ----------

  function readTheme() {
    const bg = getComputedStyle(document.body).backgroundColor;
    const m = bg.match(/(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/);
    if (m) {
      const [r, g, b] = [+m[1], +m[2], +m[3]];
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) < 128 ? "dark" : "light";
    }
    // transparent body (X paints elsewhere): fall back to the root color-scheme
    if (getComputedStyle(document.documentElement).colorScheme === "light") return "light";
    return "dark";
  }

  function applyTheme() {
    const pane = document.getElementById(PANE_ID);
    if (!pane) return;
    const theme = readTheme();
    const palette = theme === "dark"
      ? { bg: "#000000", fg: "#e7e9ea", dim: "#71767b", border: "#2f3336", hover: "#181818", accent: "#1d9bf0" }
      : { bg: "#ffffff", fg: "#0f1419", dim: "#536471", border: "#eff3f4", hover: "#f7f9f9", accent: "#1d9bf0" };
    for (const [k, v] of Object.entries(palette)) pane.style.setProperty(`--peek-${k}`, v);
  }

  function watchTheme() {
    themeObserver?.disconnect();
    themeObserver = new MutationObserver(() => applyTheme());
    // X may switch themes via root or body class/style changes; watch both.
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    if (document.body) themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
    applyTheme();
  }

  // ---------- extraction ----------

  function parseCount(text) {
    const m = String(text ?? "").trim().match(/^([\d.,]+)\s*([KMkM])?$/);
    if (!m) return null; // unknown — never fabricate 0
    const base = parseFloat(m[1].replace(/,/g, ""));
    if (!Number.isFinite(base)) return null;
    return Math.round(base * (m[2] === "K" || m[2] === "k" ? 1e3 : m[2] === "M" ? 1e6 : 1));
  }

  function countOf(root, name) {
    // X flips the testid with state: like/unlike, retweet/unretweet, bookmark/unbookmark
    const active = Boolean(root.querySelector(`[data-testid="un${name}"]`));
    const node = root.querySelector(`[data-testid="${name}"], [data-testid="un${name}"]`);
    // zero-count buttons render no text; the number lives in aria-label ("0 喜欢次数。喜欢")
    const aria = node?.getAttribute("aria-label") || "";
    const fromAria = aria ? parseCount(aria.match(/^([\d.,]+\s*[KMkM]?)/)?.[1] ?? "") : null;
    const value = parseCount(node?.innerText) ?? fromAria;
    return { value, active, known: Boolean(node) };
  }

  function focalCellByStatusId(focalId) {
    return [...document.querySelectorAll('[data-testid="cellInnerDiv"]')]
      .find((cell) => [...cell.querySelectorAll(`a[href*="/status/${focalId}"]`)]
        .some((a) => a.querySelector("time")));
  }

  function extractFocal() {
    const focalId = statusIdFromPath();
    if (!focalId) return null;
    // Logged-in path: focal cell located by its own timestamp permalink.
    const cell = focalCellByStatusId(focalId);
    const art = cell && (cell.querySelector("article[data-testid='tweet']") || cell.querySelector("article"));
    if (art) return { ...extractFromArticle(art, focalId), nativeCell: cell };
    // Logged-out fallback: server-rendered conversation (#urt:conversation:<id>).
    // These pages have no <time> elements at all; ancestors (if any) render above
    // the focal post and may carry "view thread" links, so take the LAST article
    // whose canonical permalink (/<handle>/status/<focalId>) matches exactly.
    const convRoot = document.querySelector(`[id^="urt:conversation"][id*="${focalId}"]`);
    if (!convRoot) return null; // no first-article fallback: reply pages start with ancestors
    const canonical = new RegExp(`^/[^/]+/status/${focalId}$`);
    const matches = [...convRoot.querySelectorAll('article')]
      .filter((a) => [...a.querySelectorAll(`a[href*="/status/${focalId}"]`)]
        .some((l) => canonical.test(l.getAttribute("href") || "")));
    const focal = matches[matches.length - 1];
    if (!focal) return null;
    return { ...extractFromArticle(focal, focalId), nativeCell: null };
  }

  function extractFromArticle(art, focalId) {
    const handle = [...art.querySelectorAll('a[href^="/"]')]
      .map((a) => a.getAttribute("href"))
      .find((h) => /^\/[^/]+$/.test(h));
    const nameNode = art.querySelector('[data-testid="User-Name"]');
    // rich media the left pane cannot carry — native cell stays visible for these
    const video = Boolean(art.querySelector('[data-testid="videoPlayer"]')) || Boolean(art.querySelector("video"));
    const poll = Boolean(art.querySelector('[data-testid="poll"], [role="group"] [data-testid="vote"]'));
    const card = Boolean(art.querySelector('[data-testid="card.wrapper"]'));
    const quoteNode = art.querySelector('div[role="link"]');
    const quoteAuthor = quoteNode?.querySelector('[data-testid="User-Name"]')?.innerText.split("\n")[0] || null;
    const photoNodes = [...art.querySelectorAll('[data-testid="tweetPhoto"] img, img[src*="pbs.twimg.com/media"]')];
    const photos = [...new Set(photoNodes.map((i) => i.src))]; // URL kept verbatim: query params control format/size
    const textNode = art.querySelector('[data-testid="tweetText"]');
    let text = textNode ? textNode.innerText : "";
    let textSource = "tweetText";
    if (!textNode) {
      // logged-out server rendering has no testids; take the article's own text and
      // label the source so the UI can show it is approximate, not silently wrong
      const UI_LINE = /^(show translation|显示翻译|translate post)$/i;
      const lines = (art.innerText || "").split("\n").map((l) => l.trim()).filter(Boolean)
        .filter((l) => !UI_LINE.test(l));
      // drop the leading author block: display name and @handle lines. Logged-out
      // pages have no User-Name node, so locate the handle line within the first 3.
      const handleIdx = lines.slice(0, 3).findIndex((l) => l.startsWith("@") && l.length <= 20);
      if (handleIdx >= 0) lines.splice(0, handleIdx + 1);
      text = lines.join("\n");
      textSource = "fallback-logged-out";
    }
    return {
      statusId: focalId,
      name: nameNode ? nameNode.innerText.split("\n")[0] : (handle ? handle.slice(1) : "未知作者"),
      handle: handle || "",
      avatar: art.querySelector('img[src*="profile_images"]')?.src || "",
      time: art.querySelector("time")?.getAttribute("datetime") || "",
      timeText: art.querySelector("time")?.innerText || "",
      text,
      textKnown: text.trim().length > 0, // absent text node = unknown, not empty
      textSource,
      photos,
      quote: quoteNode ? {
        author: quoteAuthor,
        text: quoteNode.querySelector('[data-testid="tweetText"]')?.innerText || "",
        photos: [...quoteNode.querySelectorAll('[data-testid="tweetPhoto"] img')].map((i) => i.src)
      } : null,
      rich: { video, poll, card },
      reply: countOf(art, "reply"),
      retweet: countOf(art, "retweet"),
      like: countOf(art, "like"),
      bookmark: countOf(art, "bookmark")
    };
  }

  // ---------- render ----------

  function fmtCount(c) {
    if (!c.known) return "未知";
    if (c.value === null) return "未知";
    return c.value.toLocaleString("en-US");
  }

  function renderPane(data) {
    const pane = document.createElement("div");
    pane.id = PANE_ID;
    const q = data.quote;
    pane.innerHTML = `
      <header class="${NS}-bar">
        <button class="${NS}-close" title="关闭">✕</button>
        <span class="${NS}-brand">Peek PoC · 原生承载 v2</span>
        <a class="${NS}-open" target="_blank" rel="noopener" href="https://x.com${ESCAPED(location.pathname)}">在 X 打开</a>
      </header>
      <div class="${NS}-body">
        <div class="${NS}-author">
          <img src="${ESCAPED(data.avatar)}" referrerpolicy="no-referrer" alt="">
          <div><b>${ESCAPED(data.name)}</b><span>${ESCAPED(data.handle)}</span></div>
        </div>
        ${data.textKnown ? `<div class="${NS}-text">${ESCAPED(data.text)}</div>` : `<div class="${NS}-text ${NS}-unknown">正文未识别</div>`}
        ${data.photos.map((u) => `<img class="${NS}-photo" src="${ESCAPED(u)}" referrerpolicy="no-referrer" alt="">`).join("")}
        ${q ? `<div class="${NS}-quote">
            <div class="${NS}-quote-author">${ESCAPED(q.author ?? "未知作者")}</div>
            <div>${ESCAPED(q.text || "（引用正文未识别）")}</div>
            ${q.photos.map((u) => `<img class="${NS}-photo" src="${ESCAPED(u)}" referrerpolicy="no-referrer" alt="">`).join("")}
          </div>` : ""}
        ${data.rich.video || data.rich.poll || data.rich.card ? `<div class="${NS}-rich-note">此帖含${[data.rich.video && "视频/GIF", data.rich.poll && "投票", data.rich.card && "网站卡片"].filter(Boolean).join("、")}，由右侧原生区域完整承载（本栏仅镜像文字与互动）。</div>` : ""}
        <div class="${NS}-counts">回复 ${fmtCount(data.reply)} · 转推 ${fmtCount(data.retweet)} · 喜欢 ${fmtCount(data.like)} · 书签 ${fmtCount(data.bookmark)}${data.timeText ? ` · ${ESCAPED(data.timeText)}` : ""}</div>
        <div class="${NS}-actions" role="toolbar" aria-label="原帖操作（镜像原生状态）">
          <button class="${NS}-act" data-act="reply">回复</button>
          <button class="${NS}-act ${data.retweet.active ? "is-active" : ""}" data-act="retweet">转推${data.retweet.active ? "·已转" : ""}</button>
          <button class="${NS}-act ${data.like.active ? "is-active" : ""}" data-act="like">${data.like.active ? "已赞" : "点赞"}</button>
          <button class="${NS}-act ${data.bookmark.active ? "is-active" : ""}" data-act="bookmark">${data.bookmark.active ? "已收藏" : "收藏"}</button>
          <button class="${NS}-act" data-act="share">复制链接</button>
        </div>
        <div class="${NS}-note">左栏由 Peek 从原生 DOM 提取绘制；互动按钮镜像原生状态并委托给原生控件（写入未验收）。${data.rich.video || data.rich.poll || data.rich.card ? "" : "右栏为原生评论流（独立滚动）。"}</div>
      </div>`;
    pane.querySelector(`.${NS}-close`).addEventListener("click", closeReader);
    pane.querySelector(`.${NS}-actions`).addEventListener("click", onAction);
    document.body.appendChild(pane);
  }

  function nativeActionButton(root, name) {
    return root?.querySelector(`[data-testid="${name}"], [data-testid="un${name}"]`);
  }

  function onAction(event) {
    const btn = event.target.closest(`.${NS}-act`);
    if (!btn) return;
    const cell = [...document.querySelectorAll('[data-testid="cellInnerDiv"]')]
      .find((c) => c.classList.contains(`${NS}-focal-cell`)) || focalCellByStatusId(statusIdFromPath());
    const act = btn.dataset.act;
    if (act === "share") {
      navigator.clipboard?.writeText(`https://x.com${location.pathname}`).catch(() => {});
      return;
    }
    if (act === "reply") {
      // reveal the native cell and focus its composer (read-only UI action)
      cell?.classList.remove(`${NS}-focal-cell`);
      cell?.scrollIntoView({ block: "center" });
      cell?.querySelector('[data-testid="tweetTextarea_0"], [data-testid="tweetButtonInline"]')?.focus?.();
      return;
    }
    if (act === "like" || act === "retweet" || act === "bookmark") {
      // class-3 delegation: synthetic click on the NATIVE button; X owns the whole
      // write path and state machine. Never called during verification (NOT_TESTED).
      const native = nativeActionButton(cell, act);
      native?.click();
      return;
    }
  }

  function closeReader() {
    if (sessionNavigated) {
      history.back(); // in-session: the previous entry is X's own list view
    } else {
      removeReader(); // direct/external entry: dismiss the enhancement, stay on X
    }
  }

  // ---------- build / teardown ----------

  async function buildReader() {
    const focalId = statusIdFromPath();
    if (!focalId) return;
    const token = ++buildToken;
    let data = null;
    for (let i = 0; i < 30 && token === buildToken; i++) {
      data = extractFocal();
      if (data && data.statusId === focalId) break;
      data = null;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (token !== buildToken || !data) return;
    if (document.getElementById(PANE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      /* one reference container: both panes use vw while reading */
      html[data-${NS}] [data-testid="sidebarColumn"] { display: none !important; }
      html[data-${NS}] header[role="banner"]:not(#${PANE_ID} header) { display: none !important; }
      html[data-${NS}] [data-testid="primaryColumn"] { width: 100vw !important; max-width: 100vw !important; }
      html[data-${NS}] [data-testid="cellInnerDiv"].${NS}-focal-cell { visibility: hidden !important; }
      html[data-${NS}] [data-testid="cellInnerDiv"]:not(.${NS}-focal-cell) { margin-left: 52vw !important; width: 48vw !important; }
    `;
    document.head.appendChild(style);
    document.documentElement.setAttribute(`data-${NS}`, "on");

    if (!data.rich.video && !data.rich.poll && !data.rich.card) {
      // text/photo/quote focal: full left-pane parity, native cell hidden
      data.nativeCell?.classList.add(`${NS}-focal-cell`);
    }
    renderPane(data);
    watchTheme();
  }

  function removeReader() {
    document.getElementById(PANE_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
    document.documentElement.removeAttribute(`data-${NS}`);
    document.querySelector(`.${NS}-focal-cell`)?.classList.remove(`${NS}-focal-cell`);
    themeObserver?.disconnect();
    themeObserver = null;
  }

  if (isDetailPath()) {
    activeStatusId = statusIdFromPath();
    buildReader();
  }

  // test hook: lets the verification harness unit-test the real helpers through CDP
  if (window.__PEEK_POC_TEST__) {
    window.__peekPocTest = { parseCount, readTheme, statusIdFromPath };
  }
})();
