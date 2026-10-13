// Peek Native (M2-B1 lab) — MAIN-world layout adapter. Source: native-extension/src/layout-adapter/*
(() => {
  // native-extension/src/layout-adapter/constants.js
  var LAD_NS = "peek-lad";
  var LAD_FROM_ISOLATED = "isolated";
  var LAD_FROM_MAIN = "main";
  var LAD_INSTALL = "INSTALL";
  var LAD_UNINSTALL = "UNINSTALL";
  var LAD_QUERY = "QUERY";
  var LAD_KEY = "_getFinalRenderedItems";
  var LAD_MARK_ARTICLE = "data-peek-lad-focal";
  var LAD_HEALTH_INTERVAL_MS = 1500;
  var LAD_REINSTALL_BUDGET = 2;
  var LAD_CELL_MISS_TICKS = 2;

  // native-extension/src/constants.js
  var NS = "peek-native";
  var PANE_ID = `${NS}-pane`;
  var STYLE_ID = `${NS}-style`;
  var statusIdFromPath = () => (location.pathname.match(/\/status\/(\d+)/) || [])[1] || null;

  // native-extension/src/focal-extractor.js
  function focalCellByStatusId(focalId) {
    return [...document.querySelectorAll('[data-testid="cellInnerDiv"]')].find((cell) => [...cell.querySelectorAll(`a[href*="/status/${focalId}"]`)].some((a) => a.querySelector("time") && !a.closest('div[role="link"]')));
  }

  // native-extension/src/layout-adapter/adapter-core.js
  var FIBER_KEY_PREFIXES = ["__reactFiber", "__reactInternalInstance"];
  var SAMPLE_EVERY = 64;
  var S = freshState();
  function freshState() {
    return {
      phase: "idle",
      // idle | active | error
      focusUrlId: null,
      focusItemKey: null,
      instance: null,
      cell: null,
      article: null,
      // the DOM node carrying the layout marker
      entrySnapshot: null,
      // freshest rendered entry seen for the focus item
      wrapper: null,
      original: null,
      ownership: null,
      // "prototype" | "own-data"
      savedDescriptor: null,
      healthTimer: 0,
      missStreak: 0,
      reinstallLeft: LAD_REINSTALL_BUDGET,
      lastError: null,
      stats: {
        installs: 0,
        uninstalls: 0,
        calls: 0,
        injections: 0,
        naturalSightings: 0,
        sampledWrapperMs: 0,
        sampledOriginalMs: 0,
        samples: 0
      }
    };
  }
  var notify = null;
  function setNotifier(fn) {
    notify = typeof fn === "function" ? fn : null;
  }
  function emit(type, extra = {}) {
    if (!notify) return;
    try {
      notify({ type, focusUrlId: S.focusUrlId, ...extra });
    } catch {
    }
  }
  function fiberKeyOf(node) {
    if (!node) return null;
    try {
      return Object.keys(node).find((k) => FIBER_KEY_PREFIXES.some((p) => k.startsWith(p))) || null;
    } catch {
      return null;
    }
  }
  function locateVirtualizer(cell) {
    if (!cell) return { ok: false, reason: "no-cell" };
    const key = fiberKeyOf(cell);
    if (!key) return { ok: false, reason: "no-fiber-key" };
    let fiber = cell[key];
    while (fiber && !(fiber.stateNode && typeof fiber.stateNode[LAD_KEY] === "function")) fiber = fiber.return;
    const v = fiber ? fiber.stateNode : null;
    if (!v) return { ok: false, reason: "virtualizer-not-found" };
    return { ok: true, instance: v };
  }
  function validateInstance(instance) {
    if (!Array.isArray(instance.props?.list)) return { ok: false, reason: "props-list-missing" };
    if (typeof instance._cells?.get !== "function") return { ok: false, reason: "cells-map-missing" };
    let rendered;
    try {
      rendered = instance[LAD_KEY]();
    } catch {
      return { ok: false, reason: "final-items-threw" };
    }
    if (!Array.isArray(rendered)) return { ok: false, reason: "final-items-not-array" };
    return { ok: true, rendered };
  }
  function mapFocalEntry(instance, cell, rendered) {
    try {
      const entry = rendered.find((x) => x && typeof x === "object" && x.item && x.item.id != null && instance._cells.get(x.item.id)?.getElement?.() === cell);
      if (!entry) return { ok: false, reason: "focal-entry-not-mapped" };
      return { ok: true, entry, focusItemKey: entry.item.id };
    } catch {
      return { ok: false, reason: "focal-entry-not-mapped" };
    }
  }
  function inspectOwnership(instance) {
    let d = null;
    try {
      d = Object.getOwnPropertyDescriptor(instance, LAD_KEY);
    } catch {
      d = null;
    }
    if (!d) {
      if (Object.isSealed(instance) || Object.isFrozen(instance) || !Object.isExtensible(instance)) {
        return { ok: false, reason: "instance-sealed" };
      }
      return { ok: true, ownership: "prototype", descriptor: null };
    }
    if (d.get || d.set) return { ok: false, reason: "accessor-descriptor" };
    if (d.configurable === false) return { ok: false, reason: "non-configurable" };
    return { ok: true, ownership: "own-data", descriptor: { ...d } };
  }
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
        if (this !== s.instance) {
          result = items;
        } else if (statusIdFromPath() !== s.focusUrlId) {
          result = items;
        } else if (!Array.isArray(items)) {
          result = items;
        } else {
          const focusKey = s.focusItemKey;
          const live = items.find((x) => x && x.item && x.item.id === focusKey);
          if (live) {
            s.entrySnapshot = live;
            s.stats.naturalSightings++;
            result = items;
          } else {
            const list = this.props?.list;
            const currentItem = Array.isArray(list) ? list.find((x) => x && x.id === focusKey) : null;
            const snap = s.entrySnapshot;
            if (!currentItem || !snap || typeof snap !== "object") {
              result = items;
            } else {
              s.stats.injections++;
              result = [{ ...snap, item: currentItem, offset: 0, visible: true }, ...items];
            }
          }
        }
      } catch {
        result = items;
      }
      if (sample) s.stats.sampledWrapperMs += performance.now() - t0;
      return result;
    };
  }
  function install({ focusUrlId, internalReinstall = false } = {}) {
    if (!focusUrlId || typeof focusUrlId !== "string") return { type: "UNSUPPORTED", reason: "bad-focus-id" };
    const budget = internalReinstall ? Math.max(0, S.reinstallLeft - 1) : LAD_REINSTALL_BUDGET;
    if (S.phase === "active") {
      if (S.focusUrlId === focusUrlId && !internalReinstall) return activeResult("already-active");
      const down = doUninstall(internalReinstall ? "instance-replaced" : "reinstall");
      if (down.type !== "UNINSTALLED") return { type: "ERROR", reason: "reinstall-uninstall-failed" };
    }
    const stats = S.stats;
    S = freshState();
    S.stats = stats;
    S.reinstallLeft = budget;
    S.focusUrlId = focusUrlId;
    const cell = focalCellByStatusId(focusUrlId);
    if (!cell) return unsupported("focal-cell-not-found");
    if (!cell.isConnected) return unsupported("focal-cell-detached");
    const located = locateVirtualizer(cell);
    if (!located.ok) return unsupported(located.reason);
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
          value: S.wrapper,
          writable: true,
          enumerable: false,
          configurable: true
        });
      } else {
        Object.defineProperty(located.instance, LAD_KEY, {
          ...own.descriptor,
          value: S.wrapper
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
      type: "ACTIVE",
      note,
      focusUrlId: S.focusUrlId,
      focusItemKey: S.focusItemKey,
      ownership: S.ownership
    };
  }
  function unsupported(reason) {
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
    } catch {
      S.article = null;
    }
  }
  function unmarkArticle() {
    try {
      S.article?.removeAttribute(LAD_MARK_ARTICLE);
    } catch {
    }
    S.article = null;
  }
  function startHealth() {
    stopHealth();
    S.healthTimer = setInterval(healthTick, LAD_HEALTH_INTERVAL_MS);
  }
  function stopHealth() {
    if (S.healthTimer) {
      clearInterval(S.healthTimer);
      S.healthTimer = 0;
    }
  }
  function healthTick() {
    const s = S;
    if (s.phase !== "active") return;
    if (statusIdFromPath() !== s.focusUrlId) {
      const r = doUninstall("route-moved");
      emit("UNINSTALLED", { reason: "route-moved", restored: r.restored });
      return;
    }
    if (s.instance[LAD_KEY] !== s.wrapper) {
      safeExit("wrapper-replaced");
      return;
    }
    if (typeof s.instance[LAD_KEY] !== "function" || !Array.isArray(s.instance.props?.list) || typeof s.instance._cells?.get !== "function") {
      safeExit("shape-drift");
      return;
    }
    if (!s.cell?.isConnected) {
      const found = focalCellByStatusId(s.focusUrlId);
      const remapped = found && found.isConnected && s.instance._cells.get(s.focusItemKey)?.getElement?.() === found;
      if (remapped) {
        s.cell = found;
        unmarkArticle();
        markArticle(found);
        s.missStreak = 0;
        return;
      }
      if (found && found.isConnected && s.reinstallLeft > 0) {
        const r = install({ focusUrlId: s.focusUrlId, internalReinstall: true });
        if (r.type === "ACTIVE") {
          emit("ACTIVE", { note: "reinstalled", focusItemKey: r.focusItemKey });
          return;
        }
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
  function uninstall({ reason } = {}) {
    const r = doUninstall(reason || "requested");
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
            delete inst[LAD_KEY];
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
          S.phase = "error";
          S.lastError = "restore-threw";
          S.stats.uninstalls++;
          return { type: "ERROR", reason: "restore-threw", restored: false };
        }
      } else {
        note = "already-replaced";
      }
    }
    const stats = S.stats;
    const focusUrlId = S.focusUrlId;
    S = freshState();
    S.stats = stats;
    S.focusUrlId = focusUrlId;
    S.stats.uninstalls++;
    return { type: "UNINSTALLED", reason, restored, note };
  }
  function query() {
    return {
      phase: S.phase,
      focusUrlId: S.focusUrlId,
      focusItemKey: S.focusItemKey,
      ownership: S.ownership,
      hasInstance: Boolean(S.instance),
      cellConnected: Boolean(S.cell?.isConnected),
      reinstallLeft: S.reinstallLeft,
      lastError: S.lastError,
      stats: { ...S.stats }
    };
  }

  // native-extension/src/layout-adapter/main-world-entry.js
  (() => {
    if (window.__peekLayoutAdapterMainInstalled) return;
    window.__peekLayoutAdapterMainInstalled = true;
    const pageOrigin = () => {
      try {
        return window.location.origin;
      } catch {
        return "";
      }
    };
    const post = (payload, nonce) => {
      try {
        window.postMessage({ ns: LAD_NS, from: LAD_FROM_MAIN, nonce, ...payload }, pageOrigin());
      } catch {
      }
    };
    setNotifier((msg) => post(msg, null));
    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      if (event.origin !== pageOrigin()) return;
      const m = event.data;
      if (!m || typeof m !== "object" || m.ns !== LAD_NS || m.from !== LAD_FROM_ISOLATED) return;
      switch (m.type) {
        case LAD_INSTALL:
          post(install({ focusUrlId: typeof m.focusUrlId === "string" ? m.focusUrlId : "" }), m.nonce);
          break;
        case LAD_UNINSTALL:
          post(uninstall({ reason: typeof m.reason === "string" ? m.reason : "requested" }), m.nonce);
          break;
        case LAD_QUERY:
          post({ type: "STATE", state: query() }, m.nonce);
          break;
        default:
          break;
      }
    });
    if (window.__PEEK_NATIVE_TEST__) {
      window.__peekLayoutAdapterTest = {
        install,
        uninstall,
        query,
        healthTick
      };
    }
  })();
})();
