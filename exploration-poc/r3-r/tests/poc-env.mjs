// Shared offline harness for the mv3-poc content script (r3-r test suite).
// Executes the REAL production source of exploration-poc/mv3-poc/content.js
// against a jsdom document with:
//   - an innerText approximation (jsdom 30 does not implement innerText;
//     the polyfill mirrors the layout rule our fixtures rely on: block-level
//     elements separate lines, inline elements concatenate),
//   - a scrollIntoView stub (jsdom has no layout),
//   - fully controllable timers + a single shared clock (Date.now() included),
//   - a mutable fake location/history (jsdom's location cannot be reassigned).
// No network, no real X page, no account.
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export const POC_SOURCE = readFileSync(join(here, "..", "..", "mv3-poc", "content.js"), "utf8");

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

// Boot the production IIFE once per fresh jsdom document.
export function makeEnv({ url = "/home", html = "<!doctype html><html><body></body></html>" } = {}) {
  const dom = new JSDOM(html, { url: "https://x.com" + url });
  const { window } = dom;
  activeDoc = window.document;
  installInnerText(window);
  window.HTMLElement.prototype.scrollIntoView = function () { this.__scrollIntoViewCalls = (this.__scrollIntoViewCalls || 0) + 1; };

  const clock = { now: 1_000_000 };
  const timers = makeTimers(clock);
  const location = { pathname: url, href: "https://x.com" + url, search: "", hash: "" };
  const history = { _backCalls: 0, back() { this._backCalls++; } };
  const DateShim = { now: () => clock.now };

  const boot = () => {
    window.__PEEK_POC_TEST__ = true; // arm the production test hook (offline harness only)
    const fn = new Function(
      "window", "document", "location", "history",
      "setTimeout", "clearTimeout", "setInterval", "clearInterval",
      "queueMicrotask", "MutationObserver", "navigator", "getComputedStyle", "Date",
      POC_SOURCE,
    );
    fn(
      window, window.document, location, history,
      timers.setTimeout, timers.clearTimeout, timers.setInterval, timers.clearInterval,
      queueMicrotask, window.MutationObserver, window.navigator, window.getComputedStyle, DateShim,
    );
    return window.__peekPocTest;
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
  const pushNavigate = async (pathname, { viaClick = true } = {}) => {
    if (viaClick) clickLink(pathname);
    location.pathname = pathname;
    location.href = "https://x.com" + pathname;
    await timers.advance(600); // runs out the 350ms click cascade and one poll step
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
    dom, window, document: window.document, location, history, timers, clock, boot, navigate, pushNavigate, clickLink,
    get poc() { return window.__peekPocTest; },
    pane: () => window.document.getElementById("peek-poc-pane"),
    style: () => window.document.getElementById("peek-poc-style"),
    panes: () => window.document.querySelectorAll("#peek-poc-pane").length,
  };
  return api;
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
