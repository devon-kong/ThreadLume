// Peek Native Carrier PoC v3 — third-round functional fixes (R3 S5).
// ISOLATED content script, detail pages only. Zero permissions, zero internal-API calls.
//
// v3 changes over round-2 v2 (all driven by R3 measured evidence):
//  1. The native focal cell is NO LONGER hidden. R3 measured four defects caused by
//     hiding it: (a) rich-media detection races hydration, so video/poll/card cells
//     were hidden with no note; (b) the poll-cycle re-tag re-hid cells even when rich
//     was detected at build time; (c) the hidden cell reserved its full height, leaving
//     a large blank region at the top of the replies column; (d) the focal post's own
//     native action bar / hover card / composer became unreachable, so interactions had
//     to rely on synthetic delegation. Keeping the cell visible removes all four and
//     makes every interaction a real user click on a real X control (class-A). The left
//     pane stays as the 52vw reading copy; the right column top is the interactive
//     original. Duplication is the documented trade-off.
//  2. Pane action buttons no longer delegate via synthetic .click(). They scroll the
//     native focal cell into view and pulse-highlight the corresponding native button;
//     the user performs the write themselves. Reply scrolls to and focuses the native
//     composer. Copy-link keeps using the clipboard API (no X request involved).
//  3. X Articles get a dedicated extraction path: twitter-article-title +
//     twitterArticleRichTextView + inline tweetPhoto images. The logged-out-style
//     fallback (which leaked engagement-count lines into the text) is now only used
//     when no dedicated node exists, and filters count-only lines.
//  4. Premium ultra-long focal posts: if X collapsed the text behind a "show more"
//     link, the PoC clicks it once at build time (a display expansion, like a user
//     reading — not an account write) and extracts the expanded text.
//  5. Handle rendering: href-derived handles render as "@name" without the leading
//     slash.
//  6. Quote text: drop a leading author-name line that duplicates the quote author.

(() => {
  "use strict";

  if (window.__peekPocInstalled) return; // extension-reload idempotency
  window.__peekPocInstalled = true;

  const NS = "peek-poc";
  const PANE_ID = `${NS}-pane`;
  const STYLE_ID = `${NS}-style`;
  const ROUTE_POLL_MS = 500;
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
      // Bounded maintenance while reading: keep the theme in sync with any
      // theme-change mutation the observers might miss, and surface a rich-media
      // note if the video player/poll/card hydrated after the pane was built
      // (extraction runs once; hydration can land later).
      applyTheme();
      syncRichNote();
    }
  }

  // The pane's rich-note is rendered at build time. If the native cell's media
  // hydrates later (video race measured in R3), append the note then — once.
  function syncRichNote() {
    const pane = document.getElementById(PANE_ID);
    if (!pane || pane.querySelector(`.${NS}-rich-note`)) return;
    const cell = focalCellByStatusId(activeStatusId);
    if (!cell) return;
    const video = Boolean(cell.querySelector('[data-testid="videoPlayer"], video'));
    const poll = Boolean(cell.querySelector('[data-testid="poll"], [role="group"] [data-testid="vote"]'));
    const card = Boolean(cell.querySelector('[data-testid="card.wrapper"]'));
    if (!video && !poll && !card) return;
    const note = document.createElement("div");
    note.className = `${NS}-rich-note`;
    note.textContent = `此帖含${[video && "视频/GIF", poll && "投票", card && "网站卡片"].filter(Boolean).join("、")}——右侧栏顶部原生格完整承载媒体与互动，可滚动到该处直接操作。`;
    pane.querySelector(`.${NS}-counts`)?.before(note);
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

  function photoUrlsIn(scope) {
    return [...new Set([...scope.querySelectorAll('[data-testid="tweetPhoto"] img, img[src*="pbs.twimg.com/media"]')].map((i) => i.src))];
  }

  // X Articles render title/body in dedicated containers (not tweetText).
  function extractArticle(art) {
    const title = art.querySelector('[data-testid="twitter-article-title"]')?.innerText?.trim() || null;
    const body = art.querySelector('[data-testid="twitterArticleRichTextView"]');
    if (!body) return null;
    return { title, text: body.innerText || "", photos: photoUrlsIn(body) };
  }

  // Logged-out / no-testid fallback. Filters UI lines AND count-only lines so the
  // engagement row ("3\n3\n11\n3,578") never leaks into article/post text.
  function fallbackText(art) {
    const UI_LINE = /^(show translation|显示翻译|translate post)$/i;
    const COUNT_ONLY = /^[\d.,]+\s*[KMkM]?$/;
    const lines = (art.innerText || "").split("\n").map((l) => l.trim()).filter(Boolean)
      .filter((l) => !UI_LINE.test(l) && !COUNT_ONLY.test(l));
    const handleIdx = lines.slice(0, 3).findIndex((l) => l.startsWith("@") && l.length <= 20);
    if (handleIdx >= 0) lines.splice(0, handleIdx + 1);
    return lines.join("\n");
  }

  async function expandShowMore(art) {
    // Premium long posts collapse the body behind a show-more link. One display
    // expansion, bounded to the focal article, mirrors what a reading user does.
    const more = [...art.querySelectorAll('[data-testid="tweet-text-show-more-link"], a[href*="show-more"], [role="button"]')]
      .find((el) => /^(显示更多|Show more)$/i.test((el.innerText || "").trim()));
    if (more) {
      more.click();
      await new Promise((r) => setTimeout(r, 700));
    }
  }

  async function extractFocal() {
    const focalId = statusIdFromPath();
    if (!focalId) return null;
    const cell = focalCellByStatusId(focalId);
    const art = cell && (cell.querySelector("article[data-testid='tweet']") || cell.querySelector("article"));
    if (!art) return null;
    await expandShowMore(art);
    return { ...extractFromArticle(art, focalId), nativeCell: cell };
  }

  function extractFromArticle(art, focalId) {
    const handle = [...art.querySelectorAll('a[href^="/"]')]
      .map((a) => a.getAttribute("href"))
      .find((h) => /^\/[^/]+$/.test(h));
    const nameNode = art.querySelector('[data-testid="User-Name"]');
    // rich media the pane mirrors but never hides — the native cell stays visible
    const video = Boolean(art.querySelector('[data-testid="videoPlayer"]')) || Boolean(art.querySelector("video"));
    const poll = Boolean(art.querySelector('[data-testid="poll"], [role="group"] [data-testid="vote"]'));
    const card = Boolean(art.querySelector('[data-testid="card.wrapper"]'));
    const quoteNode = art.querySelector('div[role="link"]');
    const quoteAuthorNode = quoteNode?.querySelector('[data-testid="User-Name"]');
    const quoteAuthor = quoteAuthorNode?.innerText.split("\n")[0] || null;
    let quoteText = quoteNode?.querySelector('[data-testid="tweetText"]')?.innerText || "";
    if (quoteAuthor && quoteText.trim().startsWith(quoteAuthor.trim())) {
      quoteText = quoteText.trim().slice(quoteAuthor.trim().length).replace(/^\s+/, "");
    }
    const article = extractArticle(art);
    let text, textSource;
    if (article) {
      text = article.title ? `${article.title}\n\n${article.text}` : article.text;
      textSource = "article";
    } else {
      const textNode = art.querySelector('[data-testid="tweetText"]');
      text = textNode ? textNode.innerText : "";
      textSource = "tweetText";
      if (!textNode) {
        text = fallbackText(art);
        textSource = "fallback";
      }
    }
    const photos = article ? [...new Set([...photoUrlsIn(art.querySelector('[data-testid="twitterArticleReadView"]') || art), ...photoUrlsIn(art)])] : photoUrlsIn(art);
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
        text: quoteText,
        photos: [...quoteNode.querySelectorAll('[data-testid="tweetPhoto"] img')].map((i) => i.src)
      } : null,
      rich: { video, poll, card, article: Boolean(article) },
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
    const handleAt = data.handle ? "@" + data.handle.replace(/^\//, "") : "";
    const richLabels = [
      data.rich.video && "视频/GIF",
      data.rich.poll && "投票",
      data.rich.card && "网站卡片",
      data.rich.article && "X Article"
    ].filter(Boolean);
    pane.innerHTML = `
      <header class="${NS}-bar">
        <button class="${NS}-close" title="关闭">✕</button>
        <span class="${NS}-brand">Peek PoC · 原生承载 v3</span>
        <a class="${NS}-open" target="_blank" rel="noopener" href="https://x.com${ESCAPED(location.pathname)}">在 X 打开</a>
      </header>
      <div class="${NS}-body">
        <div class="${NS}-author">
          <img src="${ESCAPED(data.avatar)}" referrerpolicy="no-referrer" alt="">
          <div><b>${ESCAPED(data.name)}</b><span>${ESCAPED(handleAt)}</span></div>
        </div>
        ${data.textKnown ? `<div class="${NS}-text">${ESCAPED(data.text)}</div>` : `<div class="${NS}-text ${NS}-unknown">正文未识别</div>`}
        ${data.photos.map((u) => `<img class="${NS}-photo" src="${ESCAPED(u)}" referrerpolicy="no-referrer" alt="">`).join("")}
        ${q ? `<div class="${NS}-quote">
            <div class="${NS}-quote-author">${ESCAPED(q.author ?? "未知作者")}</div>
            <div>${ESCAPED(q.text || "（引用正文未识别）")}</div>
            ${q.photos.map((u) => `<img class="${NS}-photo" src="${ESCAPED(u)}" referrerpolicy="no-referrer" alt="">`).join("")}
          </div>` : ""}
        ${richLabels.length ? `<div class="${NS}-rich-note">此帖含${richLabels.join("、")}——右侧栏顶部原生格完整承载媒体与互动，可滚动到该处直接操作。</div>` : ""}
        <div class="${NS}-counts">回复 ${fmtCount(data.reply)} · 转推 ${fmtCount(data.retweet)} · 喜欢 ${fmtCount(data.like)} · 书签 ${fmtCount(data.bookmark)}${data.timeText ? ` · ${ESCAPED(data.timeText)}` : ""}</div>
        <div class="${NS}-actions" role="toolbar" aria-label="定位原生互动控件">
          <button class="${NS}-act" data-act="reply">回复</button>
          <button class="${NS}-act" data-act="retweet">转推</button>
          <button class="${NS}-act" data-act="like">点赞</button>
          <button class="${NS}-act" data-act="bookmark">收藏</button>
          <button class="${NS}-act" data-act="share">复制链接</button>
        </div>
        <div class="${NS}-note">左栏为 Peek 阅读副本（DOM 提取）；互动一律由你在右侧原生控件上亲自完成——点上方按钮会定位并高亮对应原生控件，不会代替你点击。${richLabels.length ? "" : "右栏顶部即原帖，下方为原生评论流。"}</div>
      </div>`;
    pane.querySelector(`.${NS}-close`).addEventListener("click", closeReader);
    pane.querySelector(`.${NS}-actions`).addEventListener("click", onAction);
    document.body.appendChild(pane);
  }

  function pulse(native) {
    if (!native) return;
    native.scrollIntoView({ block: "center", behavior: "smooth" });
    const prev = native.style.outline;
    native.style.outline = "2px solid var(--peek-accent, #1d9bf0)";
    native.style.outlineOffset = "3px";
    setTimeout(() => { native.style.outline = prev; }, 1600);
  }

  function onAction(event) {
    const btn = event.target.closest(`.${NS}-act`);
    if (!btn) return;
    const cell = focalCellByStatusId(statusIdFromPath());
    const act = btn.dataset.act;
    if (act === "share") {
      navigator.clipboard?.writeText(`https://x.com${location.pathname}`).catch(() => {});
      return;
    }
    if (!cell) return;
    if (act === "reply") {
      // reveal the native composer for the focal post (user types and submits themselves)
      cell.scrollIntoView({ block: "start", behavior: "smooth" });
      setTimeout(() => {
        cell?.querySelector('[data-testid="tweetTextarea_0"], [data-testid="tweetButtonInline"]')?.focus?.();
      }, 450);
      return;
    }
    // locate-and-highlight: the user performs the write on the native control
    const name = act === "like" ? "like" : act === "retweet" ? "retweet" : "bookmark";
    const native = cell.querySelector(`[data-testid="${name}"], [data-testid="un${name}"]`);
    pulse(native);
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
      data = await extractFocal();
      if (data && data.statusId === focalId) break;
      data = null;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (token !== buildToken || !data) return;
    if (document.getElementById(PANE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      /* one reference container: both panes use vw while reading.
         The native focal cell stays visible (v3): it renders as the first cell of
         the right column with its full native action bar, media and composer. */
      html[data-${NS}] [data-testid="sidebarColumn"] { display: none !important; }
      html[data-${NS}] header[role="banner"]:not(#${PANE_ID} header) { display: none !important; }
      html[data-${NS}] [data-testid="primaryColumn"] { width: 100vw !important; max-width: 100vw !important; }
      html[data-${NS}] [data-testid="cellInnerDiv"] { margin-left: 52vw !important; width: 48vw !important; }
    `;
    document.head.appendChild(style);
    document.documentElement.setAttribute(`data-${NS}`, "on");

    renderPane(data);
    watchTheme();
  }

  function removeReader() {
    document.getElementById(PANE_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
    document.documentElement.removeAttribute(`data-${NS}`);
    themeObserver?.disconnect();
    themeObserver = null;
  }

  if (isDetailPath()) {
    activeStatusId = statusIdFromPath();
    buildReader();
  }

  // test hook: lets the verification harness unit-test the real helpers through CDP
  if (window.__PEEK_POC_TEST__) {
    window.__peekPocTest = { parseCount, readTheme, statusIdFromPath, fallbackText };
  }
})();
