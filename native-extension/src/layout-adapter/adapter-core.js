// Peek M2-B1 — X layout adapter CORE (runs in the MAIN world).
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

import {
  LAD_KEY, LAD_MARK_ARTICLE,
  LAD_HEALTH_INTERVAL_MS, LAD_REINSTALL_BUDGET, LAD_CELL_MISS_TICKS
} from "./constants.js";
import { statusIdFromPath } from "../constants.js";
import { focalCellByStatusId } from "../focal-extractor.js";

const FIBER_KEY_PREFIXES = ["__reactFiber", "__reactInternalInstance"];
const SAMPLE_EVERY = 64; // perf sampling rate (S5): counters are free, timing is not

// ---- module-singleton state (one adapter per page — contract §3) ----
let S = freshState();

function freshState() {
  return {
    phase: "idle",            // idle | active | error
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
    missStreak: 0,
    reinstallLeft: LAD_REINSTALL_BUDGET,
    lastError: null,
    stats: {
      installs: 0, uninstalls: 0, calls: 0, injections: 0,
      naturalSightings: 0, sampledWrapperMs: 0, sampledOriginalMs: 0, samples: 0,
    },
  };
}

// MAIN entry registers a notifier (posts transitions to the ISOLATED world).
let notify = null;
export function setNotifier(fn) { notify = typeof fn === "function" ? fn : null; }
function emit(type, extra = {}) {
  if (!notify) return;
  try { notify({ type, focusUrlId: S.focusUrlId, ...extra }); } catch { /* never let reporting break the adapter */ }
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

// ---- wrapper ----

function makeWrapper() {
  return function wrapped(...args) {
    const s = S;
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

export function install({ focusUrlId, internalReinstall = false } = {}) {
  if (!focusUrlId || typeof focusUrlId !== "string") return { type: "UNSUPPORTED", reason: "bad-focus-id" };
  // the bounded re-install budget is consumed by successful internal
  // re-installs of ONE focus session; a route-driven install resets it
  const budget = internalReinstall ? Math.max(0, S.reinstallLeft - 1) : LAD_REINSTALL_BUDGET;
  if (S.phase === "active") {
    // same-focus idempotency applies to ROUTE-driven installs only; an
    // internal re-install means the instance was replaced underneath us
    if (S.focusUrlId === focusUrlId && !internalReinstall) return activeResult("already-active");
    const down = doUninstall(internalReinstall ? "instance-replaced" : "reinstall");
    if (down.type !== "UNINSTALLED") return { type: "ERROR", reason: "reinstall-uninstall-failed" };
  }
  const stats = S.stats;
  S = freshState();
  S.stats = stats;              // aggregate counters survive re-installs (S5)
  S.reinstallLeft = budget;
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
  return activeResult("installed");
}

function activeResult(note) {
  return {
    type: "ACTIVE", note,
    focusUrlId: S.focusUrlId,
    focusItemKey: S.focusItemKey,
    ownership: S.ownership,
  };
}

function unsupported(reason) {
  // zero side effects: nothing was wrapped, nothing marked (contract §4)
  S.phase = "idle";
  S.lastError = reason;
  return { type: "UNSUPPORTED", reason, focusUrlId: S.focusUrlId };
}

function markArticle(cell) {
  try {
    const art = cell.querySelector("article[data-testid='tweet']") || cell.querySelector("article");
    if (art) {
      art.setAttribute(LAD_MARK_ARTICLE, "");
      S.article = art;
    }
  } catch { S.article = null; } // layout CSS simply won't pin an unmarked article
}

function unmarkArticle() {
  try { S.article?.removeAttribute(LAD_MARK_ARTICLE); } catch { /* node already gone */ }
  S.article = null;
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
    emit("UNINSTALLED", { reason: "route-moved", restored: r.restored });
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
  // focal cell lifecycle: rebind on rebuild, bounded re-install on instance
  // replacement, exit when the focus cannot be kept (contract §6)
  if (!s.cell?.isConnected) {
    const found = focalCellByStatusId(s.focusUrlId);
    const remapped = found && found.isConnected &&
      s.instance._cells.get(s.focusItemKey)?.getElement?.() === found;
    if (remapped) {
      s.cell = found;
      unmarkArticle();
      markArticle(found);
      s.missStreak = 0;
      return;
    }
    if (found && found.isConnected && s.reinstallLeft > 0) {
      const r = install({ focusUrlId: s.focusUrlId, internalReinstall: true });
      if (r.type === "ACTIVE") { emit("ACTIVE", { note: "reinstalled", focusItemKey: r.focusItemKey }); return; }
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
  S.lastError = reason;
  S.phase = "error";
  emit("ERROR", { reason, restored: r.restored });
}

// ---- uninstall: ownership-aware restore (contract §8 — NOT a plain assign) ----

export function uninstall({ reason } = {}) {
  const r = doUninstall(reason || "requested");
  // the returned UNINSTALLED is the wire response; no extra broadcast needed —
  // self-initiated exits (health tick) are the ones that emit
  if (r.type === "ERROR") return r;
  return { type: "UNINSTALLED", reason: r.reason, restored: r.restored, note: r.note };
}

function doUninstall(reason) {
  if (S.phase !== "active") {
    return { type: "UNINSTALLED", reason, restored: false, note: "not-active" };
  }
  stopHealth();
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
          S.phase = "error";
          S.lastError = "restore-verify-failed";
          S.stats.uninstalls++;
          return { type: "ERROR", reason: "restore-verify-failed", restored: false };
        }
      } catch {
        // configurable was verified at install; reaching here means the world
        // changed underneath us — report honestly instead of faking success
        S.phase = "error";
        S.lastError = "restore-threw";
        S.stats.uninstalls++;
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
  S = freshState();
  S.stats = stats;
  S.focusUrlId = focusUrlId; // keep for diagnostics; phase is idle
  S.stats.uninstalls++;
  return { type: "UNINSTALLED", reason, restored, note };
}

// ---- diagnostics ----

export function query() {
  return {
    phase: S.phase,
    focusUrlId: S.focusUrlId,
    focusItemKey: S.focusItemKey,
    ownership: S.ownership,
    hasInstance: Boolean(S.instance),
    cellConnected: Boolean(S.cell?.isConnected),
    reinstallLeft: S.reinstallLeft,
    lastError: S.lastError,
    stats: { ...S.stats },
  };
}
