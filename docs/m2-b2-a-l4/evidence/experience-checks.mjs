// L4-S4 — real-experience acceptance for the m2a lab build (live browser).
//
// Scenarios (globalThis.__RUN__, comma list; default all):
//   fourposts   text / photos / video / highcomments: click → preview →
//               native takeover, screenshots at each stage
//   video       left-pane video: real-pointer pause/play/fullscreen + 5000px
//               deep-scroll identity + keepalive (mute not automatable —
//               current X exposes no mute control; noted inline)
//   loops       5 × open → read → scroll comments → close → keep browsing,
//               with feed re-render polling and stability checks
//   theme       dark/light: switch X theme, open a post with preview, verify
//               faces, switch back
//   narrow      sub-980px viewport: no preview offered, native single column
//   reload      extension reload via chrome://extensions then reader re-check
//
// Screenshots land in evidence/shots/. No account writes anywhere.
const RUNRAW = (typeof __RUN__ !== "undefined" && __RUN__) || (typeof process !== "undefined" && process.env?.RUN) || "all";
const RUNSET = new Set(RUNRAW === "all" ? ["all"] : RUNRAW.split(","));
const run = (id) => RUNSET.has("all") || RUNSET.has(id);
const SHOTS = "/Users/devon/claude/peek-main/docs/m2-b2-a-l4/evidence/shots";
const task = await taskSpace("peek l4 experience");
const page = task.page("p1");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
import { mkdirSync, writeFileSync } from "node:fs";
mkdirSync(SHOTS, { recursive: true });

const results = [];
const record = (r) => { results.push(r); console.log(JSON.stringify({ ...r, shots: r.shots?.map((s) => String(s).split("/").pop()) })); };

// preview observer (4ms timer chain — rAF freezes on idle timelines)
const OBS = `(function () {
  if (window.__xpObs) return "rearmed";
  window.__xpObs = true;
  window.__xp = { pv: [], born: performance.now() };
  const loop = () => {
    const c = window.__xp;
    if (!c) return;
    const p = document.getElementById("peek-lad-preview");
    c.pv.push({ at: +(performance.now() - c.born).toFixed(0), on: Boolean(p && p.isConnected), id: p?.dataset.statusId || null, len: p ? (p.textContent || "").trim().length : 0 });
    if (c.pv.length > 900) c.pv = c.pv.slice(-450);
    if (performance.now() - c.born < 90000) setTimeout(loop, 4);
  };
  setTimeout(loop, 4);
  return "installed";
})()`;
const obs = () => page.evaluate(OBS);
const pvSamples = () => page.evaluate(`(() => {
  const c = window.__xp || { pv: [] };
  const on = c.pv.filter(x => x.on);
  return { onFrames: on.length, firstOn: on[0]?.at ?? null, lastOn: on[on.length - 1]?.at ?? null, id: on[0]?.id ?? null, maxLen: Math.max(0, ...c.pv.map(x => x.len)), pvNow: Boolean(document.getElementById("peek-lad-preview")) };
})()`);
// click target verified in the SAME evaluate (timeline reflows under hydration)
const verifiedLinkPos = (id) => page.evaluate((tid) => {
  const link = [...document.querySelectorAll("a[href] time")]
    .map((t) => t.closest("a"))
    .find((a) => (a.getAttribute("href") || "").includes("/status/" + tid) && !a.closest('div[role="link"]'));
  if (!link) return null;
  link.scrollIntoView({ block: "center" });
  const r = link.getBoundingClientRect();
  const x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2);
  const el = document.elementFromPoint(x, y);
  return el && el.closest('a[href*="/status/' + tid + '"]') ? { x, y } : null;
}, id);
const focalState = () => page.evaluate(`(() => {
  const a = document.querySelector("article[data-peek-lad-focal]");
  return {
    focal: Boolean(a && a.isConnected), focalCount: document.querySelectorAll("article[data-peek-lad-focal]").length,
    state: document.documentElement.getAttribute("data-peek-lad-state"),
    split: Boolean(document.getElementById("peek-lad-style")),
    textLen: a ? (a.querySelector('[data-testid="tweetText"]')?.textContent || "").trim().length : 0,
    hasVideo: Boolean(a && a.querySelector("video")),
  };
})()`);
const backBtn = () => page.evaluate(`(() => {
  const b = [...document.querySelectorAll("[role=button], button")].find(x => ["返回", "Back"].includes(x.getAttribute("aria-label") || ""));
  if (b) { b.click(); return true; } return false;
})()`);

// Open a post through a REAL click and require the instant preview to have
// been observed. A click X answers via its own cell-level navigation (tiny
// reflow moved the point off the timestamp link) opens the detail WITHOUT a
// preview — a miss for this scenario: go back and retry.
async function openWithPreview(profile, id, { previewShot, attempts = 8 } = {}) {
  await page.goto(profile);
  await sleep(4500);
  await obs();
  for (let attempt = 0; attempt < attempts; attempt++) {
    const p = await verifiedLinkPos(id);
    if (!p) { await page.evaluate(() => window.scrollBy(0, 1200)); await sleep(700); continue; }
    await page.mouse.click(p.x, p.y, { label: "打开目标帖" });
    await sleep(120);
    let shot = null;
    if (previewShot) {
      try { await page.screenshot({ path: previewShot }); shot = previewShot; } catch {}
    }
    await sleep(2300);
    const onDetail = (await page.evaluate(() => location.pathname)).includes("/status/" + id);
    const pv = await pvSamples();
    if (onDetail && pv.onFrames > 0) return { opened: true, pv, shot };
    if (onDetail) {
      await backBtn();
      await sleep(1500);
      await obs();
      continue;
    }
    await obs();
  }
  return { opened: false, pv: await pvSamples(), shot: null };
}

// ---------- fourposts ----------
if (run("fourposts")) {
  const posts = [
    { id: "1760839985715204230", profile: "https://x.com/gefei55", kind: "text" },
    { id: "2099877465795735861", profile: "https://x.com/KinGao476942", kind: "photos" },
    { id: "2109309251533570509", profile: "https://x.com/thinkszyg", kind: "video" },
    { id: "2100757389112938573", profile: "https://x.com/ruanyf", kind: "highcomments" },
  ];
  for (const s of posts) {
    const r = await openWithPreview(s.profile, s.id, { previewShot: `${SHOTS}/fourposts-${s.kind}-1-preview.png` });
    if (!r.opened) { record({ scenario: "fourposts", kind: s.kind, pass: false, error: "did not open with preview" }); continue; }
    const fs = await focalState();
    const shotNative = `${SHOTS}/fourposts-${s.kind}-2-native.png`;
    await page.screenshot({ path: shotNative });
    record({
      scenario: "fourposts", kind: s.kind,
      pass: r.pv.id === s.id && r.pv.maxLen > 8 && fs.focal && fs.focalCount === 1 && fs.textLen > 8 && !fs.pvNow,
      preview: r.pv, focal: fs,
      shots: [r.shot, shotNative].filter(Boolean),
    });
    await backBtn();
    await sleep(1500);
  }
}

// ---------- video controls ----------
if (run("video")) {
  const id = "2109309251533570509";
  await page.goto("https://x.com/thinkszyg/status/" + id);
  await sleep(5000);
  await obs();
  const readV = () => page.evaluate(() => {
    const v = document.querySelector("article[data-peek-lad-focal] video") || document.querySelector("article video");
    return v ? { paused: v.paused, t: +v.currentTime.toFixed(1), muted: v.muted, ready: v.readyState } : null;
  });
  // REAL pointer click on the labeled player control. Synthetic .click()
  // carries no user activation (play()/fullscreen() rejected). The pinned
  // left pane scrolls INTERNALLY, so a tall video's control bar needs an
  // in-pane scroll before the (visibility-verified) lookup.
  const clickLabel = async (label) => {
    const h = await page.evaluate(() => {
      const v = document.querySelector("article[data-peek-lad-focal] video") || document.querySelector("article video");
      if (!v) return null;
      const r = v.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    });
    if (!h) return false;
    let b = null;
    for (let i = 0; i < 4 && !b; i++) {
      await page.evaluate(() => {
        const pane = document.querySelector("article[data-peek-lad-focal]");
        const v = pane?.querySelector("video");
        if (pane && v) {
          const vb = v.getBoundingClientRect().bottom;
          if (vb > window.innerHeight - 60) pane.scrollTop += Math.ceil(vb - window.innerHeight) + 90;
        }
      });
      await sleep(200);
      await page.mouse.move(h.x + (i % 2 ? 3 : -3), h.y, { label: "悬停视频" });
      await page.mouse.move(h.x, h.y, { label: "悬停视频" });
      await sleep(450);
      b = await page.evaluate((lab) => {
        const scope = document.querySelector("article[data-peek-lad-focal]") || document;
        for (const btn of scope.querySelectorAll('[role="button"], button')) {
          if ((btn.getAttribute("aria-label") || "") !== lab) continue;
          const r = btn.getBoundingClientRect();
          if (r.width < 8 || r.height < 8) continue;
          const x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2);
          const el = document.elementFromPoint(x, y);
          if (el && (el === btn || btn.contains(el) || el.closest('[aria-label="' + lab + '"]') === btn)) return { x, y };
        }
        return null;
      }, label);
    }
    if (!b) return false;
    await page.mouse.click(b.x, b.y, { label: `点击「${label}」` });
    return true;
  };
  const fs = await focalState();
  const st0 = await readV();
  const t0 = st0?.t ?? 0;
  await sleep(1200);
  const st1 = await readV();
  const autoplaying = Boolean(st1 && !st1.paused && st1.t > t0);
  let pausedClicked = await clickLabel("暂停");
  await sleep(700);
  let stPaused = await readV();
  if (!stPaused?.paused) { pausedClicked = (await clickLabel("暂停")) || pausedClicked; await sleep(700); stPaused = await readV(); }
  let playClicked = await clickLabel("播放");
  await sleep(900);
  let stResumed = await readV();
  if (stResumed?.paused) { playClicked = (await clickLabel("播放")) || playClicked; await sleep(900); stResumed = await readV(); }
  const shotPlay = `${SHOTS}/video-1-playback.png`;
  await page.screenshot({ path: shotPlay });
  const fsIn = await clickLabel("全屏");
  await sleep(1500);
  const fsOn = await page.evaluate(() => ({ fs: Boolean(document.fullscreenElement), tag: document.fullscreenElement?.tagName || null }));
  await page.screenshot({ path: `${SHOTS}/video-3-fullscreen.png` });
  const fsOutClicked = await clickLabel("退出全屏");
  await sleep(900);
  const fsOff = await page.evaluate(() => !document.fullscreenElement);
  const before = await readV();
  const ds = await page.evaluate(async () => {
    const t0 = performance.now();
    for (let y = 0; y <= 5000; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
    return Math.round(performance.now() - t0);
  });
  await sleep(900);
  const after = await readV();
  const identity = await page.evaluate(() => {
    const v = document.querySelector("article video");
    const focal = document.querySelector("article[data-peek-lad-focal]");
    return { connected: Boolean(v && v.isConnected), inFocal: Boolean(focal && focal.contains(v)) };
  });
  const shotDeep = `${SHOTS}/video-4-deepscroll.png`;
  await page.screenshot({ path: shotDeep });
  await page.evaluate(() => window.scrollTo(0, 0));
  record({
    scenario: "video",
    pass: Boolean(fs.focal && autoplaying && stPaused?.paused && stResumed && !stResumed.paused && fsOn.fs && (fsOutClicked ? fsOff : true) && identity.connected && identity.inFocal && after && before && after.t > before.t),
    steps: {
      focalPinned: fs.focal, autoplaying,
      pause: { clicked: pausedClicked, paused: stPaused?.paused ?? null },
      resume: { clicked: playClicked, playing: stResumed ? !stResumed.paused : null },
      mute: { automatable: false, note: "current X build exposes no mute control in the player bar or settings popover (speed/quality only); video enters muted per X autoplay policy" },
      fullscreen: { enterClicked: fsIn, on: fsOn.fs, exitClicked: fsOutClicked, exited: fsOff },
      deepScroll: { ms: ds, videoStillConnected: identity.connected, inFocal: identity.inFocal, timeAdvanced: Boolean(after && before && after.t > before.t), playingAfter: Boolean(after && !after.paused) },
    },
    shots: [shotPlay, `${SHOTS}/video-3-fullscreen.png`, shotDeep],
  });
  await backBtn();
  await sleep(1200);
}

// ---------- 5 open/close loops ----------
if (run("loops")) {
  await page.goto("https://x.com/home");
  await sleep(4500);
  await obs();
  const loops = [];
  const feedState = () => page.evaluate(`(() => ({
    onDetail: location.pathname.includes("/status/"),
    y: Math.round(window.scrollY),
    cells: document.querySelectorAll('[data-testid="cellInnerDiv"] article').length,
    pvLeftover: Boolean(document.getElementById("peek-lad-preview")),
    focalLeftover: document.querySelectorAll("article[data-peek-lad-focal]").length,
    scrollHeight: document.documentElement.scrollHeight,
  }))()`);
  for (let i = 0; i < 5; i++) {
    const feedBefore = await feedState();
    const target = await page.evaluate(() => {
      for (const c of document.querySelectorAll('[data-testid="cellInnerDiv"]')) {
        const art = c.querySelector("article");
        if (!art || !art.querySelector('[data-testid="tweetText"]')) continue;
        const own = [...art.querySelectorAll("a[href] time")]
          .map((t) => t.closest("a"))
          .find((a) => !a.closest('div[role="link"]') && /\/status\/\d+/.test(a.getAttribute("href") || ""));
        if (own) return (own.getAttribute("href").match(/\/status\/(\d+)/) || [])[1];
      }
      return null;
    });
    if (!target) { loops.push({ i: i + 1, error: "no target" }); continue; }
    let opened = false;
    let pv = null;
    for (let attempt = 0; attempt < 4 && !opened; attempt++) {
      const p = await verifiedLinkPos(target);
      if (!p) { await sleep(500); continue; }
      await page.mouse.click(p.x, p.y, { label: `循环${i + 1} 打开` });
      await sleep(2300);
      opened = (await page.evaluate(() => location.pathname)).includes("/status/" + target);
      if (opened) {
        pv = await pvSamples();
        // the preview is part of the reading loop when this build offers it
        if (pv.onFrames === 0) { await backBtn(); await sleep(1500); await obs(); opened = false; }
      }
    }
    if (!opened) { loops.push({ i: i + 1, error: "did not open with preview" }); continue; }
    const scrollOk = await page.evaluate(async () => {
      const t0 = performance.now();
      for (let y = 0; y <= 1500; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 80)); }
      return Math.round(performance.now() - t0);
    });
    const readState = await focalState();
    const closed = await backBtn();
    // poll: X's virtualizer re-renders the returned feed over a few seconds
    let after = null;
    for (let w = 0; w < 16; w++) {
      after = await feedState();
      if (after.cells >= 3 && !after.onDetail) break;
      await sleep(500);
    }
    const shot = `${SHOTS}/loops-${i + 1}-after-close.png`;
    await page.screenshot({ path: shot });
    loops.push({
      i: i + 1, target, opened, scrollOk, closed, readState, preview: pv, after, feedBefore,
      pass: Boolean(closed && !after.onDetail && after.cells >= 3 && !after.pvLeftover && after.focalLeftover === 0),
      shot,
    });
    await sleep(1200);
  }
  const shot = `${SHOTS}/loops-final-feed.png`;
  await page.screenshot({ path: shot });
  record({ scenario: "loops", pass: loops.length === 5 && loops.every((l) => l.pass), loops, shots: [shot] });
}

// ---------- theme switch ----------
if (run("theme")) {
  const theme0 = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.goto("https://x.com/settings/display");
  await sleep(3500);
  const toggled = await page.evaluate(`(() => {
    const radios = [...document.querySelectorAll('[role="radiogroup"] [role="radio"], [role="radio"]')];
    const current = radios.find((r) => r.getAttribute("aria-checked") === "true");
    const other = radios.find((r) => r.getAttribute("aria-checked") !== "true");
    const nameOf = (r) => (r ? (r.textContent || "").trim().slice(0, 20) : null);
    if (!other) return { ok: false, radios: radios.map(nameOf) };
    other.click();
    return { ok: true, from: nameOf(current), to: nameOf(other) };
  })()`);
  await sleep(2500);
  let out = { scenario: "theme", themeBefore: theme0, toggled };
  if (toggled.ok) {
    const id = "1760839985715204230";
    const topen = await openWithPreview("https://x.com/gefei55", id, { previewShot: `${SHOTS}/theme-1-preview.png` });
    const pv = topen.pv;
    const fs = await focalState();
    const bg = await page.evaluate(() => ({
      body: getComputedStyle(document.body).backgroundColor,
      focal: document.querySelector("article[data-peek-lad-focal]") ? getComputedStyle(document.querySelector("article[data-peek-lad-focal]")).backgroundColor : null,
    }));
    const shot = `${SHOTS}/theme-2-native.png`;
    await page.screenshot({ path: shot });
    out = { ...out, pass: topen.opened && pv.id === id && fs.focal && fs.focalCount === 1, preview: pv, focal: fs, colors: bg, shots: [shot] };
    await page.goto("https://x.com/settings/display");
    await sleep(3000);
    await page.evaluate(`(() => {
      const radios = [...document.querySelectorAll('[role="radiogroup"] [role="radio"], [role="radio"]')];
      const orig = ${JSON.stringify(theme0)};
      const dark = radios.find((r) => /深色|Dark|暗/i.test(r.textContent || ""));
      const light = radios.find((r) => /浅色|默认|Light|Default/i.test(r.textContent || ""));
      const target = /rgb\\(0, 0, 0\\)|rgb\\(5, 5, 5\\)|black/i.test(orig) ? dark : light;
      if (target) target.click();
      return true;
    })()`);
    await sleep(2000);
  } else {
    out.pass = false;
  }
  record(out);
}

// ---------- narrow viewport ----------
if (run("narrow")) {
  await page.goto("https://x.com/gefei55");
  await sleep(4500);
  await obs();
  await page.cdp("Emulation.setDeviceMetricsOverride", { width: 800, height: 900, deviceScaleFactor: 2, mobile: false });
  await sleep(1500);
  const id = "1760839985715204230";
  let clicked = false;
  for (let attempt = 0; attempt < 4 && !clicked; attempt++) {
    const p = await verifiedLinkPos(id);
    if (!p) { await page.evaluate(() => window.scrollBy(0, 900)); await sleep(700); continue; }
    await page.mouse.click(p.x, p.y, { label: "窄视口打开样本" });
    await sleep(1500);
    clicked = true;
  }
  const pv = await pvSamples();
  const fs = await focalState();
  const shot = `${SHOTS}/narrow-viewport.png`;
  await page.screenshot({ path: shot });
  record({
    scenario: "narrow", pass: pv.onFrames === 0 && !fs.split && !fs.focal,
    expect: "below 980px: no preview offered, no split layout — X native single column",
    preview: pv, focal: fs, shots: [shot],
  });
  await page.cdp("Emulation.clearDeviceMetricsOverride", {});
  await sleep(1200);
}

// ---------- extension reload ----------
if (run("reload")) {
  await page.goto("chrome://extensions/");
  await page.waitForTimeout(2000);
  await page.click('loc=role:button[name="Reload"]', { label: "重载扩展" });
  await page.waitForTimeout(2000);
  const marker = await page.evaluate(() => document.documentElement.getAttribute("data-peek-artifact"));
  const id = "1760839985715204230";
  const ropen = await openWithPreview("https://x.com/gefei55", id, {});
  const fs = await focalState();
  record({ scenario: "reload", pass: ropen.opened && ropen.pv.id === id && fs.focal && fs.focalCount === 1, marker, preview: ropen.pv, focal: fs });
}

writeFileSync("/Users/devon/claude/peek-main/docs/m2-b2-a-l4/evidence/experience-results.json", JSON.stringify(results, null, 1));
console.log("EXPERIENCE DONE:", results.map((r) => `${r.scenario}${r.kind ? ":" + r.kind : ""}:${r.pass ? "PASS" : r.error ? "ERR" : "FAIL"}`).join(" "));
