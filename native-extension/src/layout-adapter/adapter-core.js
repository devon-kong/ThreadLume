// Peek M2-B1(-R) — X layout adapter CORE (runs in the MAIN world).
//
// Contract: docs/m2-b1/adapter-contract.md. One explicitly identified
// virtualizer instance, one focal item, one wrapped method
// (_getFinalRenderedItems), ownership-aware restore. Everything here is
// synchronous reads + that single method wrap: no network, no credentials,
// no X private HTTP APIs, no DOM moves/clones, no React prototype patches.
//
// Scope guards (contract §5): the wrapper acts only when
//   - `this` is the managed instance,
//   - the URL still points at the installed focus status id,
//   - the current list data still contains the focus item key.
// Any shape drift is handled by the bounded health check, which exits safely
// and restores the original method — it never retries unboundedly and never
// forces React renders.
//
// M2-B1-R additions:
//   P0-A  every emitted transition carries the session correlation triple
//         { gen, reqNonce, focusUrlId }; autonomous notifications use the
//         HEALTH_* type family so the ISOLATED controller can route them
//         without confusing them with request responses.
//   P1-A  a restore that throws or fails verification enters RESIDUE_LOCKED:
//         the lastError is never overwritten, the old instance/wrapper/original
//         references are retained for diagnosis until page destroy, and any
//         further INSTALL is rejected (no re-wrapping on top of a wrap we no
//         longer own).
//   P1-B  the focal article is re-verified (cell-scoped MutationObserver +
//         every health tick): X may swap the article INSIDE a kept cell;
//         the marker is re-bound only onto an article proven to still be the
//         focus, otherwise the adapter exits instead of pinning the wrong node.

import {
  LAD_KEY, LAD_MARK_ARTICLE,
  LAD_HEALTH_INTERVAL_MS, LAD_REINSTALL_BUDGET, LAD_CELL_MISS_TICKS,
  LAD_ARTICLE_SETTLE_MS, LAD_ARTICLE_GONE_MS,
} from "./constants.js";
import { statusIdFromPath } from "../constants.js";
import { focalCellByStatusId } from "../focal-extractor.js";

const FIBER_KEY_PREFIXES = ["__reactFiber", "__reactInternalInstance"];
const SAMPLE_EVERY = 64; // perf sampling rate (S5): counters are free, timing is not

// ---- module-singleton state (one adapter per page — contract §3) ----
let S = freshState();
let genSeq = 0;

function freshState() {
  return {
    phase: "idle",            // idle | active | error | residue-locked
    gen: 0,                   // session generation (P0-A): increments per install
    reqNonce: null,           // nonce of the INSTALL request that created it
    focusUrlId: null,
    focusItemKey: null,
    instance: null,
    cell: null,
    article: null,            // the DOM node carrying the layout marker
    entrySnapshot: null,      // freshest rendered entry seen for the focus item
    wrapper: null,
    original: null,
    ownership: null,          // "prototype" | "own-data"
    savedDescriptor: null,
    healthTimer: 0,
    cellObserver: null,       // P1-B: focal-cell article-swap watcher
    articleTimer: 0,          // P1-B: debounced re-verification
    articleGoneSince: 0,      // P1-B: first moment the article was seen absent
    articleSettleTimer: 0,    // P1-B: coalesce attribute churn on a fresh bind
    missStreak: 0,
    reinstallLeft: LAD_REINSTALL_BUDGET,
    lastError: null,
    residueLock: null,        // P1-A: set only in the residue-locked phase
    stats: {
      installs: 0, uninstalls: 0, calls: 0, injections: 0,
      naturalSightings: 0, sampledWrapperMs: 0, sampledOriginalMs: 0, samples: 0,
      articleRebinds: 0, articleRebindRefusals: 0,
    },
  };
}

// MAIN entry registers a notifier (posts transitions to the ISOLATED world).
let notify = null;
export function setNotifier(fn) { notify = typeof fn === "function" ? fn : null; }
// P0-A: every transition carries the full correlation triple. Autonomous
// notifications (HEALTH_*) travel with the gen/reqNonce of the installation
// session that produced them; the ISOLATED controller validates the triple —
// a nonce alone cannot correlate an event that answers no request.
function emit(type, extra = {}) {
  if (!notify) return;
  try {
    notify({
      type, gen: S.gen, reqNonce: S.reqNonce ?? null, focusUrlId: S.focusUrlId,
      ...extra,
    });
  } catch { /* never let reporting break the adapter */ }
}

// ---- pure inspection helpers ----

export function fiberKeyOf(node) {
  if (!node) return null;
  try {
    return Object.keys(node).find((k) => FIBER_KEY_PREFIXES.some((p) => k.startsWith(p))) || null;
  } catch { return null; }
}

export function locateVirtualizer(cell) {
  if (!cell) return { ok: false, reason: "no-cell" };
  const key = fiberKeyOf(cell);
  if (!key) return { ok: false, reason: "no-fiber-key" };
  let fiber = cell[key];
  while (fiber && !(fiber.stateNode && typeof fiber.stateNode[LAD_KEY] === "function")) fiber = fiber.return;
  const v = fiber ? fiber.stateNode : null;
  if (!v) return { ok: false, reason: "virtualizer-not-found" };
  return { ok: true, instance: v };
}

export function validateInstance(instance) {
  if (!Array.isArray(instance.props?.list)) return { ok: false, reason: "props-list-missing" };
  if (typeof instance._cells?.get !== "function") return { ok: false, reason: "cells-map-missing" };
  let rendered;
  try { rendered = instance[LAD_KEY](); } catch { return { ok: false, reason: "final-items-threw" }; }
  if (!Array.isArray(rendered)) return { ok: false, reason: "final-items-not-array" };
  return { ok: true, rendered };
}

export function findVirtualizerInstance(cell) {
  const located = locateVirtualizer(cell);
  if (!located.ok) return located;
  const validated = validateInstance(located.instance);
  if (!validated.ok) return validated;
  return { ...located, rendered: validated.rendered };
}

function mapFocalEntry(instance, cell, rendered) {
  // DOM identity, not id matching (contract §0.4): the entry whose registered
  // cell element IS the focal cell.
  try {
    const entry = rendered.find((x) => x && typeof x === "object" && x.item && x.item.id != null &&
      instance._cells.get(x.item.id)?.getElement?.() === cell);
    if (!entry) return { ok: false, reason: "focal-entry-not-mapped" };
    return { ok: true, entry, focusItemKey: entry.item.id };
  } catch {
    return { ok: false, reason: "focal-entry-not-mapped" };
  }
}

// Ownership analysis BEFORE wrapping (contract §0.10 / §4.6): the uninstall
// path must restore the property structure, not just assign a value.
export function inspectOwnership(instance) {
  let d = null;
  try { d = Object.getOwnPropertyDescriptor(instance, LAD_KEY); } catch { d = null; }
  if (!d) {
    // inherited (prototype) method: wrapping creates a new own property —
    // only possible while the instance still accepts new properties
    if (Object.isSealed(instance) || Object.isFrozen(instance) || !Object.isExtensible(instance)) {
      return { ok: false, reason: "instance-sealed" };
    }
    return { ok: true, ownership: "prototype", descriptor: null };
  }
  if (d.get || d.set) return { ok: false, reason: "accessor-descriptor" };
  if (d.configurable === false) return { ok: false, reason: "non-configurable" };
  return { ok: true, ownership: "own-data", descriptor: { ...d } };
}

// P1-B helpers: article identity inside the focal cell.

export function articleInCell(cell) {
  try {
    return cell?.querySelector("article[data-testid='tweet']") || cell?.querySelector("article") || null;
  } catch { return null; }
}

// A timestamp link whose href ENDS with /status/<id> (quote cards inside the
// article also carry status links, but the article's own timestamp link is the
// one that terminates in the article's own id). Null/absent id matches nothing.
export function articleMatchesStatus(art, statusId) {
  if (!art || !statusId) return false;
  try {
    return [...art.querySelectorAll("a[href] time")].some((t) => {
      const href = t.closest("a")?.getAttribute("href") || "";
      return new RegExp(`/status/${statusId}(?:$|[?#])`).test(href);
    });
  } catch { return false; }
}

// ---- wrapper ----

function makeWrapper() {
  return function wrapped(...args) {
    const s = S;
    // residue-locked included: any phase but active passes through untouched
    if (s.phase !== "active") return s.original.apply(this, args);
    s.stats.calls++;
    const sample = s.stats.calls % SAMPLE_EVERY === 0;
    let t0 = 0;
    if (sample) t0 = performance.now();
    const items = s.original.apply(this, args);
    if (sample) {
      s.stats.samples++;
      s.stats.sampledOriginalMs += performance.now() - t0;
      t0 = performance.now();
    }
    let result = items;
    try {
      // I7: only the managed instance
      if (this !== s.instance) { result = items; }
      // I5: route/focus guard
      else if (statusIdFromPath() !== s.focusUrlId) { result = items; }
      else if (!Array.isArray(items)) { result = items; }
      else {
        const focusKey = s.focusItemKey;
        // I3: never inject twice — and refresh the entry snapshot while the
        // focal item is naturally rendered (freshest fields for later injection)
        const live = items.find((x) => x && x.item && x.item.id === focusKey);
        if (live) { s.entrySnapshot = live; s.stats.naturalSightings++; result = items; }
        else {
          // I4: always inject the item from the CALL-TIME list data
          const list = this.props?.list;
          const currentItem = Array.isArray(list) ? list.find((x) => x && x.id === focusKey) : null;
          const snap = s.entrySnapshot;
          if (!currentItem || !snap || typeof snap !== "object") { result = items; } // graceful recycle
          else { s.stats.injections++; result = [{ ...snap, item: currentItem, offset: 0, visible: true }, ...items]; }
        }
      }
    } catch {
      result = items; // a throwing wrapper would break X's own render — degrade
    }
    if (sample) s.stats.sampledWrapperMs += performance.now() - t0;
    return result;
  };
}

// ---- install ----

export function install({ focusUrlId, reqNonce = null, internalReinstall = false } = {}) {
  if (!focusUrlId || typeof focusUrlId !== "string") return { type: "UNSUPPORTED", reason: "bad-focus-id" };
  // P1-A: a page whose restore failed may still carry our wrap on an instance
  // we no longer manage. Re-wrapping there would stack a second wrapper whose
  // restore references we cannot trust — refuse until the page is reloaded.
  if (S.phase === "residue-locked") {
    return { type: "ERROR", reason: "residue-locked", focusUrlId };
  }
  // the bounded re-install budget is consumed by successful internal
  // re-installs of ONE focus session; a route-driven install resets it
  const budget = internalReinstall ? Math.max(0, S.reinstallLeft - 1) : LAD_REINSTALL_BUDGET;
  // gen continuity: an internal re-install CONTINUES the same installation
  // session (same focus, same controller session) — only a genuinely new
  // install mints a generation. Breaking this strands the controller on the
  // old gen: every later autonomous notification of the continued session
  // (HEALTH_ERROR included) is dropped as "foreign" and the split CSS leaks.
  const continuesSession = internalReinstall && S.phase === "active";
  const prevGen = S.gen;
  if (S.phase === "active") {
    // same-focus idempotency applies to ROUTE-driven installs only; an
    // internal re-install means the instance was replaced underneath us
    if (S.focusUrlId === focusUrlId && !internalReinstall) return activeResult("already-active");
    const down = doUninstall(internalReinstall ? "instance-replaced" : "reinstall");
    if (down.type !== "UNINSTALLED") {
      // the previous wrap could not be released (residue-locked now) — surface
      // the true restore failure, not a generic reinstall error
      return { type: "ERROR", reason: `reinstall-uninstall-failed:${down.reason}`, phase: S.phase };
    }
  }
  const stats = S.stats;
  S = freshState();
  S.stats = stats;              // aggregate counters survive re-installs (S5)
  S.reinstallLeft = budget;
  S.gen = continuesSession ? prevGen : ++genSeq; // P1(R): session-continuing reinstall keeps the generation
  S.reqNonce = reqNonce;
  S.focusUrlId = focusUrlId;

  const cell = focalCellByStatusId(focusUrlId);
  if (!cell) return unsupported("focal-cell-not-found");
  if (!cell.isConnected) return unsupported("focal-cell-detached");

  const located = locateVirtualizer(cell);
  if (!located.ok) return unsupported(located.reason);
  // ownership BEFORE invoking the method: an unwrappable shape must never be
  // exercised at all (contract §4.6 before §4.4)
  const own = inspectOwnership(located.instance);
  if (!own.ok) return unsupported(own.reason);
  const validated = validateInstance(located.instance);
  if (!validated.ok) return unsupported(validated.reason);
  const mapped = mapFocalEntry(located.instance, cell, validated.rendered);
  if (!mapped.ok) return unsupported(mapped.reason);

  S.instance = located.instance;
  S.cell = cell;
  S.entrySnapshot = mapped.entry;
  S.focusItemKey = mapped.focusItemKey;
  S.original = located.instance[LAD_KEY];
  S.ownership = own.ownership;
  S.savedDescriptor = own.descriptor;
  S.wrapper = makeWrapper();

  try {
    if (own.ownership === "prototype") {
      Object.defineProperty(located.instance, LAD_KEY, {
        value: S.wrapper, writable: true, enumerable: false, configurable: true,
      });
    } else {
      Object.defineProperty(located.instance, LAD_KEY, {
        ...own.descriptor, value: S.wrapper,
      });
    }
  } catch {
    return unsupported("wrap-define-failed");
  }
  if (located.instance[LAD_KEY] !== S.wrapper) return unsupported("wrap-verify-failed");

  markArticle(cell);
  S.phase = "active";
  S.stats.installs++;
  startHealth();
  watchCell();
  return activeResult("installed");
}

function activeResult(note) {
  return {
    type: "ACTIVE", note,
    focusUrlId: S.focusUrlId,
    focusItemKey: S.focusItemKey,
    ownership: S.ownership,
    gen: S.gen,
    reqNonce: S.reqNonce,
  };
}

function unsupported(reason) {
  // zero side effects: nothing was wrapped, nothing marked (contract §4)
  S.phase = "idle";
  S.lastError = reason;
  return { type: "UNSUPPORTED", reason, focusUrlId: S.focusUrlId, gen: S.gen };
}

function markArticleNode(art) {
  try {
    art.setAttribute(LAD_MARK_ARTICLE, "");
    S.article = art;
    return true;
  } catch { S.article = null; return false; }
}

function markArticle(cell) {
  const art = articleInCell(cell);
  if (art) markArticleNode(art);
}

function unmarkArticle() {
  try { S.article?.removeAttribute(LAD_MARK_ARTICLE); } catch { /* node already gone */ }
  S.article = null;
}

// ---- P1-B: focal article binding maintenance ----

function watchCell() {
  stopCellWatch();
  if (typeof MutationObserver === "undefined" || !S.cell) return;
  try {
    S.cellObserver = new MutationObserver(() => scheduleArticleVerify());
    S.cellObserver.observe(S.cell, { childList: true, subtree: true });
  } catch { S.cellObserver = null; }
}

function stopCellWatch() {
  try { S.cellObserver?.disconnect(); } catch { /* already gone */ }
  S.cellObserver = null;
  if (S.articleTimer) { clearTimeout(S.articleTimer); S.articleTimer = 0; }
  if (S.articleSettleTimer) { clearTimeout(S.articleSettleTimer); S.articleSettleTimer = 0; }
}

function scheduleArticleVerify(delay = LAD_ARTICLE_SETTLE_MS) {
  if (S.phase !== "active") return;
  if (S.articleTimer) return; // a check is already pending — coalesce
  S.articleTimer = setTimeout(() => {
    S.articleTimer = 0;
    verifyArticleBinding();
  }, delay);
}

// X may replace the article INSIDE a kept cell (hydration, content swap).
// The marker must follow — but only onto an article proven to still be the
// focus. Anything unconfirmable exits; we never pin an article we cannot vouch
// for, and we never move/clone React-managed nodes (attribute writes only).
export function verifyArticleBinding() {
  const s = S;
  if (s.phase !== "active" || !s.cell?.isConnected) return;
  const cur = articleInCell(s.cell);
  if (cur === s.article) {
    if (cur) s.articleGoneSince = 0;
    return; // unchanged (the common case)
  }
  if (!cur) {
    // transient hydration gap: tolerate briefly, exit if it stays empty
    if (!s.articleGoneSince) s.articleGoneSince = performance.now();
    else if (performance.now() - s.articleGoneSince > LAD_ARTICLE_GONE_MS) {
      safeExit("focal-article-vanished");
    }
    return;
  }
  s.articleGoneSince = 0;
  if (articleMatchesStatus(cur, s.focusUrlId)) {
    unmarkArticle();
    markArticleNode(cur);
    s.stats.articleRebinds++;
  } else {
    // a different post's article now occupies the focal cell (or the DOM lost
    // the timestamp link we bind by) — fail closed rather than pin wrong
    s.stats.articleRebindRefusals++;
    safeExit("focal-article-replaced-unconfirmed");
  }
}

// ---- health check (bounded, MAIN-world interval; contract §5/§6) ----

function startHealth() {
  stopHealth();
  S.healthTimer = setInterval(healthTick, LAD_HEALTH_INTERVAL_MS);
}
function stopHealth() {
  if (S.healthTimer) { clearInterval(S.healthTimer); S.healthTimer = 0; }
}

export function healthTick() {
  const s = S;
  if (s.phase !== "active") return;
  // route moved on: graceful stop (the controller usually got there first)
  if (statusIdFromPath() !== s.focusUrlId) {
    const r = doUninstall("route-moved");
    if (S.phase === "residue-locked") {
      // P1-A: the graceful exit could not restore the method — the controller
      // must hear the restore failure, not a clean route-moved
      emit("HEALTH_ERROR", { reason: S.lastError, exitReason: "route-moved", restored: false });
      return;
    }
    emit("HEALTH_UNINSTALLED", { reason: "route-moved", restored: r.restored });
    return;
  }
  // the wrap is gone (X replaced the method itself): never clobber X's new
  // value — exit and report (contract §8 case 2)
  if (s.instance[LAD_KEY] !== s.wrapper) { safeExit("wrapper-replaced"); return; }
  // shape drift
  if (typeof s.instance[LAD_KEY] !== "function" ||
      !Array.isArray(s.instance.props?.list) ||
      typeof s.instance._cells?.get !== "function") {
    safeExit("shape-drift"); return;
  }
  // P1-B: same-cell article swaps are caught promptly by the cell observer,
  // but the health tick re-verifies anyway (backstop against lost events)
  verifyArticleBinding();
  if (s.phase !== "active") return; // verify may have exited
  // focal cell lifecycle: rebind on rebuild, bounded re-install on instance
  // replacement, exit when the focus cannot be kept (contract §6)
  if (!s.cell?.isConnected) {
    const found = focalCellByStatusId(s.focusUrlId);
    const remapped = found && found.isConnected &&
      s.instance._cells.get(s.focusItemKey)?.getElement?.() === found;
    if (remapped) {
      s.cell = found;
      stopCellWatch();
      unmarkArticle();
      markArticle(found);
      watchCell();
      s.missStreak = 0;
      return;
    }
    if (found && found.isConnected && s.reinstallLeft > 0) {
      const r = install({ focusUrlId: s.focusUrlId, internalReinstall: true });
      if (r.type === "ACTIVE") { emit("HEALTH_ACTIVE", { note: "reinstalled", focusItemKey: r.focusItemKey }); return; }
      safeExit("reinstall-failed:" + (r.reason || r.type));
      return;
    }
    s.missStreak++;
    if (s.missStreak >= LAD_CELL_MISS_TICKS) {
      safeExit(found ? "focal-cell-unmappable" : "focal-cell-gone");
    }
    return;
  }
  s.missStreak = 0;
}

function safeExit(reason) {
  const r = doUninstall(reason);
  if (S.phase === "residue-locked") {
    // P1-A: the restore failed — its own error is the truth; never overwrite it
    emit("HEALTH_ERROR", { reason: S.lastError, exitReason: reason, restored: false });
    return;
  }
  S.lastError = reason;
  S.phase = "error";
  emit("HEALTH_ERROR", { reason, restored: r.restored });
}

// ---- uninstall: ownership-aware restore (contract §8 — NOT a plain assign) ----

export function uninstall({ reason, focusUrlId } = {}) {
  // P0-A: an UNINSTALL command names the session it wants released. A stale
  // release for an old focus must never tear down a newer session's wrap.
  if (focusUrlId && S.phase === "active" && S.focusUrlId !== focusUrlId) {
    return { type: "UNINSTALLED", reason: reason || "requested", restored: false, note: "focus-mismatch-ignored" };
  }
  const r = doUninstall(reason || "requested");
  // the returned UNINSTALLED is the wire response; no extra broadcast needed —
  // self-initiated exits (health tick) are the ones that emit
  if (r.type === "ERROR") return r;
  return { type: "UNINSTALLED", reason: r.reason, restored: r.restored, note: r.note };
}

function lockResidue(reason) {
  // P1-A: keep every reference needed to understand (never reuse) the wrap we
  // could not remove. Retained until page destroy; S is NOT reset, so the
  // wrapper's own passthrough (phase !== active → s.original.apply) keeps X
  // rendering, and install() refuses any new session on this page.
  S.residueLock = {
    reason,
    focusUrlId: S.focusUrlId,
    gen: S.gen,
    hasInstance: Boolean(S.instance),
    hasWrapper: Boolean(S.wrapper),
    hasOriginal: Boolean(S.original),
    ownership: S.ownership,
    lockedAt: Date.now(),
  };
  S.phase = "residue-locked";
  S.lastError = reason;
  S.stats.uninstalls++;
}

function doUninstall(reason) {
  if (S.phase !== "active") {
    return { type: "UNINSTALLED", reason, restored: false, note: "not-active" };
  }
  stopHealth();
  stopCellWatch();
  unmarkArticle();
  const inst = S.instance;
  let restored = false;
  let note = "";
  if (inst && S.wrapper) {
    const cur = inst[LAD_KEY];
    if (cur === S.wrapper) {
      try {
        if (S.ownership === "prototype") {
          delete inst[LAD_KEY]; // remove the shadow entirely — prototype lookup restored
        } else {
          Object.defineProperty(inst, LAD_KEY, { ...S.savedDescriptor, value: S.original });
        }
        restored = inst[LAD_KEY] === S.original;
        note = S.ownership === "prototype" ? "prototype-restored" : "descriptor-restored";
        if (!restored) {
          lockResidue("restore-verify-failed");
          return { type: "ERROR", reason: "restore-verify-failed", restored: false };
        }
      } catch {
        // configurable was verified at install; reaching here means the world
        // changed underneath us — report honestly instead of faking success
        lockResidue("restore-threw");
        return { type: "ERROR", reason: "restore-threw", restored: false };
      }
    } else {
      // X already replaced/removed the wrap on its own — leave the current
      // value untouched (overwriting it could clobber X's newer method)
      note = "already-replaced";
    }
  }
  const stats = S.stats;
  const focusUrlId = S.focusUrlId;
  const gen = S.gen;
  const reqNonce = S.reqNonce;
  S = freshState();
  S.stats = stats;
  S.gen = gen;                  // generation survives the reset for diagnostics
  S.reqNonce = reqNonce;
  S.focusUrlId = focusUrlId; // keep for diagnostics; phase is idle
  S.stats.uninstalls++;
  return { type: "UNINSTALLED", reason, restored, note };
}

// ---- diagnostics ----

export function query() {
  const residueLocked = S.phase === "residue-locked";
  return {
    phase: S.phase,
    gen: S.gen,
    focusUrlId: S.focusUrlId,
    focusItemKey: S.focusItemKey,
    ownership: S.ownership,
    hasInstance: Boolean(S.instance),
    cellConnected: Boolean(S.cell?.isConnected),
    cellObserverArmed: Boolean(S.cellObserver),
    reinstallLeft: S.reinstallLeft,
    lastError: S.lastError,
    // contract §8.3: a restore that threw/failed verification may leave the
    // wrap on a stale instance — the only clean recovery is a page refresh;
    // surface it (P1-A: also as the explicit residue-locked phase)
    possibleResidue: residueLocked || (S.phase === "error" &&
      (S.lastError === "restore-threw" || S.lastError === "restore-verify-failed")),
    residueLock: residueLocked ? { ...S.residueLock } : null,
    stats: { ...S.stats },
  };
}
