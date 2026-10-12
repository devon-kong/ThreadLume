// Peek Native Carrier PoC v5 — R4 G0 fixes (close navigation, route latency).
// ISOLATED content script, detail pages only. Zero permissions, zero internal-API calls.
//
// v5 changes over round-3-r v4 (driven by the R4 G0 gate gaps):
//  1. Close navigation (G0-A). The old close used one session-wide boolean —
//     after "external → A → quote B → back to A" it still called history.back()
//     and could land off-site. Close now consults the real session history:
//     primary is Navigation API entries() (cross-origin entries are URL-redacted
//     by the browser itself, so "previous entry is same-site X" is exact);
//     fallback is an in-document trail of observed navigations — back from an
//     entry this document visited always stays in this document, while the
//     document's initial entry has an unknown (possibly off-site) predecessor.
//     history.back() is never called unconditionally.
//  2. Route detection (G0-B). Detection is now event-driven: the Navigation API
//     "navigate" event (instant, covers keyboard/other-world navigation) when
//     exposed to the isolated world, otherwise a capture-phase click cascade on
//     same-origin links plus a <title> mutation observer. The pathname poll
//     remains only as a bounded safety net. Detection latency is measurable via
//     the test hook (lastRouteChangeAt).
//  3. Esc closes the reader (same semantics as the ✕ button), guarded so Esc
//     inside the native composer or any editable target still belongs to X.
//
// v4 changes (kept): generation-based cancellation; bounded recovery; owned
// timers; structural quote/photo extraction; positional fallbackText.

(() => {
  "use strict";

  if (window.__peekPocInstalled) return; // extension-reload idempotency
  window.__peekPocInstalled = true;

  const NS = "peek-poc";
  const PANE_ID = `${NS}-pane`;
  const STYLE_ID = `${NS}-style`;
  const ROUTE_POLL_ACTIVE_MS = 500;  // detail page open or pane mounted
  const ROUTE_POLL_IDLE_MS = 2000;   // plain X pages, enhancement dormant
  const BUILD_POLL_MS = 500;         // per DOM-wait attempt
  const BUILD_MAX_ATTEMPTS = 30;     // 15s budget per build round
  const RECOVERY_MAX_ROUNDS = 3;     // bounded retries after a failed build
  const RECOVERY_DELAY_MS = 3000;    // spacing between recovery rounds
  const ESCAPED = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let activeStatusId = null;
  let gen = 0;          // generation: bumped on every build start and every teardown
  let liveGen = 0;      // generation of the build loop currently awaiting the DOM (0 = none)
  let recoveryArmed = false;
  let recoveryLeft = 0;
  let nextRecoveryAt = 0;
  let themeObserver = null;
  let titleObserver = null;
  let routeTimer = 0;
  let richScanUntil = 0; // bounded window for late media-hydration rescan
  let lastRouteChangeAt = -1; // perf probe: performance.now() of the latest detected route change
  const ownedTimers = new Set();

  // ---------- G0-A: in-session navigation trail ----------
  // Trail semantics (fallback path): entries this DOCUMENT visited. Going back
  // from a visited entry stays inside this document (an X page); the initial
  // entry's own predecessor is unknown and may be off-site, so trail index 0
  // means "no safe back target". When the Navigation API exposes entries(),
  // that exact session history is used instead (cross-origin entries arrive
  // URL-redacted by the browser, making the same-site check trustworthy).
  let navTrail = [];     // [href] in visit order
  let navTrailIdx = -1;  // current position in navTrail
  let pendingTraverse = false; // set by popstate before the observers run

  // The baseline is the document's INITIAL URL, recorded at install time —
  // before any route observer or poll runs (the first checkRoute can be
  // seconds away, and the URL may have changed by then).
  try {
    navTrail = [location.href];
    navTrailIdx = 0;
  } catch { /* exotic location — syncTrailFromLocation re-baselines lazily */ }

  const NAV_API = (() => {
    try {
      if (window.__peekNoNavApi) return false; // offline/live test hook: force the fallback path
      return typeof window.navigation?.addEventListener === "function";
    } catch { return false; }
  })();

  function sameSiteX(url) {
    try {
      const h = new URL(url).hostname;
      return h === "x.com" || h.endsWith(".x.com") || h === "twitter.com" || h.endsWith(".twitter.com");
    } catch { return false; }
  }

  function recordNav(type, destUrl) {
    if (!destUrl || navTrail[navTrailIdx] === destUrl) return;
    if (type === "replace") {
      if (navTrailIdx >= 0) navTrail[navTrailIdx] = destUrl;
      else { navTrail = [destUrl]; navTrailIdx = 0; }
    } else if (type === "traverse") {
      const at = navTrail.lastIndexOf(destUrl);
      if (at >= 0) navTrailIdx = at;
      else { navTrail = navTrail.slice(0, navTrailIdx + 1); navTrail.push(destUrl); navTrailIdx = navTrail.length - 1; }
    } else if (type === "reload") {
      // same entry: index unchanged
    } else if (type === "push" || type === "auto_toplevel") {
      navTrail = navTrail.slice(0, navTrailIdx + 1);
      navTrail.push(destUrl);
      navTrailIdx = navTrail.length - 1;
    }
  }

  // Fallback bookkeeping: deduce push/traverse from the (already-committed) URL
  // when Navigation events are unavailable. Popstate implies traverse; a URL
  // change observed without popstate implies push (X pushes statuses).
  function syncTrailFromLocation(viaTraverse) {
    const href = location.href;
    if (navTrail.length === 0) { navTrail = [href]; navTrailIdx = 0; return; }
    if (navTrail[navTrailIdx] === href) return;
    if (viaTraverse) {
      const at = navTrail.lastIndexOf(href);
      if (at >= 0) { navTrailIdx = at; return; }
    }
    navTrail = navTrail.slice(0, navTrailIdx + 1);
    navTrail.push(href);
    navTrailIdx = navTrail.length - 1;
  }

  // The close decision: may history.back() land on a same-site X page?
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
    } catch { /* entries() unavailable in this world — use the trail */ }
    if (navTrailIdx > 0) return { back: true, why: "trail-visited-entry" };
    return { back: false, why: navTrail.length === 0 ? "trail-empty" : "trail-initial-entry" };
  }

  const statusIdFromPath = () => (location.pathname.match(/\/status\/(\d+)/) || [])[1] || null;
  const isDetailPath = () => Boolean(statusIdFromPath());

  // ---------- route observation (G0-B: event-driven, poll is the safety net) ----------

  function onPossibleRouteChange(viaTraverse) {
    if (viaTraverse) pendingTraverse = true;
    queueMicrotask(checkRoute);
  }

  function checkRoute() {
    if (!NAV_API) {
      syncTrailFromLocation(pendingTraverse);
      pendingTraverse = false;
    }
    lastRouteChangeAt = performance.now();
    const id = statusIdFromPath();
    if (id !== activeStatusId) {
      const previous = activeStatusId;
      activeStatusId = id;
      if (id) {
        removeReader(); // also invalidates any in-flight build for the old post
        buildReader();
      } else {
        removeReader();
      }
    } else if (id) {
      const pane = document.getElementById(PANE_ID);
      if (pane) {
        if (pane.dataset.statusId !== id) {
          // stale pane (should not happen — every mount re-verifies the URL —
          // but the invariant "left pane shows the URL's post" is enforced here)
          removeReader();
          buildReader();
        } else {
          // Bounded maintenance while reading: keep the theme in sync with any
          // theme-change mutation the observers might miss, and surface a
          // rich-media note if the video player/poll/card hydrated after the
          // pane was built (extraction runs once; hydration can land later).
          applyTheme();
          syncRichNote();
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
      // the route watch must survive unexpected DOM shapes; next tick retries
    }
    scheduleRouteTick();
  }

  function scheduleRouteTick() {
    routeTimer = setTimeout(routeTick, isDetailPath() || document.getElementById(PANE_ID) ? ROUTE_POLL_ACTIVE_MS : ROUTE_POLL_IDLE_MS);
  }

  // The pane's rich-note is rendered at build time. If the native cell's media
  // hydrates later (video race measured in R3), append the note then — once.
  // The rescan is bounded to a window after mount (media hydration lands in the
  // first seconds in practice); afterwards the tick stops scanning the focal
  // cell every 500ms.
  function syncRichNote() {
    const pane = document.getElementById(PANE_ID);
    if (!pane || pane.querySelector(`.${NS}-rich-note`)) return;
    if (performance.now() > richScanUntil) return;
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

  // The route poll is the lifecycle owner's safety net; event sources cover
  // real SPA navigation instantly:
  //  - Navigation API "navigate": instant for every same-document navigation
  //    (pushState included — no popstate fires for those), any initiating
  //    world, keyboard included. Also feeds the G0-A trail with exact types.
  //  - (fallback only) capture-phase click cascade: X navigations originate
  //    from a link click; re-check immediately and on a short bounded cascade
  //    in case the router defers pushState to a later task.
  //  - (fallback only) <title> mutation observer: X rewrites the title per
  //    route; covers keyboard navigation that no click saw.
  //  - popstate: browser back/forward (traverse) — also marks the trail.
  window.addEventListener("popstate", () => onPossibleRouteChange(true));
  window.addEventListener("hashchange", () => onPossibleRouteChange(false));
  if (NAV_API) {
    try {
      window.navigation.addEventListener("navigate", (event) => {
        recordNav(event.navigationType, event.destination?.url);
        onPossibleRouteChange(event.navigationType === "traverse");
      });
    } catch { /* poll + popstate remain */ }
  } else {
    // capture-phase, never preventDefault: this observes clicks, it does not
    // intercept them (X's own router still owns the navigation)
    document.addEventListener("click", (event) => {
      const a = event.target?.closest?.("a[href]");
      if (!a) return;
      const href = a.getAttribute("href") || "";
      if (href.startsWith("/") || href.startsWith(`${location.origin}/`)) armClickCascade();
    }, true);
    watchTitle();
  }

  let clickCascadeTimers = [];
  function armClickCascade() {
    for (const h of clickCascadeTimers) clearTimeout(h);
    clickCascadeTimers = [0, 60, 150, 350].map((ms) =>
      setTimeout(() => { try { checkRoute(); } catch { /* next cascade step retries */ } }, ms));
  }

  function watchTitle() {
    if (titleObserver) return;
    titleObserver = new MutationObserver(() => onPossibleRouteChange(false));
    const bind = () => {
      const t = document.querySelector("head > title");
      if (t) { titleObserver.disconnect(); titleObserver.observe(t, { childList: true, characterData: true, subtree: true }); }
    };
    bind();
    // X can replace the title element wholesale; keep the observer bound to it
    titleObserver.observe(document.head, { childList: true });
  }

  scheduleRouteTick();

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

  // Photo URLs inside `scope`, skipping any img contained in one of the
  // `excludes` subtrees. Video posters (ext_tw_video_thumb) and card thumbnails
  // (card_img) do not match the selector, so they are never attributed as post
  // photos; quote/card media are excluded structurally by the callers.
  function photoUrlsIn(scope, ...excludes) {
    const urls = [];
    for (const img of scope.querySelectorAll('[data-testid="tweetPhoto"] img, img[src*="pbs.twimg.com/media"]')) {
      if (excludes.some((ex) => ex && ex.contains(img))) continue;
      if (!img.src) continue; // half-hydrated media: skip rather than render ""
      urls.push(img.src);
    }
    return [...new Set(urls)];
  }

  // Quote cards are div[role="link"]; so are website cards. A quote card nests
  // the quoted author or text (or is the last role=link after media/cards —
  // X renders quotes at the bottom), and never contains card.wrapper.
  function findQuoteNode(art) {
    const isCard = (n) => n.getAttribute("data-testid") === "card.wrapper" || Boolean(n.querySelector('[data-testid="card.wrapper"]'));
    const candidates = [...art.querySelectorAll('div[role="link"]')].filter((n) => !isCard(n));
    return candidates.find((n) => n.querySelector('[data-testid="tweetText"], [data-testid="User-Name"]'))
      || candidates[candidates.length - 1]
      || null;
  }

  // X Articles render title/body in dedicated containers (not tweetText).
  function extractArticle(art) {
    const title = art.querySelector('[data-testid="twitter-article-title"]')?.innerText?.trim() || null;
    const body = art.querySelector('[data-testid="twitterArticleRichTextView"]');
    if (!body) return null;
    return { title, text: body.innerText || "", photos: photoUrlsIn(body) };
  }

  // Logged-out / no-testid fallback. Non-body chrome is skipped POSITIONALLY
  // (the action-bar group / count nodes, the timestamp, the quote card, cards,
  // the player are never descended into), so a body line like "2026" or "42"
  // survives even when it textually equals an engagement count; unknown stays
  // unknown. No text-equality matching is involved.
  function fallbackText(art) {
    const UI_LINE = /^(show translation|显示翻译|translate post|show more|显示更多)$/i;
    const SKIP_SEL = '[role="group"], [data-testid="like"], [data-testid="retweet"], [data-testid="reply"], [data-testid="bookmark"], time, div[role="link"], [data-testid="card.wrapper"], [data-testid="videoPlayer"]';
    const blocks = [];
    const collect = (node) => {
      if (node.matches?.(SKIP_SEL)) return; // positionally excluded subtree
      if (!node.querySelector(SKIP_SEL)) {
        const text = String(node.innerText || "").trim();
        if (text) blocks.push(text);
        return;
      }
      for (const child of node.children) collect(child);
    };
    collect(art);
    const lines = blocks.join("\n").split("\n").map((l) => l.trim()).filter(Boolean)
      .filter((l) => !UI_LINE.test(l));
    const handleIdx = lines.slice(0, 3).findIndex((l) => l.startsWith("@") && l.length <= 20);
    if (handleIdx >= 0) lines.splice(0, handleIdx + 1);
    return lines.join("\n");
  }

  async function expandShowMore(art) {
    // Premium long posts collapse the body behind a show-more link. One display
    // expansion, bounded to the focal article (never inside the quote card),
    // mirrors what a reading user does.
    const quote = findQuoteNode(art);
    const more = [...art.querySelectorAll('[data-testid="tweet-text-show-more-link"], a[href*="show-more"], [role="button"]')]
      .filter((el) => !(quote && quote.contains(el)))
      .find((el) => /^(显示更多|Show more)$/i.test((el.innerText || "").trim()));
    if (more) {
      more.click();
      await sleep(700);
    }
  }

  async function extractFocal(focalId, myGen) {
    if (statusIdFromPath() !== focalId) return null;
    const cell = focalCellByStatusId(focalId);
    const art = cell && (cell.querySelector("article[data-testid='tweet']") || cell.querySelector("article"));
    if (!art) return null;
    await expandShowMore(art);
    // the show-more wait is an async gap: the route may have moved, or React
    // virtualization may have recycled the cell — never extract a stale node
    if (myGen !== gen || statusIdFromPath() !== focalId) return null;
    if (!cell.isConnected || !art.isConnected) return null;
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
    // main-post photos: everything photo-shaped in the article minus the quote
    // and website-card subtrees (article body images + article cover included)
    const photos = photoUrlsIn(art, quoteNode, cardNode);
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
        photos: photoUrlsIn(quoteNode)
      } : null,
      rich: { video, poll, card: Boolean(cardNode), article: Boolean(article) },
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
    pane.dataset.statusId = data.statusId; // invariant: pane shows the URL's post
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
        <span class="${NS}-brand">Peek PoC · 原生承载 v4</span>
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

  function ownedTimeout(fn, ms) {
    const h = setTimeout(() => {
      ownedTimers.delete(h);
      fn();
    }, ms);
    ownedTimers.add(h);
    return h;
  }

  function pulse(native) {
    if (!native) return;
    native.scrollIntoView({ block: "center", behavior: "smooth" });
    const prev = native.style.outline;
    native.style.outline = "2px solid var(--peek-accent, #1d9bf0)";
    native.style.outlineOffset = "3px";
    ownedTimeout(() => {
      if (native.isConnected) native.style.outline = prev;
    }, 1600);
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
      ownedTimeout(() => {
        if (!cell.isConnected) return;
        cell.querySelector('[data-testid="tweetTextarea_0"], [data-testid="tweetButtonInline"]')?.focus?.();
      }, 450);
      return;
    }
    // locate-and-highlight: the user performs the write on the native control
    const name = act === "like" ? "like" : act === "retweet" ? "retweet" : "bookmark";
    const native = cell.querySelector(`[data-testid="${name}"], [data-testid="un${name}"]`);
    pulse(native);
  }

  function closeReader() {
    // G0-A: only follow the session history when the previous entry is known
    // to be a same-site X page; direct/external/refreshed entries are dismissed
    // in place instead of gambling on an unknown history target.
    if (safeBackTarget().back) {
      history.back(); // previous entry is X's own view (list or previous post)
    } else {
      removeReader(); // dismiss the enhancement, stay on X
    }
  }

  // Esc closes the reader like the ✕ button. Guarded: when the user is typing
  // in the native composer or any editable target, Esc belongs to X.
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !document.getElementById(PANE_ID)) return;
    const t = event.target;
    if (t && (t.isContentEditable || t.closest?.('[data-testid^="tweetTextarea"], [contenteditable="true"]'))) return;
    closeReader();
  });

  // ---------- build / teardown ----------

  async function buildReader() {
    const focalId = statusIdFromPath();
    if (!focalId) return;
    const myGen = ++gen;
    liveGen = myGen;
    try {
      let data = null;
      for (let attempt = 0; attempt < BUILD_MAX_ATTEMPTS && myGen === gen; attempt++) {
        if (statusIdFromPath() !== focalId) return; // route moved on — die now
        data = await extractFocal(focalId, myGen);
        if (data && data.statusId === focalId) break;
        data = null;
        await sleep(BUILD_POLL_MS);
      }
      if (myGen !== gen) return;             // superseded or torn down
      if (!data) {                            // same route, DOM never appeared
        armRecovery();
        return;
      }
      if (statusIdFromPath() !== focalId) return;     // re-verify before render
      if (document.getElementById(PANE_ID)) return;   // never double-mount
      mountStyle();
      renderPane(data);
      watchTheme();
      richScanUntil = performance.now() + 20_000; // bounded late-hydration rescan
      recoveryArmed = false;
      recoveryLeft = 0;
    } finally {
      if (liveGen === myGen) liveGen = 0; // a newer build owns the flag otherwise
    }
  }

  // Bounded retry after a timed-out build, driven by the existing route tick.
  // The budget is armed ONCE per route entry: recovery rounds that fail again
  // do not re-arm it, so a dead route eventually goes fully dormant until the
  // next navigation.
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

  function mountStyle() {
    if (document.getElementById(STYLE_ID)) return;
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
  }

  function removeReader() {
    ++gen;        // invalidate any in-flight build task immediately
    liveGen = 0;
    recoveryArmed = false;
    recoveryLeft = 0;
    nextRecoveryAt = 0;
    document.getElementById(PANE_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
    document.documentElement.removeAttribute(`data-${NS}`);
    themeObserver?.disconnect();
    themeObserver = null;
    for (const h of ownedTimers) clearTimeout(h);
    ownedTimers.clear();
  }

  if (isDetailPath()) {
    activeStatusId = statusIdFromPath();
    buildReader();
  }

  // test hook: lets the verification harness unit-test the real helpers through
  // CDP or the offline jsdom harness; never armed in production
  if (window.__PEEK_POC_TEST__) {
    window.__peekPocTest = {
      parseCount, readTheme, statusIdFromPath, fallbackText,
      countOf, photoUrlsIn, findQuoteNode, extractArticle, extractFromArticle,
      extractFocal, checkRoute, buildReader, removeReader, syncRichNote,
      currentGen: () => gen,
      // G0-A/G0-B observability (read-only)
      safeBackTarget, navTrailState: () => ({ trail: [...navTrail], idx: navTrailIdx }),
      navApi: () => NAV_API,
      lastRouteChangeAt: () => lastRouteChangeAt,
      syncTrailFromLocation,
      recordNav,
    };
  }
})();
