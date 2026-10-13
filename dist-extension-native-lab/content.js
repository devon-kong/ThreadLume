// Peek Native (M2-B1 lab) — bundled content script. Source: native-extension/src/*.js
(() => {
  // native-extension/src/constants.js
  var NS = "peek-native";
  var PANE_ID = `${NS}-pane`;
  var STYLE_ID = `${NS}-style`;
  var ROUTE_POLL_ACTIVE_MS = 500;
  var ROUTE_POLL_IDLE_MS = 2e3;
  var BUILD_POLL_MS = 500;
  var BUILD_MAX_ATTEMPTS = 30;
  var RECOVERY_MAX_ROUNDS = 3;
  var RECOVERY_DELAY_MS = 3e3;
  var RICH_SCAN_WINDOW_MS = 2e4;
  var HYDRATION_POLL_MS = 250;
  var HYDRATION_POLL_MAX = 12;
  var ESCAPED = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function sameSiteX(url) {
    try {
      const h = new URL(url).hostname;
      return h === "x.com" || h.endsWith(".x.com") || h === "twitter.com" || h.endsWith(".twitter.com");
    } catch {
      return false;
    }
  }
  var statusIdFromPath = () => (location.pathname.match(/\/status\/(\d+)/) || [])[1] || null;
  var isDetailPath = () => Boolean(statusIdFromPath());

  // native-extension/src/navigation-session.js
  var navTrail = [];
  var navTrailIdx = -1;
  var pendingTraverse = false;
  function initNavigationSession() {
    try {
      navTrail = [location.href];
      navTrailIdx = 0;
    } catch {
    }
  }
  var NAV_API = (() => {
    try {
      if (window.__peekNoNavApi) return false;
      return typeof window.navigation?.addEventListener === "function";
    } catch {
      return false;
    }
  })();
  function recordNav(type, destUrl) {
    if (!destUrl || navTrail[navTrailIdx] === destUrl) return;
    if (type === "replace") {
      if (navTrailIdx >= 0) navTrail[navTrailIdx] = destUrl;
      else {
        navTrail = [destUrl];
        navTrailIdx = 0;
      }
    } else if (type === "traverse") {
      const at = navTrail.lastIndexOf(destUrl);
      if (at >= 0) navTrailIdx = at;
      else {
        navTrail = navTrail.slice(0, navTrailIdx + 1);
        navTrail.push(destUrl);
        navTrailIdx = navTrail.length - 1;
      }
    } else if (type === "reload") {
    } else if (type === "push" || type === "auto_toplevel") {
      navTrail = navTrail.slice(0, navTrailIdx + 1);
      navTrail.push(destUrl);
      navTrailIdx = navTrail.length - 1;
    }
  }
  function syncTrailFromLocation(viaTraverse) {
    const href = location.href;
    if (navTrail.length === 0) {
      navTrail = [href];
      navTrailIdx = 0;
      return;
    }
    if (navTrail[navTrailIdx] === href) return;
    if (viaTraverse) {
      const at = navTrail.lastIndexOf(href);
      if (at >= 0) {
        navTrailIdx = at;
        return;
      }
    }
    navTrail = navTrail.slice(0, navTrailIdx + 1);
    navTrail.push(href);
    navTrailIdx = navTrail.length - 1;
  }
  function safeBackTarget() {
    try {
      const nav = NAV_API ? window.navigation : null;
      if (nav && typeof nav.entries === "function" && nav.currentEntry) {
        const idx = nav.currentEntry.index;
        if (!(idx > 0)) return { back: false, why: "navapi-initial-entry" };
        const prev = nav.entries()[idx - 1];
        if (prev?.url && sameSiteX(prev.url)) return { back: true, why: "navapi-same-site-entry" };
        return { back: false, why: "navapi-previous-entry-not-x" };
      }
    } catch {
    }
    if (navTrailIdx > 0) return { back: true, why: "trail-visited-entry" };
    return { back: false, why: navTrail.length === 0 ? "trail-empty" : "trail-initial-entry" };
  }
  function navTrailState() {
    return { trail: [...navTrail], idx: navTrailIdx };
  }
  function markPendingTraverse() {
    pendingTraverse = true;
  }
  function consumePendingTraverse() {
    const v = pendingTraverse;
    pendingTraverse = false;
    return v;
  }

  // native-extension/src/focal-extractor.js
  function parseCount(text) {
    const m = String(text ?? "").trim().match(/^([\d.,]+)\s*([KMkM])?$/);
    if (!m) return null;
    const base = parseFloat(m[1].replace(/,/g, ""));
    if (!Number.isFinite(base)) return null;
    return Math.round(base * (m[2] === "K" || m[2] === "k" ? 1e3 : m[2] === "M" ? 1e6 : 1));
  }
  function countOf(root, name) {
    const active2 = Boolean(root.querySelector(`[data-testid="un${name}"]`));
    const node = root.querySelector(`[data-testid="${name}"], [data-testid="un${name}"]`);
    const aria = node?.getAttribute("aria-label") || "";
    const fromAria = aria ? parseCount(aria.match(/^([\d.,]+\s*[KMkM]?)/)?.[1] ?? "") : null;
    const value = parseCount(node?.innerText) ?? fromAria;
    return { value, active: active2, known: Boolean(node) };
  }
  function focalCellByStatusId(focalId) {
    return [...document.querySelectorAll('[data-testid="cellInnerDiv"]')].find((cell) => [...cell.querySelectorAll(`a[href*="/status/${focalId}"]`)].some((a) => a.querySelector("time") && !a.closest('div[role="link"]')));
  }
  function photoUrlsIn(scope, ...excludes) {
    const urls = [];
    for (const img of scope.querySelectorAll('[data-testid="tweetPhoto"] img, img[src*="pbs.twimg.com/media"]')) {
      if (excludes.some((ex) => ex && ex.contains(img))) continue;
      if (!img.src) continue;
      urls.push(img.src);
    }
    return [...new Set(urls)];
  }
  function findQuoteNode(art) {
    const isCard = (n) => n.getAttribute("data-testid") === "card.wrapper" || Boolean(n.querySelector('[data-testid="card.wrapper"]'));
    const candidates = [...art.querySelectorAll('div[role="link"]')].filter((n) => !isCard(n));
    return candidates.find((n) => n.querySelector('[data-testid="tweetText"], [data-testid="User-Name"]')) || candidates[candidates.length - 1] || null;
  }
  function extractArticle(art) {
    const title = art.querySelector('[data-testid="twitter-article-title"]')?.innerText?.trim() || null;
    const body = art.querySelector('[data-testid="twitterArticleRichTextView"]');
    if (!body) return null;
    return { title, text: body.innerText || "", photos: photoUrlsIn(body) };
  }
  function fallbackText(art) {
    const UI_LINE = /^(show translation|显示翻译|translate post|show more|显示更多)$/i;
    const SKIP_SEL = '[role="group"], [data-testid="like"], [data-testid="retweet"], [data-testid="reply"], [data-testid="bookmark"], time, div[role="link"], [data-testid="card.wrapper"], [data-testid="videoPlayer"]';
    const blocks = [];
    const collect = (node) => {
      if (node.matches?.(SKIP_SEL)) return;
      if (!node.querySelector(SKIP_SEL)) {
        const text = String(node.innerText || "").trim();
        if (text) blocks.push(text);
        return;
      }
      for (const child of node.children) collect(child);
    };
    collect(art);
    const lines = blocks.join("\n").split("\n").map((l) => l.trim()).filter(Boolean).filter((l) => !UI_LINE.test(l));
    const handleIdx = lines.slice(0, 3).findIndex((l) => l.startsWith("@") && l.length <= 20);
    if (handleIdx >= 0) lines.splice(0, handleIdx + 1);
    return lines.join("\n");
  }
  function findShowMore(art) {
    const quote = findQuoteNode(art);
    return [...art.querySelectorAll('[data-testid="tweet-text-show-more-link"], a[href*="show-more"], [role="button"]')].filter((el) => !(quote && quote.contains(el))).find((el) => /^(显示更多|Show more)$/i.test((el.innerText || "").trim())) || null;
  }
  async function expandShowMore(art) {
    const more = findShowMore(art);
    if (more) {
      more.click();
      await sleep(700);
    }
  }
  async function extractFocal(focalId, isCurrent, { expand = true } = {}) {
    if (statusIdFromPath() !== focalId) return null;
    const cell = focalCellByStatusId(focalId);
    const art = cell && (cell.querySelector("article[data-testid='tweet']") || cell.querySelector("article"));
    if (!art) return null;
    if (expand) {
      await expandShowMore(art);
      if (!isCurrent() || statusIdFromPath() !== focalId) return null;
      if (!cell.isConnected || !art.isConnected) return null;
    }
    return { ...extractFromArticle(art, focalId), nativeCell: cell };
  }
  function extractFromArticle(art, focalId) {
    const handle = [...art.querySelectorAll('a[href^="/"]')].map((a) => a.getAttribute("href")).find((h) => /^\/[^/]+$/.test(h));
    const nameNode = art.querySelector('[data-testid="User-Name"]');
    const video = Boolean(art.querySelector('[data-testid="videoPlayer"]')) || Boolean(art.querySelector("video"));
    const poll = Boolean(art.querySelector('[data-testid="poll"], [role="group"] [data-testid="vote"]'));
    const cardNode = art.querySelector('[data-testid="card.wrapper"]');
    const quoteNode = findQuoteNode(art);
    const quoteAuthorNode = quoteNode?.querySelector('[data-testid="User-Name"]');
    const quoteAuthor = quoteAuthorNode?.innerText.split("\n")[0] || null;
    let quoteText = quoteNode?.querySelector('[data-testid="tweetText"]')?.innerText || "";
    if (quoteAuthor && quoteText.trim().startsWith(quoteAuthor.trim())) {
      quoteText = quoteText.trim().slice(quoteAuthor.trim().length).replace(/^\s+/, "");
    }
    const article = extractArticle(art);
    let text, textSource;
    if (article) {
      text = article.title ? `${article.title}

${article.text}` : article.text;
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
    const photos = photoUrlsIn(art, quoteNode, cardNode);
    return {
      statusId: focalId,
      name: nameNode ? nameNode.innerText.split("\n")[0] : handle ? handle.slice(1) : "\u672A\u77E5\u4F5C\u8005",
      handle: handle || "",
      avatar: art.querySelector('img[src*="profile_images"]')?.src || "",
      time: art.querySelector("time")?.getAttribute("datetime") || "",
      timeText: art.querySelector("time")?.innerText || "",
      text,
      textKnown: text.trim().length > 0,
      // absent text node = unknown, not empty
      textSource,
      photos,
      showMorePending: Boolean(findShowMore(art)),
      // collapsed body: first paint shows it, upgrade follows
      quote: quoteNode ? {
        author: quoteAuthor,
        text: quoteText,
        photos: photoUrlsIn(quoteNode)
      } : null,
      rich: { video, poll, card: Boolean(cardNode), article: Boolean(article) },
      reply: countOf(art, "reply"),
      retweet: countOf(art, "retweet"),
      like: countOf(art, "like"),
      bookmark: countOf(art, "bookmark")
    };
  }

  // native-extension/src/reader-view.js
  var richScanUntil = 0;
  function setRichScanWindow(fromNowMs) {
    richScanUntil = performance.now() + fromNowMs;
  }
  var richScanActive = () => performance.now() <= richScanUntil;
  function richNoteText(labels) {
    return `\u6B64\u5E16\u542B${labels.join("\u3001")}\u2014\u2014\u53F3\u4FA7\u680F\u9876\u90E8\u539F\u751F\u683C\u5B8C\u6574\u627F\u8F7D\u5A92\u4F53\u4E0E\u4E92\u52A8\uFF0C\u53EF\u6EDA\u52A8\u5230\u8BE5\u5904\u76F4\u63A5\u64CD\u4F5C\u3002`;
  }
  function fmtCount(c) {
    if (!c.known) return "\u672A\u77E5";
    if (c.value === null) return "\u672A\u77E5";
    return c.value.toLocaleString("en-US");
  }
  function quoteHtml(q) {
    return `<div class="${NS}-quote-author">${ESCAPED(q.author ?? "\u672A\u77E5\u4F5C\u8005")}</div>
        <div>${ESCAPED(q.text || "\uFF08\u5F15\u7528\u6B63\u6587\u672A\u8BC6\u522B\uFF09")}</div>
        ${q.photos.map((u) => `<img class="${NS}-photo" src="${ESCAPED(u)}" referrerpolicy="no-referrer" alt="">`).join("")}`;
  }
  function richLabelsOf(rich) {
    return [
      rich.video && "\u89C6\u9891/GIF",
      rich.poll && "\u6295\u7968",
      rich.card && "\u7F51\u7AD9\u5361\u7247",
      rich.article && "X Article"
    ].filter(Boolean);
  }
  function updatePaneInPlace(pane, data) {
    const textEl = pane.querySelector(`.${NS}-text`);
    if (textEl && data.textKnown && textEl.dataset.peekFullText !== "1") {
      textEl.textContent = data.text;
      textEl.classList.remove(`${NS}-unknown`);
    }
    const photosEl = pane.querySelector(`.${NS}-photos`);
    if (photosEl) photosEl.innerHTML = data.photos.map((u) => `<img class="${NS}-photo" src="${ESCAPED(u)}" referrerpolicy="no-referrer" alt="">`).join("");
    const countsEl = pane.querySelector(`.${NS}-counts`);
    if (countsEl) countsEl.textContent = `\u56DE\u590D ${fmtCount(data.reply)} \xB7 \u8F6C\u63A8 ${fmtCount(data.retweet)} \xB7 \u559C\u6B22 ${fmtCount(data.like)} \xB7 \u4E66\u7B7E ${fmtCount(data.bookmark)}${data.timeText ? ` \xB7 ${ESCAPED(data.timeText)}` : ""}`;
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
  function syncRichNote(activeStatusId2) {
    const pane = document.getElementById(PANE_ID);
    if (!pane || pane.querySelector(`.${NS}-rich-note`)) return;
    if (!richScanActive()) return;
    const cell = focalCellByStatusId(activeStatusId2);
    if (!cell) return;
    const video = Boolean(cell.querySelector('[data-testid="videoPlayer"], video'));
    const poll = Boolean(cell.querySelector('[data-testid="poll"], [role="group"] [data-testid="vote"]'));
    const card = Boolean(cell.querySelector('[data-testid="card.wrapper"]'));
    if (!video && !poll && !card) return;
    appendRichNote(pane, [video && "\u89C6\u9891/GIF", poll && "\u6295\u7968", card && "\u7F51\u7AD9\u5361\u7247"].filter(Boolean));
  }
  function renderPane(data, { brandIconUrl, onAction: onAction2, onClose, actionNote }) {
    const pane = document.createElement("div");
    pane.id = PANE_ID;
    pane.dataset.statusId = data.statusId;
    const q = data.quote;
    const handleAt = data.handle ? "@" + data.handle.replace(/^\//, "") : "";
    const richLabels = richLabelsOf(data.rich);
    const brandImg = brandIconUrl ? `<img class="${NS}-brand-icon" src="${ESCAPED(brandIconUrl)}" alt="">` : "";
    pane.innerHTML = `
      <header class="${NS}-bar">
        <button class="${NS}-close" title="\u5173\u95ED" aria-label="\u5173\u95ED\u9605\u8BFB\u89C6\u56FE">\u2715</button>
        ${brandImg}<span class="${NS}-brand">Peek</span>
        <a class="${NS}-open" target="_blank" rel="noopener" href="https://x.com${ESCAPED(location.pathname)}">\u5728 X \u6253\u5F00</a>
      </header>
      <div class="${NS}-body">
        <div class="${NS}-author">
          <img src="${ESCAPED(data.avatar)}" referrerpolicy="no-referrer" alt="">
          <div><b>${ESCAPED(data.name)}</b><span>${ESCAPED(handleAt)}</span></div>
        </div>
        ${data.textKnown ? `<div class="${NS}-text">${ESCAPED(data.text)}</div>` : `<div class="${NS}-text ${NS}-unknown">\u6B63\u6587\u672A\u8BC6\u522B</div>`}
        <div class="${NS}-photos">${data.photos.map((u) => `<img class="${NS}-photo" src="${ESCAPED(u)}" referrerpolicy="no-referrer" alt="">`).join("")}</div>
        ${q ? `<div class="${NS}-quote">${quoteHtml(q)}</div>` : ""}
        ${richLabels.length ? `<div class="${NS}-rich-note">${richNoteText(richLabels)}</div>` : ""}
        <div class="${NS}-counts">\u56DE\u590D ${fmtCount(data.reply)} \xB7 \u8F6C\u63A8 ${fmtCount(data.retweet)} \xB7 \u559C\u6B22 ${fmtCount(data.like)} \xB7 \u4E66\u7B7E ${fmtCount(data.bookmark)}${data.timeText ? ` \xB7 ${ESCAPED(data.timeText)}` : ""}</div>
        <div class="${NS}-actions" role="toolbar" aria-label="\u5B9A\u4F4D\u53F3\u680F\u539F\u751F\u4E92\u52A8\u63A7\u4EF6\uFF08\u4E0D\u4F1A\u4EE3\u66FF\u4F60\u6267\u884C\uFF09">
          <button class="${NS}-act" data-act="reply" title="\u6EDA\u52A8\u5230\u53F3\u680F\u539F\u751F\u56DE\u590D\u6846\uFF0C\u7531\u4F60\u4EB2\u81EA\u8F93\u5165\u53D1\u9001">\u5B9A\u4F4D\u56DE\u590D</button>
          <button class="${NS}-act" data-act="retweet" title="\u5B9A\u4F4D\u53F3\u680F\u539F\u751F\u8F6C\u63A8\u63A7\u4EF6\uFF0C\u7531\u4F60\u4EB2\u81EA\u70B9\u51FB">\u5B9A\u4F4D\u8F6C\u63A8</button>
          <button class="${NS}-act" data-act="like" title="\u5B9A\u4F4D\u53F3\u680F\u539F\u751F\u70B9\u8D5E\u63A7\u4EF6\uFF0C\u7531\u4F60\u4EB2\u81EA\u70B9\u51FB">\u5B9A\u4F4D\u70B9\u8D5E</button>
          <button class="${NS}-act" data-act="bookmark" title="\u5B9A\u4F4D\u53F3\u680F\u539F\u751F\u6536\u85CF\u63A7\u4EF6\uFF0C\u7531\u4F60\u4EB2\u81EA\u70B9\u51FB">\u5B9A\u4F4D\u6536\u85CF</button>
          <button class="${NS}-act" data-act="share" title="\u590D\u5236\u672C\u5E16\u94FE\u63A5">\u590D\u5236\u94FE\u63A5</button>
        </div>
        <div class="${NS}-note">${actionNote}</div>
      </div>`;
    pane.querySelector(`.${NS}-close`).addEventListener("click", onClose);
    pane.querySelector(`.${NS}-actions`).addEventListener("click", onAction2);
    document.body.appendChild(pane);
    return pane;
  }
  function mountStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      /* one reference container: both panes use vw while reading.
         The native focal cell stays visible: it renders as the first cell of
         the right column with its full native action bar, media and composer. */
      html[data-${NS}] [data-testid="sidebarColumn"] { display: none !important; }
      html[data-${NS}] header[role="banner"]:not(#${PANE_ID} header) { display: none !important; }
      html[data-${NS}] [data-testid="primaryColumn"] { width: 100vw !important; max-width: 100vw !important; }
      html[data-${NS}] [data-testid="cellInnerDiv"] { margin-left: 52vw !important; width: 48vw !important; }
    `;
    document.head.appendChild(style);
    document.documentElement.setAttribute(`data-${NS}`, "on");
  }
  function removePaneAndStyle() {
    document.getElementById(PANE_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
    document.documentElement.removeAttribute(`data-${NS}`);
  }
  function paneMounted() {
    return Boolean(document.getElementById(PANE_ID));
  }
  function mountedPane() {
    return document.getElementById(PANE_ID);
  }

  // native-extension/src/theme-adapter.js
  var themeObserver = null;
  function readTheme() {
    const bg = getComputedStyle(document.body).backgroundColor;
    const m = bg.match(/(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/);
    if (m) {
      const [r, g, b] = [+m[1], +m[2], +m[3]];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128 ? "dark" : "light";
    }
    if (getComputedStyle(document.documentElement).colorScheme === "light") return "light";
    return "dark";
  }
  function applyTheme() {
    const pane = document.getElementById(PANE_ID);
    if (!pane) return;
    const theme = readTheme();
    const palette = theme === "dark" ? { bg: "#000000", fg: "#e7e9ea", dim: "#71767b", border: "#2f3336", hover: "#181818", accent: "#1d9bf0" } : { bg: "#ffffff", fg: "#0f1419", dim: "#536471", border: "#eff3f4", hover: "#f7f9f9", accent: "#1d9bf0" };
    for (const [k, v] of Object.entries(palette)) pane.style.setProperty(`--peek-${k}`, v);
  }
  function watchTheme() {
    unwatchTheme();
    themeObserver = new MutationObserver(() => applyTheme());
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    if (document.body) themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
    applyTheme();
  }
  function unwatchTheme() {
    themeObserver?.disconnect();
    themeObserver = null;
  }

  // native-extension/src/diagnostics.js
  var state = {
    routeChanges: [],
    // performance.now() of each OBSERVED route change (bounded)
    lastRouteChangeAt: -1,
    // -1 = none observed yet
    firstPaintAt: null,
    // pane mounted (fast first paint)
    buildMs: null,
    // route observed → pane mounted for the current read
    hydrationRefreshAt: null,
    anchor: null
    // last anchor-restore record (B3)
  };
  function recordRouteChange(at) {
    state.lastRouteChangeAt = at;
    state.routeChanges.push(at);
    if (state.routeChanges.length > 64) state.routeChanges.shift();
    state.firstPaintAt = null;
    state.buildMs = null;
    state.hydrationRefreshAt = null;
  }
  function recordFirstPaint(at, buildMs) {
    state.firstPaintAt = at;
    state.buildMs = buildMs;
  }
  function recordHydrationRefresh(at) {
    state.hydrationRefreshAt = at;
  }
  function recordAnchorRestore(record) {
    state.anchor = record;
  }
  var lastRouteChangeAt = () => state.lastRouteChangeAt;
  function snapshot() {
    return {
      routeChanges: [...state.routeChanges],
      lastRouteChangeAt: state.lastRouteChangeAt,
      firstPaintAt: state.firstPaintAt,
      buildMs: state.buildMs,
      hydrationRefreshAt: state.hydrationRefreshAt,
      anchor: state.anchor ? { ...state.anchor } : null
    };
  }

  // native-extension/src/anchor-restore.js
  var RESTORE_WINDOW_MS = 2500;
  var RESTORE_POLL_MS = 150;
  var SETTLE_CHECKS = 2;
  var ADJUST_THRESHOLD_PX = 40;
  var preOpen = null;
  var active = false;
  var timers = [];
  var stopActivity = null;
  function preOpenAnchor() {
    return preOpen ? { ...preOpen } : null;
  }
  var restoreActive = () => active;
  function computeAnchorAdjustment({ preTop, cellTop, threshold = ADJUST_THRESHOLD_PX }) {
    const delta = cellTop - preTop;
    return Math.abs(delta) > threshold ? delta : null;
  }
  function mirrorAnchor() {
    try {
      if (!window.__PEEK_NATIVE_TEST__) return;
      document.documentElement.setAttribute("data-peek-anchor", JSON.stringify({
        preOpen,
        active
      }));
    } catch {
    }
  }
  function capturePreOpen(statusId, source = "route-check") {
    if (!statusId) return null;
    cancelRestore("superseded-open");
    if (statusIdFromPath()) return preOpen ? { ...preOpen } : null;
    try {
      const cell = focalCellByStatusId(statusId);
      if (cell) {
        preOpen = { statusId, top: cell.getBoundingClientRect().top, source };
        mirrorAnchor();
        return preOpen;
      }
    } catch {
    }
    if (preOpen?.statusId !== statusId) preOpen = null;
    mirrorAnchor();
    return preOpen;
  }
  function finish(reason) {
    active = false;
    if (stopActivity) {
      stopActivity();
      stopActivity = null;
    }
    for (const t of timers) clearTimeout(t);
    timers = [];
    mirrorAnchor();
    return reason;
  }
  function cancelRestore(reason = "cancelled") {
    if (active) finish(reason);
    return !active;
  }
  function onReturnToList(fromStatusId) {
    if (active || !preOpen || preOpen.statusId !== fromStatusId) return false;
    const anchor = { ...preOpen };
    active = true;
    mirrorAnchor();
    stopActivity = watchUserInput(() => endRestore("user-input", anchor));
    const deadline = Date.now() + RESTORE_WINDOW_MS;
    let lastScrollY = null;
    let stable = 0;
    const step = () => {
      if (!active) return;
      if (Date.now() > deadline) {
        endRestore("window-expired", anchor);
        return;
      }
      const cell = focalCellByStatusId(fromStatusId);
      if (!cell) {
        timers.push(setTimeout(step, RESTORE_POLL_MS));
        return;
      }
      const y = window.scrollY;
      stable = y === lastScrollY ? stable + 1 : 0;
      lastScrollY = y;
      if (stable < SETTLE_CHECKS) {
        timers.push(setTimeout(step, RESTORE_POLL_MS));
        return;
      }
      const top = cell.getBoundingClientRect().top;
      const delta = computeAnchorAdjustment({ preTop: anchor.top, cellTop: top });
      recordAnchorRestore({
        statusId: fromStatusId,
        preTop: anchor.top,
        cellTop: top,
        delta,
        applied: delta !== null
      });
      if (delta !== null) {
        try {
          window.scrollBy(0, delta);
        } catch {
        }
      }
      endRestore(delta === null ? "within-threshold" : "adjusted", anchor);
    };
    timers.push(setTimeout(step, RESTORE_POLL_MS));
    return true;
  }
  function endRestore(reason, anchor) {
    finish(reason);
    if (preOpen && anchor && preOpen.statusId === anchor.statusId && preOpen.top === anchor.top && preOpen.source === anchor.source) {
      preOpen = null;
    }
    mirrorAnchor();
  }
  function watchUserInput(onUserInput) {
    const opts = { capture: true, passive: true, once: false };
    const handler = () => {
      onUserInput();
    };
    window.addEventListener("wheel", handler, opts);
    window.addEventListener("touchmove", handler, opts);
    window.addEventListener("keydown", handler, opts);
    window.addEventListener("pointerdown", handler, opts);
    return () => {
      window.removeEventListener("wheel", handler, opts);
      window.removeEventListener("touchmove", handler, opts);
      window.removeEventListener("keydown", handler, opts);
      window.removeEventListener("pointerdown", handler, opts);
    };
  }

  // native-extension/src/native-interaction.js
  var ownedTimers = /* @__PURE__ */ new Set();
  function ownedTimeout(fn, ms) {
    const h = setTimeout(() => {
      ownedTimers.delete(h);
      fn();
    }, ms);
    ownedTimers.add(h);
    return h;
  }
  function clearOwnedTimeouts() {
    for (const h of ownedTimers) clearTimeout(h);
    ownedTimers.clear();
  }
  function pulse(native) {
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
  var FEEDBACK = {
    reply: "\u5DF2\u6EDA\u52A8\u5230\u53F3\u680F\u5E76\u805A\u7126\u539F\u751F\u56DE\u590D\u6846\u2014\u2014\u8BF7\u4EB2\u81EA\u8F93\u5165\u5E76\u53D1\u9001\u3002",
    retweet: "\u5DF2\u5728\u53F3\u680F\u5B9A\u4F4D\u539F\u751F\u8F6C\u63A8\u63A7\u4EF6\u5E76\u9AD8\u4EAE\u2014\u2014\u662F\u5426\u8F6C\u63A8\u7531\u4F60\u4EB2\u81EA\u70B9\u51FB\u51B3\u5B9A\u3002",
    like: "\u5DF2\u5728\u53F3\u680F\u5B9A\u4F4D\u539F\u751F\u70B9\u8D5E\u63A7\u4EF6\u5E76\u9AD8\u4EAE\u2014\u2014\u662F\u5426\u70B9\u8D5E\u7531\u4F60\u4EB2\u81EA\u70B9\u51FB\u51B3\u5B9A\u3002",
    bookmark: "\u5DF2\u5728\u53F3\u680F\u5B9A\u4F4D\u539F\u751F\u6536\u85CF\u63A7\u4EF6\u5E76\u9AD8\u4EAE\u2014\u2014\u662F\u5426\u6536\u85CF\u7531\u4F60\u4EB2\u81EA\u70B9\u51FB\u51B3\u5B9A\u3002",
    share: "\u94FE\u63A5\u5DF2\u590D\u5236\u5230\u526A\u8D34\u677F\u3002"
  };
  function showFeedback(text) {
    const note = document.querySelector(`#${PANE_ID} .${NS}-note`);
    if (!note) return;
    if (note.dataset.staticText === void 0) note.dataset.staticText = note.textContent;
    note.textContent = text;
    ownedTimeout(() => {
      if (note.isConnected && note.dataset.staticText !== void 0) {
        note.textContent = note.dataset.staticText;
        delete note.dataset.staticText;
      }
    }, 2400);
  }
  function onAction(event) {
    const btn = event.target.closest(`.${NS}-act`);
    if (!btn) return null;
    const act = btn.dataset.act;
    if (act === "share") {
      navigator.clipboard?.writeText(`https://x.com${location.pathname}`).catch(() => {
      });
      showFeedback(FEEDBACK.share);
      return { act, located: false };
    }
    const cell = focalCellByStatusId(statusIdFromPath());
    if (!cell) {
      showFeedback("\u672A\u80FD\u5728\u53F3\u680F\u627E\u5230\u8BE5\u5E16\u7684\u539F\u751F\u63A7\u4EF6\u2014\u2014\u53EF\u624B\u52A8\u6EDA\u52A8\u53F3\u680F\u64CD\u4F5C\u3002");
      return { act, located: false };
    }
    if (act === "reply") {
      cell.scrollIntoView({ block: "start", behavior: "smooth" });
      ownedTimeout(() => {
        if (!cell.isConnected) return;
        cell.querySelector('[data-testid="tweetTextarea_0"], [data-testid="tweetButtonInline"]')?.focus?.();
      }, 450);
      showFeedback(FEEDBACK.reply);
      return { act, located: true };
    }
    const name = act === "like" ? "like" : act === "retweet" ? "retweet" : "bookmark";
    const located = pulse(cell.querySelector(`[data-testid="${name}"], [data-testid="un${name}"]`));
    showFeedback(located ? FEEDBACK[act] ?? "\u5DF2\u5728\u53F3\u680F\u5B9A\u4F4D\u539F\u751F\u63A7\u4EF6\uFF0C\u8BF7\u4EB2\u81EA\u64CD\u4F5C\u3002" : "\u672A\u80FD\u5728\u53F3\u680F\u627E\u5230\u8BE5\u5E16\u7684\u539F\u751F\u63A7\u4EF6\u2014\u2014\u53EF\u624B\u52A8\u6EDA\u52A8\u53F3\u680F\u64CD\u4F5C\u3002");
    return { act, located };
  }

  // native-extension/src/layout-adapter/constants.js
  var LAD_NS = "peek-lad";
  var LAD_FROM_ISOLATED = "isolated";
  var LAD_FROM_MAIN = "main";
  var LAD_INSTALL = "INSTALL";
  var LAD_UNINSTALL = "UNINSTALL";
  var LAD_ACTIVE = "ACTIVE";
  var LAD_UNSUPPORTED = "UNSUPPORTED";
  var LAD_ERROR = "ERROR";
  var LAD_UNINSTALLED = "UNINSTALLED";
  var LAD_HEALTH_ERROR = "HEALTH_ERROR";
  var LAD_HEALTH_UNINSTALLED = "HEALTH_UNINSTALLED";
  var LAD_HEALTH_ACTIVE = "HEALTH_ACTIVE";
  var LAD_MARK_ARTICLE = "data-peek-lad-focal";
  var LAD_INSTALL_ACK_MS = 1200;
  var LAD_INSTALL_RETRY_MS = 250;
  var LAD_INSTALL_MAX_ATTEMPTS = 12;

  // native-extension/src/layout-adapter/controller.js
  var adapterEnabled = () => true;
  var STYLE_ID2 = "peek-lad-style";
  var HTML_ATTR = "data-peek-lad";
  var STATE_ATTR = "data-peek-lad-state";
  var FAILED_ATTR = "data-peek-lad-failed";
  var LAYOUT_CSS = `
@media (min-width: 980px) {
  html[${HTML_ATTR}="on"] [data-testid="sidebarColumn"] { display: none !important; }
  /* X's banner element IS the left nav rail on current builds \u2014 hiding it is
     what keeps the fixed focal pane clean (z-order beats the pane otherwise) */
  html[${HTML_ATTR}="on"] header[role="banner"] { display: none !important; }
  html[${HTML_ATTR}="on"] [data-testid="primaryColumn"] { width: 100vw !important; max-width: 100vw !important; }
  html[${HTML_ATTR}="on"] [data-testid="cellInnerDiv"] { margin-left: 52vw !important; width: 48vw !important; }
  html[${HTML_ATTR}="on"] [data-testid="cellInnerDiv"]:has(article[data-peek-lad-focal]) { transform: none !important; }
  html[${HTML_ATTR}="on"] article[data-peek-lad-focal] {
    position: fixed !important;
    left: 0 !important;
    top: var(--peek-lad-top, 54px) !important;
    bottom: 0 !important;
    width: 52vw !important;
    box-sizing: border-box !important;
    overflow-y: auto !important;
    overscroll-behavior: contain !important;
    z-index: 59 !important;
    background: var(--peek-lad-bg, #ffffff) !important;
    border-right: 1px solid var(--peek-lad-border, #eff3f4) !important;
  }
}`;
  var initialized = false;
  var session = null;
  var nonceSeq = 0;
  var themeObserver2 = null;
  var THEME_VARS = ["--peek-lad-bg", "--peek-lad-border", "--peek-lad-top"];
  var savedInlineVars = null;
  var themeSelfWrite = false;
  var themeStats = { callbacks: 0, writes: 0, skippedWrites: 0, selfEchoDrops: 0 };
  function initLayoutAdapter() {
    if (!adapterEnabled() || initialized) return;
    initialized = true;
    window.addEventListener("message", onWindowMessage);
    setStateAttr("idle");
  }
  var pageOrigin = () => {
    try {
      return window.location.origin;
    } catch {
      return "";
    }
  };
  function sendToMain(payload) {
    try {
      window.postMessage({ ns: LAD_NS, from: LAD_FROM_ISOLATED, ...payload }, pageOrigin());
    } catch {
    }
  }
  function onWindowMessage(event) {
    if (event.source !== window) return;
    if (event.origin !== pageOrigin()) return;
    const m = event.data;
    if (!m || typeof m !== "object" || m.ns !== LAD_NS || m.from !== LAD_FROM_MAIN) return;
    handleMainMessage(m);
  }
  function onDetailRoute(focalId) {
    if (!adapterEnabled() || !focalId) return;
    if (session && session.focusUrlId === focalId && (session.phase === "active" || session.phase === "installing")) {
      return;
    }
    teardownSession("superseded");
    session = {
      focusUrlId: focalId,
      phase: "installing",
      attempts: 0,
      everActive: false,
      nonce: null,
      gen: null,
      ackTimer: 0,
      retryTimer: 0,
      failReason: null
    };
    setStateAttr("installing");
    attemptInstall();
  }
  function offRoute() {
    if (!adapterEnabled() || !session) return;
    teardownSession("route-left");
    setStateAttr("idle");
  }
  function attemptInstall() {
    const s = session;
    if (!s || s.phase !== "installing") return;
    s.attempts++;
    const nonce = ++nonceSeq;
    s.nonce = nonce;
    sendToMain({ type: LAD_INSTALL, focusUrlId: s.focusUrlId, nonce });
    clearTimeout(s.ackTimer);
    s.ackTimer = setTimeout(() => onAckTimeout(s, nonce), LAD_INSTALL_ACK_MS);
  }
  function onAckTimeout(s, nonce) {
    if (session !== s || s.nonce !== nonce || s.phase !== "installing") return;
    failSession(s, "main-unresponsive");
  }
  var RESPONSE_TYPES = /* @__PURE__ */ new Set([LAD_ACTIVE, LAD_UNSUPPORTED, LAD_ERROR, LAD_UNINSTALLED]);
  var AUTONOMOUS_TYPES = /* @__PURE__ */ new Set([LAD_HEALTH_ERROR, LAD_HEALTH_UNINSTALLED, LAD_HEALTH_ACTIVE]);
  function handleMainMessage(m) {
    if (AUTONOMOUS_TYPES.has(m.type)) {
      handleAutonomous(m);
      return;
    }
    if (!RESPONSE_TYPES.has(m.type)) return;
    handleResponse(m);
  }
  function handleResponse(m) {
    const s = session;
    if (!s || m.nonce !== s.nonce) return;
    if (m.type === LAD_ACTIVE) {
      if (s.phase !== "installing") {
        sendToMain({ type: LAD_UNINSTALL, nonce: ++nonceSeq, reason: "late-active-after-fail", focusUrlId: s.focusUrlId });
        return;
      }
      clearTimeout(s.ackTimer);
      s.gen = typeof m.gen === "number" ? m.gen : null;
      if (!focalMarkerVerified(s.focusUrlId)) {
        sendToMain({ type: LAD_UNINSTALL, nonce: ++nonceSeq, reason: "active-without-focal-marker", focusUrlId: s.focusUrlId });
        failSession(s, "active-without-focal-marker");
        return;
      }
      s.phase = "active";
      s.everActive = true;
      setStateAttr("active");
      mountLayout();
      return;
    }
    if (m.type === LAD_UNSUPPORTED) {
      if (s.phase !== "installing") return;
      clearTimeout(s.ackTimer);
      if (s.attempts < LAD_INSTALL_MAX_ATTEMPTS) {
        clearTimeout(s.retryTimer);
        s.retryTimer = setTimeout(attemptInstall, LAD_INSTALL_RETRY_MS);
      } else {
        failSession(s, m.reason || "unsupported");
      }
      return;
    }
    if (m.type === LAD_ERROR) {
      if (session !== s) return;
      failSession(s, m.reason || "main-error");
      return;
    }
  }
  function handleAutonomous(m) {
    const s = session;
    const ours = s && m.focusUrlId === s.focusUrlId && typeof m.gen === "number" && m.gen === s.gen;
    const continuation = !ours && s && s.phase === "active" && s.everActive && m.type === LAD_HEALTH_ACTIVE && m.focusUrlId === s.focusUrlId && typeof m.gen === "number" && m.gen > s.gen;
    if (continuation) {
      s.gen = m.gen;
    }
    if (!ours && !continuation) {
      if ((!s || s.phase !== "active") && typeof m.focusUrlId === "string" && m.focusUrlId) {
        sendToMain({ type: LAD_UNINSTALL, nonce: ++nonceSeq, reason: "stale-health-event", focusUrlId: m.focusUrlId });
      }
      return;
    }
    switch (m.type) {
      case LAD_HEALTH_ERROR:
        if (s.phase === "active") failSession(s, m.reason || "main-health-error");
        else if (s.phase === "installing") failSession(s, m.reason || "main-health-error");
        break;
      case LAD_HEALTH_UNINSTALLED:
        if (s.phase === "active" || s.phase === "installing") dormantSession(s, m.reason || "main-self-uninstalled");
        break;
      case LAD_HEALTH_ACTIVE:
        if (s.phase === "active") setStateAttr("active");
        break;
      default:
        break;
    }
  }
  function failSession(s, reason) {
    if (session !== s) return;
    clearTimeout(s.ackTimer);
    clearTimeout(s.retryTimer);
    s.phase = "failed";
    s.failReason = reason;
    session = s;
    removeLayout();
    setStateAttr("failed");
    try {
      document.documentElement.setAttribute(FAILED_ATTR, reason);
    } catch {
    }
    console.warn(`[Peek M2-B1] \u5E03\u5C40\u9002\u914D\u4E0D\u53EF\u7528\uFF0C\u5DF2\u56DE\u9000 X \u539F\u751F\u5355\u680F\u8BE6\u60C5\u9875\uFF08\u539F\u56E0: ${reason}\uFF09\u3002\u5237\u65B0\u9875\u9762\u53EF\u91CD\u7F6E\u5B9E\u9A8C\u72B6\u6001\u3002`);
  }
  function dormantSession(s, reason) {
    if (session !== s) return;
    clearTimeout(s.ackTimer);
    clearTimeout(s.retryTimer);
    s.phase = "dormant";
    session = s;
    removeLayout();
    setStateAttr("idle");
  }
  function teardownSession(reason) {
    const s = session;
    if (!s) return;
    session = null;
    clearTimeout(s.ackTimer);
    clearTimeout(s.retryTimer);
    removeLayout();
    sendToMain({ type: LAD_UNINSTALL, nonce: ++nonceSeq, reason, focusUrlId: s.focusUrlId });
  }
  function focalMarkerVerified(focusUrlId) {
    try {
      const cell = focalCellByStatusId(focusUrlId);
      return Boolean(cell?.isConnected && cell.querySelector(`article[${LAD_MARK_ARTICLE}]`));
    } catch {
      return false;
    }
  }
  function mountLayout() {
    removeLayout();
    const style = document.createElement("style");
    style.id = STYLE_ID2;
    style.textContent = LAYOUT_CSS;
    document.head.appendChild(style);
    document.documentElement.setAttribute(HTML_ATTR, "on");
    applyAdapterTheme();
    watchTheme2();
  }
  function removeLayout() {
    document.getElementById(STYLE_ID2)?.remove();
    document.documentElement.removeAttribute(HTML_ATTR);
    unwatchTheme2();
    restoreInlineVars();
  }
  function captureInlineVars() {
    if (savedInlineVars) return;
    savedInlineVars = /* @__PURE__ */ new Map();
    const root = document.documentElement;
    for (const name of THEME_VARS) {
      try {
        savedInlineVars.set(name, {
          value: root.style.getPropertyValue(name),
          priority: root.style.getPropertyPriority(name)
        });
      } catch {
        savedInlineVars.set(name, { value: "", priority: "" });
      }
    }
  }
  function restoreInlineVars() {
    if (!savedInlineVars) return;
    const root = document.documentElement;
    for (const [name, saved] of savedInlineVars) {
      try {
        if (saved.value) root.style.setProperty(name, saved.value, saved.priority);
        else root.style.removeProperty(name);
      } catch {
      }
    }
    savedInlineVars = null;
  }
  function writeRootVar(root, name, value) {
    try {
      if (root.style.getPropertyValue(name) === value) {
        themeStats.skippedWrites++;
        return;
      }
      themeSelfWrite = true;
      themeStats.writes++;
      root.style.setProperty(name, value);
    } catch {
    }
  }
  function applyAdapterTheme() {
    const theme = readTheme();
    const root = document.documentElement;
    captureInlineVars();
    if (theme === "dark") {
      writeRootVar(root, "--peek-lad-bg", "#000000");
      writeRootVar(root, "--peek-lad-border", "#2f3336");
    } else {
      writeRootVar(root, "--peek-lad-bg", "#ffffff");
      writeRootVar(root, "--peek-lad-border", "#eff3f4");
    }
    let top = 54;
    try {
      const h = document.querySelector('header[role="banner"]')?.getBoundingClientRect().height;
      if (Number.isFinite(h) && h >= 40 && h <= 80) top = Math.round(h);
    } catch {
    }
    writeRootVar(root, "--peek-lad-top", `${top}px`);
  }
  function watchTheme2() {
    unwatchTheme2();
    themeObserver2 = new MutationObserver(() => {
      themeStats.callbacks++;
      if (themeSelfWrite) {
        themeSelfWrite = false;
        themeStats.selfEchoDrops++;
        return;
      }
      applyAdapterTheme();
    });
    themeObserver2.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    if (document.body) themeObserver2.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
  }
  function unwatchTheme2() {
    themeObserver2?.disconnect();
    themeObserver2 = null;
    themeSelfWrite = false;
  }
  function setStateAttr(state2) {
    try {
      document.documentElement.setAttribute(STATE_ATTR, state2);
    } catch {
    }
  }
  function themeDiagnostics() {
    return {
      ...themeStats,
      watching: Boolean(themeObserver2),
      inlineVars: (() => {
        try {
          const root = document.documentElement;
          return Object.fromEntries(THEME_VARS.map((n) => [n, root.style.getPropertyValue(n)]));
        } catch {
          return {};
        }
      })()
    };
  }
  function sessionSnapshot() {
    return session ? {
      focusUrlId: session.focusUrlId,
      phase: session.phase,
      attempts: session.attempts,
      everActive: session.everActive,
      gen: session.gen,
      failReason: session.failReason
    } : null;
  }

  // native-extension/src/reader-lifecycle.js
  var BRAND_ICON_URL = () => {
    try {
      return globalThis.TuzaiBrandIconDataUrl || "";
    } catch {
      return "";
    }
  };
  var ACTION_NOTE = "\u5DE6\u680F\u4E3A Peek \u9605\u8BFB\u526F\u672C\uFF08DOM \u63D0\u53D6\uFF09\uFF1B\u4E92\u52A8\u4E00\u5F8B\u7531\u4F60\u5728\u53F3\u4FA7\u539F\u751F\u63A7\u4EF6\u4E0A\u4EB2\u81EA\u5B8C\u6210\u2014\u2014\u4E0A\u65B9\u6309\u94AE\u53EA\u8D1F\u8D23\u5B9A\u4F4D\u5E76\u9AD8\u4EAE\u5BF9\u5E94\u539F\u751F\u63A7\u4EF6\uFF0C\u4E0D\u4F1A\u4EE3\u66FF\u4F60\u70B9\u51FB\uFF0C\u4E5F\u4E0D\u4F1A\u6784\u9020\u4EFB\u4F55\u8D26\u53F7\u5199\u5165\u3002";
  var gen = 0;
  var liveGen = 0;
  var recoveryArmed = false;
  var recoveryLeft = 0;
  var nextRecoveryAt = 0;
  var currentGen = () => gen;
  async function buildReader() {
    const focalId = statusIdFromPath();
    if (!focalId) return;
    if (adapterEnabled()) {
      onDetailRoute(focalId);
      return;
    }
    const myGen = ++gen;
    liveGen = myGen;
    const buildStartedAt = performance.now();
    try {
      let data = null;
      for (let attempt = 0; attempt < BUILD_MAX_ATTEMPTS && myGen === gen; attempt++) {
        if (statusIdFromPath() !== focalId) return;
        data = await extractFocal(focalId, () => myGen === gen, { expand: false });
        if (data && data.statusId === focalId) break;
        data = null;
        await sleep(BUILD_POLL_MS);
      }
      if (myGen !== gen) return;
      if (!data) {
        armRecovery();
        return;
      }
      if (statusIdFromPath() !== focalId) return;
      if (document.getElementById(PANE_ID)) return;
      mountStyle();
      renderPane(data, {
        brandIconUrl: BRAND_ICON_URL(),
        onAction,
        onClose: closeReader,
        actionNote: ACTION_NOTE
      });
      watchTheme();
      setRichScanWindow(RICH_SCAN_WINDOW_MS);
      recoveryArmed = false;
      recoveryLeft = 0;
      recordFirstPaint(performance.now(), performance.now() - buildStartedAt);
      void hydrateFromDetail(focalId, myGen, data);
      if (data.showMorePending) void upgradeToFullText(focalId, myGen);
    } finally {
      if (liveGen === myGen) liveGen = 0;
    }
  }
  async function hydrateFromDetail(focalId, myGen, initialData) {
    for (let i = 0; i < HYDRATION_POLL_MAX && myGen === gen; i++) {
      await sleep(HYDRATION_POLL_MS);
      if (myGen !== gen || statusIdFromPath() !== focalId) return;
      const cell = focalCellByStatusId(focalId);
      if (cell && cell !== initialData.nativeCell && cell.isConnected) {
        const art = cell.querySelector("article[data-testid='tweet']") || cell.querySelector("article");
        if (art) {
          const fresh = extractFromArticle(art, focalId);
          const pane = document.getElementById(PANE_ID);
          if (pane && pane.dataset.statusId === focalId) {
            updatePaneInPlace(pane, fresh);
            recordHydrationRefresh(performance.now());
          }
        }
        return;
      }
    }
  }
  async function upgradeToFullText(focalId, myGen) {
    const full = await extractFocal(focalId, () => myGen === gen);
    if (!full || myGen !== gen || statusIdFromPath() !== focalId) return;
    const pane = document.getElementById(PANE_ID);
    if (pane && pane.dataset.statusId === focalId) {
      updatePaneInPlace(pane, full);
      const textEl = pane.querySelector(`.${NS}-text`);
      if (textEl) textEl.dataset.peekFullText = "1";
    }
  }
  function armRecovery() {
    if (recoveryArmed) return;
    recoveryArmed = true;
    recoveryLeft = RECOVERY_MAX_ROUNDS;
    nextRecoveryAt = Date.now() + RECOVERY_DELAY_MS;
  }
  function maybeRecover() {
    const id = statusIdFromPath();
    if (!id || liveGen || document.getElementById(PANE_ID)) return;
    if (recoveryLeft <= 0 || Date.now() < nextRecoveryAt) return;
    recoveryLeft--;
    buildReader();
  }
  function resetRecovery() {
    recoveryArmed = false;
    recoveryLeft = 0;
    nextRecoveryAt = 0;
  }
  function closeReader() {
    if (window.__PEEK_NATIVE_TEST__) {
      try {
        document.documentElement.setAttribute("data-peek-close-decision", JSON.stringify(safeBackTarget()));
      } catch {
      }
    }
    if (safeBackTarget().back) {
      history.back();
    } else {
      removeReader();
    }
  }
  function removeReader() {
    if (adapterEnabled()) offRoute();
    ++gen;
    liveGen = 0;
    resetRecovery();
    cancelRestore("reader-removed");
    removePaneAndStyle();
    unwatchTheme();
    clearOwnedTimeouts();
  }

  // native-extension/src/route-observer.js
  var activeStatusId = null;
  var routeTimer = 0;
  var lastRouteChangeAt2 = -1;
  var titleObserver = null;
  var titleElement = null;
  var clickCascadeTimers = [];
  var setInitialStatusId = (id) => {
    if (activeStatusId === null) activeStatusId = id;
  };
  function onPossibleRouteChange(viaTraverse) {
    if (viaTraverse) markPendingTraverse();
    queueMicrotask(checkRoute);
  }
  function checkRoute() {
    syncTrailFromLocation(consumePendingTraverse());
    const id = statusIdFromPath();
    if (id !== activeStatusId) {
      lastRouteChangeAt2 = performance.now();
      recordRouteChange(lastRouteChangeAt2);
      if (window.__PEEK_NATIVE_TEST__) {
        try {
          document.documentElement.setAttribute(`data-${NS}-route-change-at`, String(lastRouteChangeAt2));
        } catch {
        }
      }
      const previous = activeStatusId;
      activeStatusId = id;
      if (id) {
        capturePreOpen(id, "route-check");
        removeReader();
        buildReader();
      } else {
        removeReader();
        if (previous && !adapterEnabled()) onReturnToList(previous);
      }
    } else if (id) {
      const pane = mountedPane();
      if (pane) {
        if (pane.dataset.statusId !== id) {
          removeReader();
          buildReader();
        } else {
          applyTheme();
          syncRichNote(id);
        }
      } else {
        maybeRecover();
      }
    }
  }
  function routeTick() {
    try {
      checkRoute();
    } catch {
    }
    scheduleRouteTick();
  }
  function scheduleRouteTick() {
    routeTimer = setTimeout(routeTick, isDetailPath() || paneMounted() ? ROUTE_POLL_ACTIVE_MS : ROUTE_POLL_IDLE_MS);
  }
  function onCaptureClick(event) {
    try {
      const a = event.target?.closest?.("a[href]");
      if (a) {
        const href = a.getAttribute("href") || "";
        if (href.startsWith("/")) {
          const id = (href.match(/\/status\/(\d+)/) || [])[1] || null;
          if (id && !statusIdFromPath()) capturePreOpen(id, "click-precommit");
        }
      }
    } catch {
    }
    armClickCascade();
  }
  function startRouteObservation() {
    window.addEventListener("popstate", () => onPossibleRouteChange(true));
    window.addEventListener("hashchange", () => onPossibleRouteChange(false));
    document.addEventListener("click", onCaptureClick, true);
    watchTitle();
    if (NAV_API) {
      try {
        window.navigation.addEventListener("navigate", (event) => {
          recordNav(event.navigationType, event.destination?.url);
          try {
            if (event.destination?.url && event.navigationType === "push" && !statusIdFromPath()) {
              const destPath = new URL(event.destination.url).pathname;
              const destId = (destPath.match(/\/status\/(\d+)/) || [])[1] || null;
              if (destId) capturePreOpen(destId, "navigate-precommit");
            }
          } catch {
          }
          onPossibleRouteChange(event.navigationType === "traverse");
        });
      } catch {
      }
    }
    scheduleRouteTick();
  }
  function armClickCascade() {
    for (const h of clickCascadeTimers) clearTimeout(h);
    clickCascadeTimers = [0, 60, 150, 350].map((ms) => setTimeout(() => {
      try {
        checkRoute();
      } catch {
      }
    }, ms));
  }
  function watchTitle() {
    if (titleObserver) return;
    titleObserver = new MutationObserver(() => {
      observeTitleRoot();
      bindTitleElement();
      onPossibleRouteChange(false);
      armClickCascade();
    });
    observeTitleRoot();
    bindTitleElement();
  }
  var observedRoots = [];
  function observeTitleRoot() {
    observedRoots = observedRoots.filter((root) => {
      if (root.isConnected) return true;
      try {
        titleObserver.unobserve(root);
      } catch {
      }
      return false;
    });
    for (const root of [document.documentElement, document.head]) {
      if (root && !observedRoots.includes(root)) {
        try {
          titleObserver.observe(root, { childList: true });
          observedRoots.push(root);
        } catch {
        }
      }
    }
  }
  function bindTitleElement() {
    const t = document.querySelector("head > title");
    if (t && t !== titleElement) {
      titleElement = t;
      try {
        titleObserver.observe(t, { childList: true, characterData: true, subtree: true });
      } catch {
      }
    }
  }

  // native-extension/src/main.js
  (() => {
    if (window.__peekNativeInstalled) return;
    window.__peekNativeInstalled = true;
    initNavigationSession();
    startRouteObservation();
    initLayoutAdapter();
    if (isDetailPath()) {
      setInitialStatusId(statusIdFromPath());
      buildReader();
    }
    window.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !document.getElementById(PANE_ID)) return;
      if (document.querySelector('[data-testid="lightbox"], [data-testid="sheetDialog"], [data-testid="HoverCard"], [role="dialog"][aria-modal="true"]')) return;
      const t = event.target;
      if (t && (t.isContentEditable || t.closest?.('[data-testid^="tweetTextarea"], [contenteditable="true"]'))) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeReader();
    }, true);
    if (window.__PEEK_NATIVE_TEST__) {
      window.__peekNativeTest = {
        parseCount,
        readTheme,
        statusIdFromPath,
        fallbackText,
        countOf,
        photoUrlsIn,
        findQuoteNode,
        extractArticle,
        extractFromArticle,
        extractFocal,
        checkRoute,
        buildReader,
        removeReader,
        closeReader,
        syncRichNote,
        updatePaneInPlace,
        onAction,
        focalCellByStatusId,
        currentGen,
        // close/navigation observability (read-only)
        safeBackTarget,
        navTrailState,
        navApi: () => NAV_API,
        syncTrailFromLocation,
        recordNav,
        // B3 anchor restore
        capturePreOpen,
        onReturnToList,
        cancelRestore,
        preOpenAnchor,
        computeAnchorAdjustment,
        restoreActive,
        // diagnostics
        diag: snapshot,
        lastRouteChangeAt: () => lastRouteChangeAt(),
        // M2-B1 lab hook: drive/inspect the layout adapter session directly
        layoutAdapter: {
          enabled: adapterEnabled,
          onDetailRoute,
          offRoute,
          sessionSnapshot,
          init: initLayoutAdapter,
          themeDiagnostics
          // P1-C loop-freedom observability
        }
      };
    }
  })();
})();
