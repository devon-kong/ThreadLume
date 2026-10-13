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
  var LAD_ARTICLE_SETTLE_MS = 120;
  var LAD_ARTICLE_GONE_MS = 3e3;

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
  var genSeq = 0;
  function freshState() {
    return {
      phase: "idle",
      // idle | active | error | residue-locked
      gen: 0,
      // session generation (P0-A): increments per install
      reqNonce: null,
      // nonce of the INSTALL request that created it
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
      cellObserver: null,
      // P1-B: focal-cell article-swap watcher
      articleTimer: 0,
      // P1-B: debounced re-verification
      articleGoneSince: 0,
      // P1-B: first moment the article was seen absent
      articleSettleTimer: 0,
      // P1-B: coalesce attribute churn on a fresh bind
      missStreak: 0,
      reinstallLeft: LAD_REINSTALL_BUDGET,
      lastError: null,
      residueLock: null,
      // P1-A: set only in the residue-locked phase
      stats: {
        installs: 0,
        uninstalls: 0,
        calls: 0,
        injections: 0,
        naturalSightings: 0,
        sampledWrapperMs: 0,
        sampledOriginalMs: 0,
        samples: 0,
        articleRebinds: 0,
        articleRebindRefusals: 0
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
      notify({
        type,
        gen: S.gen,
        reqNonce: S.reqNonce ?? null,
        focusUrlId: S.focusUrlId,
        ...extra
      });
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
  function articleInCell(cell) {
    try {
      return cell?.querySelector("article[data-testid='tweet']") || cell?.querySelector("article") || null;
    } catch {
      return null;
    }
  }
  function articleMatchesStatus(art, statusId) {
    if (!art || !statusId) return false;
    try {
      return [...art.querySelectorAll("a[href] time")].some((t) => {
        const href = t.closest("a")?.getAttribute("href") || "";
        return new RegExp(`/status/${statusId}(?:$|[?#])`).test(href);
      });
    } catch {
      return false;
    }
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
  function install({ focusUrlId, reqNonce = null, internalReinstall = false } = {}) {
    if (!focusUrlId || typeof focusUrlId !== "string") return { type: "UNSUPPORTED", reason: "bad-focus-id" };
    if (S.phase === "residue-locked") {
      return { type: "ERROR", reason: "residue-locked", focusUrlId };
    }
    const budget = internalReinstall ? Math.max(0, S.reinstallLeft - 1) : LAD_REINSTALL_BUDGET;
    if (S.phase === "active") {
      if (S.focusUrlId === focusUrlId && !internalReinstall) return activeResult("already-active");
      const down = doUninstall(internalReinstall ? "instance-replaced" : "reinstall");
      if (down.type !== "UNINSTALLED") {
        return { type: "ERROR", reason: `reinstall-uninstall-failed:${down.reason}`, phase: S.phase };
      }
    }
    const stats = S.stats;
    S = freshState();
    S.stats = stats;
    S.reinstallLeft = budget;
    S.gen = ++genSeq;
    S.reqNonce = reqNonce;
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
    watchCell();
    return activeResult("installed");
  }
  function activeResult(note) {
    return {
      type: "ACTIVE",
      note,
      focusUrlId: S.focusUrlId,
      focusItemKey: S.focusItemKey,
      ownership: S.ownership,
      gen: S.gen,
      reqNonce: S.reqNonce
    };
  }
  function unsupported(reason) {
    S.phase = "idle";
    S.lastError = reason;
    return { type: "UNSUPPORTED", reason, focusUrlId: S.focusUrlId, gen: S.gen };
  }
  function markArticleNode(art) {
    try {
      art.setAttribute(LAD_MARK_ARTICLE, "");
      S.article = art;
      return true;
    } catch {
      S.article = null;
      return false;
    }
  }
  function markArticle(cell) {
    const art = articleInCell(cell);
    if (art) markArticleNode(art);
  }
  function unmarkArticle() {
    try {
      S.article?.removeAttribute(LAD_MARK_ARTICLE);
    } catch {
    }
    S.article = null;
  }
  function watchCell() {
    stopCellWatch();
    if (typeof MutationObserver === "undefined" || !S.cell) return;
    try {
      S.cellObserver = new MutationObserver(() => scheduleArticleVerify());
      S.cellObserver.observe(S.cell, { childList: true, subtree: true });
    } catch {
      S.cellObserver = null;
    }
  }
  function stopCellWatch() {
    try {
      S.cellObserver?.disconnect();
    } catch {
    }
    S.cellObserver = null;
    if (S.articleTimer) {
      clearTimeout(S.articleTimer);
      S.articleTimer = 0;
    }
    if (S.articleSettleTimer) {
      clearTimeout(S.articleSettleTimer);
      S.articleSettleTimer = 0;
    }
  }
  function scheduleArticleVerify(delay = LAD_ARTICLE_SETTLE_MS) {
    if (S.phase !== "active") return;
    if (S.articleTimer) return;
    S.articleTimer = setTimeout(() => {
      S.articleTimer = 0;
      verifyArticleBinding();
    }, delay);
  }
  function verifyArticleBinding() {
    const s = S;
    if (s.phase !== "active" || !s.cell?.isConnected) return;
    const cur = articleInCell(s.cell);
    if (cur === s.article) {
      if (cur) s.articleGoneSince = 0;
      return;
    }
    if (!cur) {
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
      s.stats.articleRebindRefusals++;
      safeExit("focal-article-replaced-unconfirmed");
    }
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
      if (S.phase === "residue-locked") {
        emit("HEALTH_ERROR", { reason: S.lastError, exitReason: "route-moved", restored: false });
        return;
      }
      emit("HEALTH_UNINSTALLED", { reason: "route-moved", restored: r.restored });
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
    verifyArticleBinding();
    if (s.phase !== "active") return;
    if (!s.cell?.isConnected) {
      const found = focalCellByStatusId(s.focusUrlId);
      const remapped = found && found.isConnected && s.instance._cells.get(s.focusItemKey)?.getElement?.() === found;
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
        if (r.type === "ACTIVE") {
          emit("HEALTH_ACTIVE", { note: "reinstalled", focusItemKey: r.focusItemKey });
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
    if (S.phase === "residue-locked") {
      emit("HEALTH_ERROR", { reason: S.lastError, exitReason: reason, restored: false });
      return;
    }
    S.lastError = reason;
    S.phase = "error";
    emit("HEALTH_ERROR", { reason, restored: r.restored });
  }
  function uninstall({ reason, focusUrlId } = {}) {
    if (focusUrlId && S.phase === "active" && S.focusUrlId !== focusUrlId) {
      return { type: "UNINSTALLED", reason: reason || "requested", restored: false, note: "focus-mismatch-ignored" };
    }
    const r = doUninstall(reason || "requested");
    if (r.type === "ERROR") return r;
    return { type: "UNINSTALLED", reason: r.reason, restored: r.restored, note: r.note };
  }
  function lockResidue(reason) {
    S.residueLock = {
      reason,
      focusUrlId: S.focusUrlId,
      gen: S.gen,
      hasInstance: Boolean(S.instance),
      hasWrapper: Boolean(S.wrapper),
      hasOriginal: Boolean(S.original),
      ownership: S.ownership,
      lockedAt: Date.now()
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
            delete inst[LAD_KEY];
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
          lockResidue("restore-threw");
          return { type: "ERROR", reason: "restore-threw", restored: false };
        }
      } else {
        note = "already-replaced";
      }
    }
    const stats = S.stats;
    const focusUrlId = S.focusUrlId;
    const gen = S.gen;
    const reqNonce = S.reqNonce;
    S = freshState();
    S.stats = stats;
    S.gen = gen;
    S.reqNonce = reqNonce;
    S.focusUrlId = focusUrlId;
    S.stats.uninstalls++;
    return { type: "UNINSTALLED", reason, restored, note };
  }
  function query() {
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
      possibleResidue: residueLocked || S.phase === "error" && (S.lastError === "restore-threw" || S.lastError === "restore-verify-failed"),
      residueLock: residueLocked ? { ...S.residueLock } : null,
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
          post(install({
            focusUrlId: typeof m.focusUrlId === "string" ? m.focusUrlId : "",
            reqNonce: typeof m.nonce === "number" ? m.nonce : null
          }), m.nonce);
          break;
        case LAD_UNINSTALL:
          post(uninstall({
            reason: typeof m.reason === "string" ? m.reason : "requested",
            focusUrlId: typeof m.focusUrlId === "string" ? m.focusUrlId : void 0
          }), m.nonce);
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
        healthTick,
        verifyArticleBinding
        // P1-B direct drive
      };
    }
  })();
})();
