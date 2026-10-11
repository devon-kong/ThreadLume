// Peek Native Carrier PoC — ISOLATED content script, detail pages only.
// No fetch/XHR wrapper, no webpack probing, no MAIN-world bridge, no extra permissions.
(() => {
  "use strict";

  const NS = "peek-poc";
  const PANE_ID = NS + "-pane";
  const STYLE_ID = NS + "-style";
  const ESCAPED = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  let activePath = null;
  let buildToken = 0;

  function isDetailPath() {
    return /\/status\/\d+/.test(location.pathname);
  }

  function removeReader() {
    document.getElementById(PANE_ID)?.remove();
    document.getElementById(STYLE_ID)?.remove();
    document.documentElement.removeAttribute(`data-${NS}`);
    document.querySelector(`.${NS}-focal-cell`)?.classList.remove(`${NS}-focal-cell`);
    activePath = null;
  }

  function extractFocal() {
    const focalId = (location.pathname.match(/\/status\/(\d+)/) || [])[1];
    // Focal cell = the cell whose timestamp link points at the URL's own status id.
    // On reply detail pages the first article is the ancestor root, not the focal
    // reply, so "first article" would be wrong there.
    if (focalId) {
      const byLink = [...document.querySelectorAll('[data-testid="cellInnerDiv"]')]
        .find((cell) => [...cell.querySelectorAll(`a[href*="/status/${focalId}"]`)]
          .some((a) => a.querySelector("time") || a.getAttribute("href") === location.pathname));
      const art = byLink?.querySelector("article[data-testid='tweet']") || byLink?.querySelector("article");
      if (art) return extractFromArticle(art, location.pathname);
    }
    const art = document.querySelector('[data-testid="primaryColumn"] article[data-testid="tweet"]');
    if (art) return extractFromArticle(art, location.pathname);
    // Logged-out fallback: server-rendered conversation (#urt:conversation:<id>).
    // Same read-only DOM extraction; no internal APIs. Time/counters may be absent.
    const conv = document.querySelector('[id^="urt:conversation"] article');
    if (conv) return extractFromArticle(conv, location.pathname);
    return null;
  }

  function extractFromArticle(art, path) {
    const handle = [...art.querySelectorAll('a[href^="/"]')]
      .map((a) => a.getAttribute("href"))
      .find((h) => /^\/[^/]+$/.test(h));
    const nameNode = art.querySelector('[data-testid="User-Name"]');
    const count = (tid) => (art.querySelector(`[data-testid="${tid}"]`)?.innerText || "").replace(/\D/g, "") || "0";
    const textNode = art.querySelector('[data-testid="tweetText"]');
    const text = textNode ? textNode.innerText : (art.innerText || "").split("\n").slice(2).join("\n");
    return {
      path,
      name: nameNode ? nameNode.innerText.split("\n")[0] : (handle ? handle.slice(1) : "未知作者"),
      handle: handle || "",
      avatar: art.querySelector('img[src*="profile_images"]')?.src || "",
      time: art.querySelector("time")?.getAttribute("datetime") || "",
      timeText: art.querySelector("time")?.innerText || "",
      text,
      photos: [...art.querySelectorAll('[data-testid="tweetPhoto"] img, img[src*="pbs.twimg.com/media"]')].map((i) => i.src.split("?")[0]),
      quote: art.querySelector('div[role="link"] [data-testid="tweetText"]')?.innerText?.slice(0, 160) || null,
      reply: count("reply"),
      retweet: count("retweet"),
      like: count("like")
    };
  }

  function renderPane(data) {
    const pane = document.createElement("div");
    pane.id = PANE_ID;
    pane.innerHTML = `
      <header class="${NS}-bar">
        <button class="${NS}-close" title="关闭 (Esc)">✕</button>
        <span class="${NS}-brand">Peek PoC · 原生承载</span>
        <a class="${NS}-open" target="_blank" rel="noopener" href="https://x.com${ESCAPED(data.path)}">在 X 打开</a>
      </header>
      <div class="${NS}-body">
        <div class="${NS}-author">
          <img src="${ESCAPED(data.avatar)}" referrerpolicy="no-referrer" alt="">
          <div><b>${ESCAPED(data.name)}</b><span>${ESCAPED(data.handle)}</span></div>
        </div>
        <div class="${NS}-text">${ESCAPED(data.text)}</div>
        ${data.photos.map((u) => `<img class="${NS}-photo" src="${ESCAPED(u)}" referrerpolicy="no-referrer" alt="">`).join("")}
        ${data.quote ? `<div class="${NS}-quote">${ESCAPED(data.quote)}</div>` : ""}
        <div class="${NS}-counts">回复 ${ESCAPED(data.reply)} · 转推 ${ESCAPED(data.retweet)} · 喜欢 ${ESCAPED(data.like)} · ${ESCAPED(data.timeText)}</div>
        <div class="${NS}-note">左栏：Peek 从原生 DOM 提取绘制；右栏：原生评论流（独立滚动）</div>
      </div>`;
    pane.querySelector(`.${NS}-close`).addEventListener("click", () => history.back());
    document.body.appendChild(pane);
  }

  async function buildReader() {
    const pathAtStart = location.pathname;
    const token = ++buildToken;
    activePath = pathAtStart;
    // bounded wait for the focal article (X SPA hydration)
    let data = null;
    for (let i = 0; i < 30 && token === buildToken; i++) {
      data = extractFocal();
      if (data && data.path === pathAtStart) break;
      data = null;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (token !== buildToken || !data) return; // superseded by newer navigation
    if (document.getElementById(PANE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      html[data-${NS}] [data-testid="cellInnerDiv"].${NS}-focal-cell { visibility: hidden !important; }
      html[data-${NS}] [data-testid="cellInnerDiv"]:not(.${NS}-focal-cell) { margin-left: 52% !important; width: 48% !important; }
    `;
    document.head.appendChild(style);
    // tag the focal cell by status id (never :first-child — reply pages start
    // with ancestor cells that must stay visible in the right column)
    const focalId = (location.pathname.match(/\/status\/(\d+)/) || [])[1];
    if (focalId) {
      const focalCell = [...document.querySelectorAll('[data-testid="cellInnerDiv"]')]
        .find((cell) => [...cell.querySelectorAll(`a[href*="/status/${focalId}"]`)]
          .some((a) => a.querySelector("time")));
      focalCell?.classList.add(`${NS}-focal-cell`);
    }
    document.documentElement.setAttribute(`data-${NS}`, "on");
    renderPane(data);
  }

  function onRouteChange() {
    if (isDetailPath()) {
      if (activePath !== location.pathname) {
        removeReader();
        buildReader();
      }
    } else {
      removeReader();
    }
  }

  // Minimal SPA route observation: wrap history mutations + popstate. No X internals.
  // Idempotency guard: without it, an extension reload wraps the (still-live) old
  // closures a second time and stale teardown would fight the fresh pane.
  if (!window.__peekPocRouteObserved) {
    window.__peekPocRouteObserved = true;
    for (const name of ["pushState", "replaceState"]) {
      const original = history[name].bind(history);
      history[name] = (...args) => {
        const result = original(...args);
        queueMicrotask(onRouteChange);
        return result;
      };
    }
    window.addEventListener("popstate", () => queueMicrotask(onRouteChange));
  }
  window.addEventListener("keydown", (event) => {
    // Yield to X's own Escape consumers (image lightbox, dialogs, composer) and
    // to any already-handled event; never fire twice for one keystroke.
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (!document.getElementById(PANE_ID)) return;
    if (event.isComposing) return;
    if (event.target instanceof Element && event.target.closest("input, textarea, [role='textbox'], [data-testid='tweetTextarea_0']")) return;
    if (document.querySelector("[role='dialog']:not(#peek-poc-pane)")) return;
    event.preventDefault();
    history.back();
  }, { capture: true });

  if (isDetailPath()) buildReader();
})();
