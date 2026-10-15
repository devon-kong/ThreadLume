// Shared offline harness for the Peek Native extension.
// Executes the REAL BUILT ARTIFACT (dist-extension-native/content.js, produced
// by `npm run build`) against a jsdom document with:
//   - an innerText approximation (jsdom 30 does not implement innerText;
//     the polyfill mirrors the layout rule our fixtures rely on: block-level
//     elements separate lines, inline elements concatenate),
//   - scrollIntoView / scrollBy / scrollY stubs (jsdom has no layout),
//   - fully controllable timers + a single shared clock (Date.now() included),
//   - a mutable fake location/history (jsdom's location cannot be reassigned).
// No network, no real X page, no account, and no Legacy-bridge globals: the
// environment proves the Native build runs without the Legacy page-bridge.
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
// S3 unification (2026-10-15): ONE product artifact. NATIVE_LAB_DIST and the
// makeEnv src:"lab" selector remain only as historical aliases that resolve to
// the same unified dist-extension-native/ build; they must never point anywhere
// else again.
export const NATIVE_DIST = resolve(here, "..", "..", "dist-extension-native");
export const NATIVE_LAB_DIST = NATIVE_DIST;

let bundledSource = null;
export function nativeSource() {
  if (!bundledSource) {
    try {
      bundledSource = readFileSync(join(NATIVE_DIST, "content.js"), "utf8");
    } catch {
      throw new Error("dist-extension-native/content.js not found — run `npm run build` first");
    }
  }
  return bundledSource;
}

// Historical alias: the unified build IS the former lab build (S3).
export function labSource() {
  return nativeSource();
}

let mainWorldBundledSource = null;
export function mainWorldSource() {
  if (!mainWorldBundledSource) {
    try {
      mainWorldBundledSource = readFileSync(join(NATIVE_DIST, "layout-adapter-main.js"), "utf8");
    } catch {
      throw new Error("dist-extension-native/layout-adapter-main.js not found — run `npm run build` first");
    }
  }
  return mainWorldBundledSource;
}

const BLOCK_TAGS = new Set([
  "DIV", "P", "SECTION", "ARTICLE", "H1", "H2", "H3", "H4", "H5", "H6",
  "LI", "UL", "OL", "BLOCKQUOTE", "FIGURE", "HEADER", "FOOTER", "TR", "TIME", "TABLE",
]);

function installInnerText(window) {
  const innerTextOf = (node) => {
    if (node.nodeType === 3) return node.nodeValue ?? "";
    if (node.nodeType !== 1) return "";
    if (node.tagName === "BR") return "\n";
    let out = "";
    for (const child of node.childNodes) out += innerTextOf(child);
    if (BLOCK_TAGS.has(node.tagName) && out && !out.endsWith("\n")) out += "\n";
    return out;
  };
  Object.defineProperty(window.Element.prototype, "innerText", {
    get() { return innerTextOf(this).replace(/\n+$/, ""); },
    configurable: true,
  });
}

// Deterministic timer wheel: advance(ms) fires every due timer in order and
// flushes microtasks after each fire, so promise chains (the build loop,
// expand-show-more waits) progress exactly like real scheduling.
export function makeTimers(clock) {
  const pending = new Map();
  let seq = 0;
  const setTimeout = (fn, ms = 0) => {
    const id = ++seq;
    pending.set(id, { fn, at: clock.now + ms });
    return id;
  };
  const clearTimeout = (id) => { pending.delete(id); };
  const setInterval = (fn, ms = 0) => { // production no longer uses intervals; kept for completeness
    const id = ++seq;
    const step = () => { if (pending.has(id)) { fn(); pending.set(id, { fn: step, at: clock.now + ms }); } };
    pending.set(id, { fn: step, at: clock.now + ms });
    return id;
  };
  const clearInterval = (id) => { pending.delete(id); };
  const flushMicrotasks = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  const advance = async (ms) => {
    const target = clock.now + ms;
    for (;;) {
      let best = null;
      for (const [id, t] of pending) {
        if (t.at <= target && (!best || t.at < best.t.at || (t.at === best.t.at && id < best.id))) best = { id, t };
      }
      if (!best) break;
      clock.now = Math.max(clock.now, best.t.at);
      const { fn } = best.t;
      pending.delete(best.id);
      fn();
      await flushMicrotasks();
    }
    clock.now = target;
    await flushMicrotasks();
  };
  return { setTimeout, clearTimeout, setInterval, clearInterval, advance, flushMicrotasks, get pendingCount() { return pending.size; } };
}

// Boot the production bundle once per fresh jsdom document.
// navApi simulates the isolated-world Navigation API boundary (M1-R A1):
//   - "absent" (default): no window.navigation — jsdom reality, NAV_API=false.
//   - "silent": a navigation OBJECT exists and accepts a navigate listener,
//     but events are NEVER delivered — the exact behavior observed in a real
//     Chromium extension isolated world. entries()/currentEntry are absent so
//     the close decision exercises its trail fallback, same as live.
//   - "live": same object; tests may dispatchNavigate() to deliver events.
export function makeEnv({ url = "/home", html, navApi = "absent", src = "default" } = {}) {
  // `src` is a historical selector: "default" and "lab" both boot the SAME
  // unified artifact since the S3 unification. It is kept so existing suites
  // read naturally; new tests should omit it.
  if (!html) html = '<!doctype html><html><head><title>Home / X</title></head><body></body></html>';
  const dom = new JSDOM(html, { url: "https://x.com" + url });
  const { window } = dom;
  activeDoc = window.document;
  installInnerText(window);
  window.HTMLElement.prototype.scrollIntoView = function () { this.__scrollIntoViewCalls = (this.__scrollIntoViewCalls || 0) + 1; };

  // controllable scroll position (the B3 anchor-restore reads and adjusts it)
  const scroll = { y: 0 };
  Object.defineProperty(window, "scrollY", { get: () => scroll.y, configurable: true });
  window.scrollBy = (dx, dy) => { scroll.y += dy; };
  window.scrollTo = (x, y) => { scroll.y = y; };

  const clock = { now: 1_000_000 };
  const timers = makeTimers(clock);
  const location = { pathname: url, href: "https://x.com" + url, search: "", hash: "" };
  const history = { _backCalls: 0, back() { this._backCalls++; } };
  const DateShim = { now: () => clock.now };

  const navListeners = [];
  if (navApi !== "absent") {
    window.navigation = {
      // no entries()/currentEntry on purpose: the isolated world cannot rely
      // on them, forcing the documented trail fallback (matches live M1)
      addEventListener: (type, fn) => { if (type === "navigate") navListeners.push(fn); },
    };
  }
  const dispatchNavigate = (type, destUrl) => {
    for (const fn of [...navListeners]) fn({ navigationType: type, destination: { url: destUrl } });
  };

  const boot = () => {
    window.__PEEK_NATIVE_TEST__ = true; // arm the production test hook (offline harness only)
    runScript(window, location, history, timers, DateShim, src === "lab" ? labSource() : nativeSource());
    return window.__peekNativeTest;
  };

  // Boot any OTHER bundle of the same build into the SAME jsdom window (e.g.
  // the M2-B1 MAIN-world layout adapter alongside the isolated content script).
  // Same shims, same controllable timers — the two worlds genuinely share this
  // window, exactly like MAIN + ISOLATED content scripts on a real page.
  const bootScript = (source) => {
    window.__PEEK_NATIVE_TEST__ = true;
    runScript(window, location, history, timers, DateShim, source);
  };

  // Simulate a browser TRAVERSE (back/forward): popstate fires after the URL
  // already changed. href and pathname must move together — the production
  // close-decision trail reads location.href.
  const navigate = async (pathname) => {
    location.pathname = pathname;
    location.href = "https://x.com" + pathname;
    window.dispatchEvent(new window.Event("popstate"));
    await timers.flushMicrotasks();
  };
  // Simulate X's pushState route change: the URL changes with NO popstate.
  // With the Navigation API unavailable (jsdom), detection falls to the
  // capture-phase click cascade (if a link click was seen) or the poll.
  const pushNavigate = async (pathname, { viaClick = true, advanceMs = 600 } = {}) => {
    if (viaClick) clickLink(pathname);
    location.pathname = pathname;
    location.href = "https://x.com" + pathname;
    await timers.advance(advanceMs); // runs out the 350ms click cascade and one poll step
  };
  // Simulate a NON-CLICK SPA navigation (keyboard shortcut, X-internal
  // pushState): URL changes, no popstate, no click; the title is rewritten
  // like X does on route entry. With the Navigation API silent this must be
  // detected by the title watcher — not by the idle poll.
  const programmaticNavigate = async (pathname, { title = `Post by somebody / X`, advanceMs = 0 } = {}) => {
    location.pathname = pathname;
    location.href = "https://x.com" + pathname;
    const t = window.document.querySelector("head > title");
    if (t && title !== null) t.textContent = title;
    if (advanceMs) await timers.advance(advanceMs);
    else await timers.flushMicrotasks();
  };
  // A user click on a same-origin link (capture-phase listeners observe it;
  // jsdom performs no actual navigation on synthetic anchor clicks).
  const clickLink = (href) => {
    const a = window.document.createElement("a");
    a.setAttribute("href", href);
    a.textContent = "x";
    window.document.body.appendChild(a);
    a.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
    a.remove();
  };

  const api = {
    dom, window, document: window.document, location, history, timers, clock, boot, bootScript,
    navigate, pushNavigate, clickLink,
    programmaticNavigate, dispatchNavigate,
    navigateListenerCount: () => navListeners.length,
    scroll,
    get poc() { return window.__peekNativeTest; },
    pane: () => window.document.getElementById("peek-native-pane"),
    style: () => window.document.getElementById("peek-native-style"),
    panes: () => window.document.querySelectorAll("#peek-native-pane").length,
    // M2-B1 lab observability
    ladStyle: () => window.document.getElementById("peek-lad-style"),
    ladTest: () => window.__peekLayoutAdapterTest,
    ladMainInstalled: () => Boolean(window.__peekLayoutAdapterMainInstalled),
  };
  return api;
}

// Shared boot shim: every artifact runs with the same injected globals so the
// REAL bundles are exercised, not test doubles.
function runScript(window, location, history, timers, DateShim, source) {
  const fn = new Function(
    "window", "document", "location", "history",
    "setTimeout", "clearTimeout", "setInterval", "clearInterval",
    "queueMicrotask", "MutationObserver", "navigator", "getComputedStyle", "Date",
    source,
  );
  fn(
    window, window.document, location, history,
    timers.setTimeout, timers.clearTimeout, timers.setInterval, timers.clearInterval,
    queueMicrotask, window.MutationObserver, window.navigator, window.getComputedStyle, DateShim,
  );
}

// ---------- X DOM fixture builders ----------
// Builders attach to the most recently created env's document (tests create
// one env per test), keeping the builder call sites terse.

let activeDoc = null;
const el = (tag) => activeDoc.createElement(tag);
export const activeDocument = () => activeDoc;

let fixtureSeq = 0;

// action-bar group: like/retweet/reply/bookmark buttons with counts + aria fallback
export function buildActionBar({ reply = "12", retweet = "3", like = "42", bookmark = "" } = {}) {
  const group = el("div");
  group.setAttribute("role", "group");
  const mk = (name, count, aria) => {
    const b = el("button");
    b.setAttribute("data-testid", name);
    if (aria) b.setAttribute("aria-label", aria);
    if (count) b.textContent = count;
    group.appendChild(b);
  };
  mk("reply", reply, reply === "0" ? "0 回复次数。回复" : undefined);
  mk("retweet", retweet, retweet === "0" ? "0 转推次数。转推" : undefined);
  mk("like", like, like === "0" ? "0 喜欢次数。喜欢" : undefined);
  mk("bookmark", bookmark, bookmark === "0" ? "0 书签次数。书签" : undefined);
  return group;
}

export function buildAuthor({ name = "葛飞", handle = "gefei55" } = {}) {
  const wrap = el("div");
  wrap.setAttribute("data-testid", "User-Name");
  const n = el("div"); // block so the innerText approximation splits name/handle
  n.textContent = name;
  const h = el("a");
  h.setAttribute("href", `/${handle}`);
  h.textContent = `@${handle}`;
  wrap.append(n, h);
  return wrap;
}

export function buildTweetText(text) {
  const t = el("div");
  t.setAttribute("data-testid", "tweetText");
  t.setAttribute("lang", "zh");
  for (const line of String(text).split("\n")) {
    const p = el("div");
    p.textContent = line;
    t.appendChild(p);
  }
  return t;
}

export function buildPhoto(src, { inTweetPhoto = true } = {}) {
  const img = el("img");
  if (src) img.src = src; // no attribute = truly absent src (empty string resolves against the document URL)
  if (!inTweetPhoto) return img;
  const wrap = el("div");
  wrap.setAttribute("data-testid", "tweetPhoto");
  wrap.appendChild(img);
  return wrap;
}

// a timeline cell containing one focal article
export function buildCell({ statusId, articleChildren = [], withTime = true } = {}) {
  const cell = el("div");
  cell.setAttribute("data-testid", "cellInnerDiv");
  const art = el("article");
  art.setAttribute("data-testid", "tweet");
  art.setAttribute("tabindex", "-1");
  if (withTime) {
    const timeWrap = el("a");
    timeWrap.setAttribute("href", `/somebody/status/${statusId}`);
    const time = el("time");
    time.setAttribute("datetime", "2026-10-12T10:00:00.000Z");
    time.textContent = "18:00 · 2026年10月12日";
    timeWrap.appendChild(time);
    art.appendChild(timeWrap);
  }
  for (const child of articleChildren) art.appendChild(child);
  cell.appendChild(art);
  return { cell, art };
}

export function mountCell(env, opts) {
  const { cell } = buildCell(opts);
  env.document.body.appendChild(cell);
  return cell;
}

export function makeStatusId() {
  fixtureSeq += 1;
  return String(2109000000000000000n + BigInt(fixtureSeq));
}
