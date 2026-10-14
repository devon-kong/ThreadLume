// L4-S3 — real-user click coverage for the instant preview (m2a lab build).
//
// Every scenario uses a REAL pointer interaction in the live browser and
// records: whether a preview mounted (and when), whether it cleaned up, what
// X did natively, and any side effects. Structural pre-checks cover the
// action buttons that must never be physically clicked (like / repost /
// bookmark are real account writes — the zero-write rule forbids clicking
// them; the reply and share buttons are non-mutating and ARE clicked).
//
//globalThis.__RUN__ = "all"  (default) | a single scenario id
const RUN = typeof __RUN__ !== "undefined" ? __RUN__
  : (typeof process !== "undefined" && process.env?.RUN) || "all";
const task = await taskSpace("peek l4 click coverage");
const page = task.page("p1");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const record = (r) => { results.push(r); console.log(JSON.stringify(r)); };

// observe preview lifecycle from OUTSIDE the extension (MAIN world)
const OBS = `(function () {
  if (window.__covObs) return "rearmed";
  window.__covObs = true;
  window.__cov = { clicks: [], pv: [], lightbox: false, composer: false, menu: false, nav: null };
  window.addEventListener("click", (e) => {
    window.__cov.clicks.push({
      at: +performance.now().toFixed(1),
      tag: e.target.tagName,
      statusHref: (e.target.closest?.('a[href*="/status/"]')?.getAttribute("href") || null),
      ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey, alt: e.altKey, button: e.button,
    });
  }, { capture: true });
  window.__cov.born = performance.now();
  const loop = () => {
    const c = window.__cov;
    if (!c) return;
    c.born = c.born || performance.now();
    const p = document.getElementById("peek-lad-preview");
    c.pv.push({ at: +performance.now().toFixed(0), on: Boolean(p && p.isConnected), id: p?.dataset.statusId || null, len: p ? (p.textContent || "").trim().length : 0 });
    if (c.pv.length > 900) c.pv = c.pv.slice(-450);
    c.lightbox = Boolean(document.querySelector('[data-testid="lightbox"]'));
    c.composer = Boolean(document.querySelector('[data-testid="tweetTextarea"]'));
    c.menu = Boolean(document.querySelector('[data-testid="Dropdown"], [role="menu"]'));
    if (performance.now() - c.born < 60000) setTimeout(loop, 4); // rAF freezes on idle timelines — timer chain instead
  };
  setTimeout(loop, 4);
  return "installed";
})()`;
const obs = () => page.evaluate(OBS);
const readObs = () => page.evaluate(`(() => {
  const c = window.__cov || {};
  const on = c.pv?.filter(x => x.on) || [];
  return {
    clicks: c.clicks || [],
    pvOn: on.length > 0, pvFirstAt: on[0]?.at ?? null, pvLastAt: on[on.length - 1]?.at ?? null,
    pvId: on[0]?.id ?? null, pvLen: Math.max(0, ...(c.pv?.map(x => x.len) || [0])),
    pvNow: Boolean(document.getElementById("peek-lad-preview")),
    lightbox: c.lightbox, composer: c.composer, menu: c.menu,
    path: location.pathname.slice(0, 70),
  };
})()`);
const resetObs = () => page.evaluate(`(() => { if (window.__cov) { window.__cov.clicks = []; window.__cov.pv = []; window.__cov.lightbox = false; window.__cov.composer = false; window.__cov.menu = false; } return true; })()`);

// go to a list page and find a target cell's own timestamp link position
const GOTO_HOME = "https://x.com/home";
const findLinkDoc = (tid) => {
  const link = [...document.querySelectorAll("a[href] time")]
    .map((t) => t.closest("a"))
    .find((a) => (a.getAttribute("href") || "").includes("/status/" + tid) && !a.closest('div[role="link"]'));
  if (!link) return null;
  link.scrollIntoView({ block: "center" });
  const r = link.getBoundingClientRect();
  const x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2);
  const el = document.elementFromPoint(x, y);
  // verified in the SAME evaluate: the point sits in THIS link right now
  return el && el.closest('a[href*="/status/' + tid + '"]') ? { x, y } : { x, y, stale: true, at: el ? el.tagName : null };
};
async function findLink(id) {
  for (let i = 0; i < 10; i++) {
    const pos = await page.evaluate((tid) => {
      const link = [...document.querySelectorAll("a[href] time")]
        .map((t) => t.closest("a"))
        .find((a) => (a.getAttribute("href") || "").includes("/status/" + tid) && !a.closest('div[role="link"]'));
      if (!link) return null;
      link.scrollIntoView({ block: "center" });
      const r = link.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }, id);
    if (pos) return pos;
    await page.evaluate(() => window.scrollBy(0, 1000));
    await sleep(800);
  }
  return null;
}
async function findBodyText(id) {
  for (let i = 0; i < 10; i++) {
    const pos = await page.evaluate((tid) => {
      const cell = [...document.querySelectorAll('[data-testid="cellInnerDiv"]')]
        .find((c) => [...c.querySelectorAll("a[href] time")].some((t) => (t.closest("a")?.getAttribute("href") || "").includes("/status/" + tid) && !t.closest('div[role="link"]')));
      if (!cell) return null;
      const txt = cell.querySelector('[data-testid="tweetText"]');
      if (!txt) return null;
      txt.scrollIntoView({ block: "center" });
      const r = txt.getBoundingClientRect();
      return { x: Math.round(r.x + Math.min(120, r.width / 2)), y: Math.round(r.y + r.height / 2) };
    }, id);
    if (pos) return pos;
    await page.evaluate(() => window.scrollBy(0, 1000));
    await sleep(800);
  }
  return null;
}


// Coordinate-stable clicking: X's timeline reflows under lazy hydration, so a
// rect captured in one evaluate can be stale by the time the pointer click
// lands (observed live: clicks landing on unrelated DIVs). Verify in the SAME
// evaluate that the element under the computed point IS the target; retry.
async function precisePos(findFn, wantId, label, arg) {
  for (let i = 0; i < 6; i++) {
    const pos = await page.evaluate(findFn, arg);
    if (!pos) return null;
    const ok = await page.evaluate(({ x, y, id }) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return false;
      if (id) {
        const a = el.closest?.('a[href*="/status/' + id + '"]');
        return Boolean(a);
      }
      return Boolean(el.tagName === "IMG" || el.tagName === "VIDEO" || el.closest('[data-testid="reply"], div[role="link"], a[href]'));
    }, { ...pos, id: wantId });
    if (ok) return pos;
    await sleep(400);
  }
  return null;
}

// pick targets from the home timeline (public posts only)
await page.goto(GOTO_HOME);
await sleep(5000);
await obs();
// resolve a FRESH target of the requested kind — the home timeline refreshes
// on every return, so ids captured once go stale
async function pickTarget(kind, nth = 0) {
  await page.goto(GOTO_HOME);
  await sleep(4500);
  await obs(); // fresh document → the observer must be re-installed
  const targets = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('[data-testid="cellInnerDiv"]')];
    const out = [];
    for (const c of cells) {
      const art = c.querySelector("article");
      if (!art) continue;
      const own = [...art.querySelectorAll("a[href] time")]
        .map((t) => t.closest("a"))
        .find((a) => !a.closest('div[role="link"]') && /\/status\/\d+/.test(a.getAttribute("href") || ""));
      if (!own) continue;
      const id = (own.getAttribute("href").match(/\/status\/(\d+)/) || [])[1];
      out.push({
        id,
        hasQuote: Boolean(art.querySelector('div[role="link"]')),
        hasImage: Boolean(art.querySelector('img[src*="pbs.twimg.com/media"]')),
        hasVideo: Boolean(art.querySelector("video")),
        hasBody: Boolean(art.querySelector('[data-testid="tweetText"]')),
      });
      if (out.length >= 14) break;
    }
    return out;
  });
  const list = targets.filter((x) => x[kind]);
  return list[nth] || null;
}
const back = async () => { await page.goto(GOTO_HOME); await sleep(4000); await obs(); await resetObs(); };

const RUNSET = new Set(RUN === "all" ? ["all"] : RUN.split(","));
const run = (id) => RUNSET.has("all") || RUNSET.has(id);

// ---------- S1 timestamp click → instant preview ----------
if (run("timestamp")) {
  const s = await pickTarget("hasBody");
  if (!s) record({ scenario: "timestamp", skipped: "no suitable target on the timeline" });
  else {
    await resetObs();
    const pos = await findLink(s.id);
    if (!pos) record({ scenario: "timestamp", skipped: "target link not reachable" });
    else {
      let o = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        const p = await page.evaluate(findLinkDoc, s.id);
        if (!p) break;
        if (p.stale) { await sleep(500); continue; } // point verified stale in-page — let the layout settle
        await page.mouse.click(p.x, p.y, { label: "时间戳点击" });
        await sleep(700);
        o = await readObs();
        if ((o.pvOn && o.pvId === s.id) || o.path.includes("/status/" + s.id)) break;
      }
      record({ scenario: "timestamp", expect: "instant preview, correct id", pass: Boolean(o && o.pvOn && o.pvId === s.id && o.pvLen > 8), ...(o || {}) });
    }
  }
}

// ---------- S2 body-text click → native behavior, no preview (COVERAGE GAP record) ----------
if (run("bodytext")) {
  const s = await pickTarget("hasBody", 1) || await pickTarget("hasBody");
  if (!s) record({ scenario: "bodytext", skipped: "no suitable target" });
  else {
    await resetObs();
    const pos = await findBodyText(s.id);
    if (!pos) record({ scenario: "bodytext", skipped: "body text not reachable" });
    else {
      await page.mouse.click(pos.x, pos.y, { label: "正文文本点击" });
      await sleep(900);
      const o = await readObs();
      record({
        scenario: "bodytext", expect: "X navigates natively; no preview (documented COVERAGE GAP, fail-open)",
        pass: !o.pvOn, nativeNavigated: o.path.includes("/status/"), ...o,
      });
    }
  }
}

// ---------- S3 quote-card click → must not preview the outer cell's post ----------
if (run("quotecard")) {
  const s = await pickTarget("hasQuote");
  if (!s) record({ scenario: "quotecard", skipped: "no quote card on the timeline" });
  else {
    await resetObs();
    const pos = await page.evaluate((tid) => {
      const cell = [...document.querySelectorAll('[data-testid="cellInnerDiv"]')]
        .find((c) => [...c.querySelectorAll("a[href] time")].some((tm) => (tm.closest("a")?.getAttribute("href") || "").includes("/status/" + tid) && !tm.closest('div[role="link"]')));
      if (!cell) return null;
      const q = cell.querySelector('div[role="link"]');
      if (!q) return null;
      q.scrollIntoView({ block: "center" });
      const r = q.getBoundingClientRect();
      return { x: Math.round(r.x + Math.min(140, r.width / 2)), y: Math.round(r.y + Math.min(30, r.height / 2)) };
    }, s.id);
    if (!pos) record({ scenario: "quotecard", skipped: "quote card not reachable" });
    else {
      await page.mouse.click(pos.x, pos.y, { label: "引用卡点击" });
      await sleep(900);
      const o = await readObs();
      const wrongPreview = o.pvOn && o.pvId === s.id;
      record({
        scenario: "quotecard", expect: "no preview of the outer post; X's own quote handling intact",
        pass: !wrongPreview, previewedOuterPost: wrongPreview, ...o,
      });
    }
  }
}

// ---------- S4 image click → native lightbox, no preview ----------
if (run("image")) {
  const s = await pickTarget("hasImage");
  if (!s) record({ scenario: "image", skipped: "no media cell on the timeline" });
  else {
    await resetObs();
    const pos = await page.evaluate((tid) => {
      const cell = [...document.querySelectorAll('[data-testid="cellInnerDiv"]')]
        .find((c) => [...c.querySelectorAll("a[href] time")].some((tm) => (tm.closest("a")?.getAttribute("href") || "").includes("/status/" + tid) && !tm.closest('div[role="link"]')));
      if (!cell) return null;
      const img = cell.querySelector('img[src*="pbs.twimg.com/media"]');
      if (!img) return null;
      img.scrollIntoView({ block: "center" });
      const r = img.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }, s.id);
    if (!pos) record({ scenario: "image", skipped: "media image not reachable" });
    else {
      const imgFind = (tid) => {
        const cell = [...document.querySelectorAll('[data-testid="cellInnerDiv"]')]
          .find((c) => [...c.querySelectorAll("a[href] time")].some((tm) => (tm.closest("a")?.getAttribute("href") || "").includes("/status/" + tid) && !tm.closest('div[role="link"]')));
        if (!cell) return null;
        const img = cell.querySelector('img[src*="pbs.twimg.com/media"]');
        if (!img) return null;
        img.scrollIntoView({ block: "center" });
        const r = img.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      };
      const imgPos = await precisePos(imgFind, null, "图片点击", s.id);
      let o = null;
      if (imgPos) {
        for (let attempt = 0; attempt < 3; attempt++) {
          await page.mouse.click(imgPos.x, imgPos.y, { label: "图片点击" });
          await sleep(1000);
          o = await readObs();
          if (o.lightbox || o.path.includes("/status/")) break;
        }
      }
      // Current X opens timeline images on the post's photo view
      // (/status/<id>/photo/<n>) or the lightbox. The media anchor CONTAINS
      // /status/<id>, so a correct-id preview is consistent with X's own
      // navigation; a WRONG-id preview would be the defect.
      const nativePhoto = Boolean(o && (o.lightbox || /\/photo\//.test(o.path || "") || (o.path || "").includes("/status/")));
      const wrongId = Boolean(o && o.pvOn && o.pvId && o.pvId !== s.id);
      record({ scenario: "image", expect: "X native photo handling intact; any preview must show the correct post", pass: Boolean(o && nativePhoto && !wrongId), nativePhoto, wrongIdPreview: wrongId, imgPosFound: Boolean(imgPos), ...(o || {}) });
      await page.keyboard.press("Escape");
      await sleep(600);
    }
  }
}

// ---------- S5 video play click → native player, no preview ----------
if (run("video")) {
  const s = await pickTarget("hasVideo");
  if (!s) record({ scenario: "video", skipped: "no list video on the timeline" });
  else {
    await resetObs();
    const pos = await page.evaluate((tid) => {
      const cell = [...document.querySelectorAll('[data-testid="cellInnerDiv"]')]
        .find((c) => [...c.querySelectorAll("a[href] time")].some((tm) => (tm.closest("a")?.getAttribute("href") || "").includes("/status/" + tid) && !tm.closest('div[role="link"]')));
      if (!cell) return null;
      const v = cell.querySelector("video");
      if (!v) return null;
      v.scrollIntoView({ block: "center" });
      const r = v.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }, s.id);
    if (!pos) record({ scenario: "video", skipped: "video not reachable" });
    else {
      await page.mouse.click(pos.x, pos.y, { label: "视频点击" });
      await sleep(1200);
      const o = await readObs();
      const playing = await page.evaluate(() => {
        const v = document.querySelector('[data-testid="cellInnerDiv"] video');
        return v ? { paused: v.paused, t: +v.currentTime.toFixed(1) } : null;
      });
      record({ scenario: "video", expect: "native playback toggles; no preview; no navigation", pass: !o.pvOn && !o.path.includes("/status/"), playing, ...o });
    }
  }
}

// ---------- S6 reply button (non-mutating) → no preview ----------
if (run("replybtn")) {
  const s = await pickTarget("hasBody");
  if (!s) record({ scenario: "replybtn", skipped: "no suitable target" });
  else {
    await resetObs();
    const pos = await page.evaluate((tid) => {
      const cell = [...document.querySelectorAll('[data-testid="cellInnerDiv"]')]
        .find((c) => [...c.querySelectorAll("a[href] time")].some((tm) => (tm.closest("a")?.getAttribute("href") || "").includes("/status/" + tid) && !tm.closest('div[role="link"]')));
      if (!cell) return null;
      const b = cell.querySelector('[data-testid="reply"]');
      if (!b) return null;
      b.scrollIntoView({ block: "center" });
      const r = b.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }, s.id);
    if (!pos) record({ scenario: "replybtn", skipped: "reply button not reachable" });
    else {
      await page.mouse.click(pos.x, pos.y, { label: "回复按钮点击" });
      await sleep(900);
      const o = await readObs();
      record({ scenario: "replybtn", expect: "composer opens; no preview; no navigation", pass: !o.pvOn && !o.path.includes("/status/"), ...o });
      await page.keyboard.press("Escape");
      await sleep(400);
    }
  }
}

// ---------- S7 like/repost/bookmark: STRUCTURAL ONLY (zero account writes) ----------
if (run("actionbtns")) {
  const structural = await page.evaluate(() => {
    const bars = [...document.querySelectorAll('[data-testid="cellInnerDiv"] article')].slice(0, 5);
    const report = {};
    for (const key of ["like", "retweet", "bookmark"]) {
      const btns = bars.map((a) => a.querySelector(`[data-testid="${key}"]`)).filter(Boolean);
      report[key] = {
        count: btns.length,
        insideStatusAnchor: btns.filter((b) => b.closest('a[href*="/status/"]')).length,
      };
    }
    return report;
  });
  const pass = Object.values(structural).every((x) => x.count > 0 && x.insideStatusAnchor === 0);
  record({ scenario: "actionbtns", expect: "like/repost/bookmark live outside any status anchor → preview capture structurally impossible; not physically clicked (zero-account-write rule)", pass, structural });
}

// ---------- S8 ctrl/cmd + click on timestamp → no preview may linger in this tab ----------
if (run("ctrlclick")) {
  const s = await pickTarget("hasBody");
  if (!s) record({ scenario: "ctrlclick", skipped: "no suitable target" });
  else {
    await resetObs();
    const pos = await findLink(s.id);
    if (!pos) record({ scenario: "ctrlclick", skipped: "target link not reachable" });
    else {
      await page.keyboard.down("Control");
      await page.mouse.click(pos.x, pos.y, { label: "Ctrl+点击时间戳" });
      await page.keyboard.up("Control");
      await sleep(700);
      const early = await readObs();
      await sleep(1400); // route-timeout budget (1200ms) plus margin
      const late = await readObs();
      record({
        scenario: "ctrlclick",
        expect: "new-tab navigation is X/browser's own; any transient preview must clear within the 1200ms bounded budget",
        pass: !late.pvNow && (!early.pvOn || (early.pvLastAt - early.pvFirstAt) < 1300),
        early, late,
      });
    }
  }
}

// ---------- S9 shift+click on timestamp → same bounded-cleanup rule ----------
if (run("shiftclick")) {
  const s = await pickTarget("hasBody");
  if (!s) record({ scenario: "shiftclick", skipped: "no suitable target" });
  else {
    await resetObs();
    const pos = await findLink(s.id);
    if (!pos) record({ scenario: "shiftclick", skipped: "target link not reachable" });
    else {
      await page.keyboard.down("Shift");
      await page.mouse.click(pos.x, pos.y, { label: "Shift+点击时间戳" });
      await page.keyboard.up("Shift");
      await sleep(700);
      const early = await readObs();
      await sleep(1400);
      const late = await readObs();
      record({
        scenario: "shiftclick",
        expect: "new-window navigation is X/browser's own; any transient preview must clear within the 1200ms bounded budget",
        pass: !late.pvNow && (!early.pvOn || (early.pvLastAt - early.pvFirstAt) < 1300),
        early, late,
      });
    }
  }
}

// ---------- S10 middle-click (auxclick) → click-phase capture must not fire ----------
if (run("middleclick")) {
  const s = await pickTarget("hasBody");
  if (!s) record({ scenario: "middleclick", skipped: "no suitable target" });
  else {
    await resetObs();
    const pos = await findLink(s.id);
    if (!pos) record({ scenario: "middleclick", skipped: "target link not reachable" });
    else {
      await page.mouse.click(pos.x, pos.y, { button: "middle", label: "中键点击时间戳" });
      await sleep(1000);
      const o = await readObs();
      record({ scenario: "middleclick", expect: "no preview at all (middle click fires auxclick, not click); this tab unaffected", pass: !o.pvOn && !o.pvNow, ...o });
    }
  }
}

// ---------- S11 rapid consecutive clicks on two different posts ----------
if (run("rapid")) {
  await page.goto(GOTO_HOME); await sleep(4500); await obs();
  const ids = await page.evaluate(() => {
    const out = [];
    for (const c of document.querySelectorAll('[data-testid="cellInnerDiv"]')) {
      const art = c.querySelector("article");
      if (!art || !art.querySelector('[data-testid="tweetText"]')) continue;
      const own = [...art.querySelectorAll("a[href] time")]
        .map((t) => t.closest("a"))
        .find((a) => !a.closest('div[role="link"]') && /\/status\/\d+/.test(a.getAttribute("href") || ""));
      if (own) out.push((own.getAttribute("href").match(/\/status\/(\d+)/) || [])[1]);
      if (out.length >= 2) break;
    }
    return out;
  });
  if (!ids || ids.length < 2) record({ scenario: "rapid", skipped: "need two distinct body posts" });
  else {
    const [idA, idB] = ids;
    await resetObs();
    // click A → detail; back; IMMEDIATELY click B (fresh scan) — minimal gaps
    let o = null;
    let openedA = false;
    for (let attempt = 0; attempt < 3 && !openedA; attempt++) {
      const p = await page.evaluate(findLinkDoc, idA);
      if (!p || p.stale) { await sleep(400); continue; }
      await page.mouse.click(p.x, p.y, { label: "快速点击帖 A" });
      await sleep(600);
      openedA = (await page.evaluate(() => location.pathname)).includes("/status/" + idA);
    }
    if (!openedA) record({ scenario: "rapid", skipped: "post A did not open" });
    else {
      await page.evaluate(() => history.back());
      await sleep(800);
      await resetObs(); // discard post-A preview samples; only post-B samples matter now
      let openedB = false;
      for (let attempt = 0; attempt < 3 && !openedB; attempt++) {
        const idB2 = await page.evaluate((skipId) => {
          for (const c of document.querySelectorAll('[data-testid="cellInnerDiv"]')) {
            const art = c.querySelector("article");
            if (!art || !art.querySelector('[data-testid="tweetText"]')) continue;
            const own = [...art.querySelectorAll("a[href] time")]
              .map((t) => t.closest("a"))
              .find((a) => !a.closest('div[role="link"]') && /\/status\/\d+/.test(a.getAttribute("href") || ""));
            if (!own) continue;
            const id = (own.getAttribute("href").match(/\/status\/(\d+)/) || [])[1];
            if (id !== skipId) return id;
          }
          return null;
        }, idA);
        if (!idB2) { await sleep(400); continue; }
        const p = await page.evaluate(findLinkDoc, idB2);
        if (!p || p.stale) { await sleep(400); continue; }
        await page.mouse.click(p.x, p.y, { label: "快速点击帖 B" });
        await sleep(700);
        o = await readObs();
        openedB = (o.path || "").includes("/status/");
      }
      const stale = o && o.pvOn && o.pvId && o.pvId !== idB && (o.path || "").includes("/status/");
      record({
        scenario: "rapid",
        expect: "after back and a fresh click, no stale preview of the previous post may remain",
        pass: Boolean(o && openedB && !stale), openedA, staleFirstPostPreview: Boolean(stale), ...(o || {}),
      });
    }
  }
}

// ---------- S12 modifier-state sanity on observed clicks ----------
if (run("clicklog")) {
  const o = await readObs();
  record({ scenario: "clicklog", expect: "modifier keys observable on real clicks", clicks: o.clicks.slice(-10) });
}

import { writeFileSync } from "node:fs";
writeFileSync("/Users/devon/claude/peek-main/docs/m2-b2-a-l4/evidence/click-coverage-results.json", JSON.stringify(results, null, 1));
console.log("DONE scenarios:", results.length);
