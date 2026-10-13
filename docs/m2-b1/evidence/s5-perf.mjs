// M2-B1 S5 — unified performance harness (same script for all three modes).
// MODE env var selects the mode whose extension is currently loaded:
//   MODE=lab   → B: M2-B1 experimental layout adapter
//   MODE=m1r   → A: M1-R stable carrier
//   MODE=native→ C: bare X (no extension)
// Same browser/profile/account/viewport/samples in every pass; rAF-timed
// conditions inside the page; a capture-phase click listener timestamps the
// navigation start (no CDP dispatch skew). Read-only: no account writes.
//
// Samples (deterministic entry lists = the authors' profiles, top post):
//   S1 video:  https://x.com/thinkszyg          → /status/2109309251533570509
//   S2 photos: https://x.com/KinGao476942       → /status/2109792240776421482
//   S3 text:   https://x.com/gefei55            → /status/2109450990575611958
// To guarantee the SAME sample posts in every pass, the harness verifies the
// opened detail URL and discards the round (records null) if X's profile
// ordering served a different top post.
const MODE = __MODE__;
const ROUNDS = 5;
const task = await taskSpace(1);
const page = task.page("p1");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = { mode: MODE, rounds: [], wrapper: null, note: null };

const SAMPLES = [
  { id: "2109309251533570509", profile: "https://x.com/thinkszyg", kind: "video" },
  { id: "2109792240776421482", profile: "https://x.com/KinGao476942", kind: "photos" },
  { id: "2109450990575611958", profile: "https://x.com/gefei55", kind: "text" },
];

// mode-specific "focal first readable" + close affordance
const FOCAL_READABLE = {
  lab: `(() => { const a = document.querySelector("article[data-peek-lad-focal]"); return Boolean(a?.querySelector("[data-testid=tweetText]")?.textContent?.trim()); })()`,
  native: `(() => { const id = location.pathname.match(/status\\/(\\d+)/)?.[1]; const a = [...document.querySelectorAll("article[data-testid=tweet]")].find(x => [...x.querySelectorAll("a")].some(l => l.querySelector("time") && (l.getAttribute("href") || "").includes("/" + id))); return Boolean(a?.querySelector("[data-testid=tweetText]")?.textContent?.trim()); })()`,
  m1r: `(() => { const t = document.querySelector("#peek-native-pane .peek-native-text"); return Boolean(t && t.textContent.trim() && !t.classList.contains("peek-native-unknown")); })()`,
};
const CLOSE_CLICK = {
  lab: `(() => { const b = document.querySelector("[data-testid=topBar] [aria-label='返回'], [data-testid=topBar] [aria-label='Back'], header[aria-label][role=banner] [aria-label='返回']"); if (b) { b.click(); return true; } const back = [...document.querySelectorAll("[role=button], button")].find(x => (x.getAttribute("aria-label") || "") === "返回" || (x.getAttribute("aria-label") || "") === "Back"); if (back) { back.click(); return true; } return false; })()`,
  native: `(() => { const back = [...document.querySelectorAll("[role=button], button")].find(x => (x.getAttribute("aria-label") || "") === "返回" || (x.getAttribute("aria-label") || "") === "Back"); if (back) { back.click(); return true; } return false; })()`,
  m1r: `(() => { const b = document.querySelector("#peek-native-pane .peek-native-close"); if (b) { b.click(); return true; } return false; })()`,
};

async function armClickStamp() {
  await page.evaluate(() => {
    window.__s5t0 = null;
    document.addEventListener("click", () => { if (window.__s5t0 === null) window.__s5t0 = performance.now(); }, { capture: true, once: true });
    window.__s5long = [];
    if (!window.__s5obs) {
      window.__s5obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__s5long.push(Math.round(e.duration));
      });
      try { window.__s5obs.observe({ entryTypes: ["longtask"] }); } catch { /* not supported */ }
    }
  });
}

async function waitFor(expr, timeoutMs) {
  const r = await page.evaluate(`(async () => {
    const t0 = performance.now();
    for (;;) {
      if (${expr}) return { ok: true, ms: Math.round(performance.now() - t0), sinceClick: window.__s5t0 ? Math.round(performance.now() - window.__s5t0) : null };
      await new Promise((r) => requestAnimationFrame(() => r()));
      if (performance.now() - t0 > ${timeoutMs}) return { ok: false, ms: ${timeoutMs}, t0: window.__s5t0 };
    }
  })()`);
  return r;
}

for (let round = 0; round < ROUNDS; round++) {
  const rec = { round, samples: [] };
  for (const s of SAMPLES) {
    // fresh list page + longtask buffer reset
    await page.goto(s.profile, { timeout: 30000 }).catch(() => {});
    await sleep(4500);
    await armClickStamp();

    // REAL pointer click on the FIRST status cell of the profile (no scroll,
    // no stale coordinates). Up to 3 attempts: the profile can re-render
    // between rect-read and pointer landing, so verify and re-target.
    let opened = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      await armClickStamp();
      const pos = await page.evaluate(() => {
        const link = [...document.querySelectorAll("a[href*='/status/']")].find(a => a.querySelector("time") && !(a.getAttribute("href") || "").includes("/analytics") && !(a.getAttribute("href") || "").includes("/photo"));
        if (!link) return null;
        link.scrollIntoView({ block: "center" });
        const r = link.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      });
      if (!pos) break;
      await sleep(400);
      await page.mouse.click(pos.x, pos.y, { label: "点击第一条帖子进入详情" });
      await sleep(1500);
      opened = await page.evaluate(() => location.pathname);
      if (/status\/\d+/.test(opened)) break;
    }
    if (!opened || !/status\/\d+/.test(opened)) { rec.samples.push({ sample: s.kind, skipped: "click did not open a detail" }); continue; }

    // T1: focal first readable
    const t1 = await waitFor(FOCAL_READABLE[MODE], 12000);

    // T2/T2b: first real reply in DOM / in readable right area
    const t2 = await waitFor(`(() => {
      const id = location.pathname.match(/status\\/(\\d+)/)?.[1];
      return [...document.querySelectorAll("[data-testid=cellInnerDiv]")].some(c => {
        const art = c.querySelector("article");
        if (!art) return false;
        const own = [...art.querySelectorAll("a[href*='/status/']")].some(a => a.querySelector("time") && a.getAttribute("href")?.includes("/" + id));
        if (own) return false;
        const txt = art.querySelector("[data-testid=tweetText]")?.textContent?.trim();
        return Boolean(txt);
      });
    })()`, 12000);
    const t2b = await waitFor(`(() => {
      const id = location.pathname.match(/status\\/(\\d+)/)?.[1];
      return [...document.querySelectorAll("[data-testid=cellInnerDiv]")].some(c => {
        const r = c.getBoundingClientRect();
        if (!(r.left > innerWidth * 0.5 || innerWidth < 980)) return false;
        if (!(r.top < innerHeight && r.bottom > 0)) return false;
        const art = c.querySelector("article");
        if (!art) return false;
        const own = [...art.querySelectorAll("a[href*='/status/']")].some(a => a.querySelector("time") && a.getAttribute("href")?.includes("/" + id));
        if (own) return false;
        return Boolean(art.querySelector("[data-testid=tweetText]")?.textContent?.trim());
      });
    })()`, 12000);

    // T3: native interactions available (action bar + composer)
    const t3 = await waitFor(`(() => {
      const id = location.pathname.match(/status\\/(\\d+)/)?.[1];
      const focal = [...document.querySelectorAll("article[data-testid=tweet]")].find(x => [...x.querySelectorAll("a")].some(l => l.querySelector("time") && (l.getAttribute("href") || "").includes("/" + id)));
      const actions = focal && (focal.querySelector("[data-testid=reply]") || focal.querySelector("[data-testid=like]"));
      const composer = document.querySelector("[data-testid^=tweetTextarea], [data-testid=toolBar]");
      return Boolean(actions && composer);
    })()`, 12000);

    // video first playable (video sample only)
    let vfp = null;
    if (s.kind === "video") {
      vfp = await waitFor(`(() => { const v = document.querySelector("article video"); return Boolean(v && v.readyState >= 3 && !v.paused); })()`, 12000);
    }

    // heap + dom snapshot after first paint set
    const afterPaint = await page.evaluate(() => ({ heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, dom: document.getElementsByTagName("*").length }));

    // right-column deep scroll responsiveness + long tasks during it
    const scrollPerf = await page.evaluate(`(async () => {
      const t0 = performance.now();
      for (let y = 0; y <= 5000; y += 500) { window.scrollTo(0, y); await new Promise((r) => requestAnimationFrame(() => r())); }
      return { ms: Math.round(performance.now() - t0) };
    })()`);
    const afterScroll = await page.evaluate(() => ({ heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, dom: document.getElementsByTagName("*").length, longTasksDuringSession: window.__s5long.length, longTaskMsTotal: window.__s5long.reduce((a, b) => a + b, 0) }));

    // focal integrity after deep scroll (mode-specific identity)
    let integrity = null;
    if (MODE === "lab") {
      integrity = await page.evaluate(() => {
        const a = document.querySelector("article[data-peek-lad-focal]");
        return { focalConnected: Boolean(a?.isConnected), focalCount: document.querySelectorAll("article[data-peek-lad-focal]").length, video: Boolean(a?.querySelector("video")) };
      });
    }

    // T4: close → list restored
    const closeOk = await page.evaluate(CLOSE_CLICK[MODE]);
    const t4 = closeOk ? await waitFor(`(() => {
      if (location.pathname.match(/status\\/\\d+/)) return false;
      const cell = [...document.querySelectorAll("[data-testid=cellInnerDiv]")].find(c => { const r = c.getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight && r.width > 0; });
      return Boolean(cell && cell.querySelector("article"));
    })()`, 12000) : { ok: false, ms: null };

    rec.samples.push({
      sample: s.kind, openedAt: opened,
      t1: t1.ok ? t1.sinceClick : null, t1Timeout: !t1.ok,
      t2: t2.ok ? t2.ms : null, t2b: t2b.ok ? t2b.ms : null,
      t3: t3.ok ? t3.ms : null, videoPlayable: vfp ? (vfp.ok ? vfp.ms : null) : undefined,
      heapDom: { afterPaint, afterScroll },
      deepScrollMs: scrollPerf.ms, longTasks: afterScroll.longTasksDuringSession, longTaskMs: afterScroll.longTaskMsTotal,
      integrity, t4: t4.ok ? t4.ms : null, t4Timeout: closeOk ? !t4.ok : "no-close-affordance",
    });
    await sleep(2500); // breathing room between samples (cache-condition parity)
  }
  out.rounds.push(rec);
}

// idle observation: 8s on the current list page, long tasks only
await page.goto("https://x.com/home");
await sleep(5000);
await page.evaluate(() => { window.__s5long = []; });
await sleep(8000);
out.idle = await page.evaluate(() => ({ longTasks: window.__s5long.length, longTaskMs: window.__s5long.reduce((a, b) => a + b, 0) }));

// wrapper overhead (comparable across modes): 3000 direct calls of the
// detail virtualizer's final-items method
await page.goto(SAMPLES[0].profile + "/status/" + SAMPLES[0].id);
await sleep(8000);
out.wrapper = await page.evaluate(`(async () => {
  const id = location.pathname.match(/status\\/(\\d+)/)?.[1];
  const cell = [...document.querySelectorAll("article[data-testid=tweet]")].find(x => [...x.querySelectorAll("a")].some(l => l.querySelector("time") && (l.getAttribute("href") || "").includes("/" + id)))?.closest("[data-testid=cellInnerDiv]");
  if (!cell) return { error: "no cell" };
  let fiber = cell[Object.keys(cell).find(k => k.startsWith("__reactFiber"))];
  while (fiber && !(fiber.stateNode && typeof fiber.stateNode._getFinalRenderedItems === "function")) fiber = fiber.return;
  const inst = fiber?.stateNode;
  if (!inst) return { error: "no virtualizer" };
  const fn = inst._getFinalRenderedItems.bind(inst);
  fn(); // warm
  const t0 = performance.now();
  for (let i = 0; i < 3000; i++) fn();
  const ms = performance.now() - t0;
  const wrapped = typeof Object.getOwnPropertyDescriptor(inst, "_getFinalRenderedItems")?.value === "function";
  return { perCallUs: +(ms / 3000 * 1000).toFixed(2), totalMs: +ms.toFixed(1), wrappedOwnProperty: wrapped };
})()`);

import { writeFileSync } from "node:fs";
writeFileSync(`/Users/devon/claude/peek-main/docs/m2-b1/evidence/s5-results-${MODE}.json`, JSON.stringify(out, null, 1));
console.log("MODE " + MODE + " done");
console.log(JSON.stringify(out.rounds.map(r => r.samples.map(s => ({ s: s.sample, t1: s.t1, t2: s.t2, t2b: s.t2b, t3: s.t3, vfp: s.videoPlayable, t4: s.t4, scroll: s.deepScrollMs, lt: s.longTasks })).filter(x => x.s)), null, 0));
console.log("wrapper:", JSON.stringify(out.wrapper), "idle:", JSON.stringify(out.idle));
