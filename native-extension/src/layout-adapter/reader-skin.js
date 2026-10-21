import {t,setUILanguage,localizeUI} from '../i18n.js';
// Peek M2-B2-B — reader skin: the visual layer of the native split reader.
//
// Scope (S2 contract): VISUAL ONLY. This module owns the floating-card
// geometry, the theme palette for chrome, the reader top bar and the dimmed
// page canvas — plus one extension-owned node (the top bar) appended to
// <body>, never touching X's React tree. It does NOT touch GraphQL, fibers,
// the virtualizer retention wrap, data extraction, preview identity, native
// interactions, or credentials.
//
// Layering discipline: the controller's LAYOUT_CSS remains the functional
// baseline (edge-to-edge 52vw/48vw split, verified at L4). This skin mounts
// AFTER it with equal-specificity !important overrides; if the skin style is
// absent or removed the layout degrades gracefully to the L4 baseline.
//
// Dimming discipline (S3 remediation, measured live): the "surround" is the
// PAGE CANVAS COLOR, not an overlay. A fixed overlay above the page would also
// dim the reading card and the sheet (the card lives inside X's z-index:0
// wrapper contexts, so a root-level overlay paints over it — verified by pixel
// sampling), and a root-level z-index ≥1 chrome paints over X's #layers and
// swallows the image lightbox's own close control. So: the canvas (html/body)
// is dimmed, the card and sheet cells carry their own bright background, and
// the top bar sits at z-index 1 (above the sheet's stacking contexts) and
// yields to X's image lightbox via a CSS-only :has() rule while it is open.
//
// Two variants share one geometry source:
//   "floating" (A): inset rounded focal card + dimmed canvas + sheet margins
//   "flush"     (B): refined edge-to-edge split (fallback — same top bar)
// preview-layer.js reads the SAME geometry/palette helpers so the instant
// preview and the pinned native article are pixel-continuous.

export const SKIN_VARIANT = "floating"; // "floating" | "flush"

const GEOM_FLOATING = { topbarH: 52, topInset: 0, inset: 16, columnGap: 2, gap: 4, radius: 16 };
const GEOM_FLUSH = { topbarH: 52, topInset: 0, inset: 0, columnGap: 0, gap: 0, radius: 0 };

export function skinGeometry() {
  return { ...(SKIN_VARIANT === "flush" ? GEOM_FLUSH : GEOM_FLOATING) };
}

export function skinPalette(theme) {
  return theme === "dark"
    ? {
      card: "#000000", fg: "#e7e9ea", dim: "#71767b", border: "#2f3336",
      hover: "rgba(231,233,234,0.08)", accent: "#1d9bf0",
      page: SKIN_VARIANT === "flush" ? "#000000" : "#0b0e11",
      shadow: "none",
    }
    : {
      card: "#ffffff", fg: "#0f1419", dim: "#536471", border: "#eff3f4",
      hover: "rgba(15,20,25,0.06)", accent: "#1d9bf0",
      page: SKIN_VARIANT === "flush" ? "#ffffff" : "#edf1f4",
      shadow: "none",
    };
}

// The CSS custom properties the skin consumes. The controller's theme mirror
// owns their values (single writer, P1-C loop-free); these are the names.
export const SKIN_THEME_VARS = [
  "--peek-lad-fg", "--peek-lad-dim", "--peek-lad-hover",
  "--peek-lad-page", "--peek-lad-shadow",
];

export const SKIN_STYLE_ID = "peek-reader-skin";
export const SKIN_TOPBAR_ID = "peek-reader-topbar";

const ICON_BACK =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>';
const ICON_X_VIEW =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>';

// Skin CSS. Geometry vars are written here (not inline) so the whole visual
// layer is one stylesheet; media-gated exactly like LAYOUT_CSS — below 980px
// every rule (chrome included) is inert and the page is X's native column.
export function skinCss() {
  const g = skinGeometry();
  return `
@media (min-width: 980px) {
  html[data-peek-lad="on"] {
    --peek-reader-top: ${g.topbarH}px;
    --peek-reader-card-top: ${g.topbarH + g.topInset}px;
    --peek-reader-inset: ${g.inset}px;
    --peek-reader-gap: ${g.gap}px;
    --peek-reader-column-gap: ${g.columnGap}px;
    --peek-reader-radius: ${g.radius}px;
  }
  /* ---- focal post: floating reading card (flush variant: inset 0 → edge-to-edge) ---- */
  html[data-peek-lad="on"] article[data-peek-lad-focal] {
    left: var(--peek-reader-inset) !important;
    top: var(--peek-reader-card-top) !important;
    bottom: var(--peek-reader-inset) !important;
    width: calc(52vw - var(--peek-reader-inset) - var(--peek-reader-column-gap)) !important;
    /* X may temporarily disable its scrolling list; the pinned pane is independent. */
    pointer-events: auto !important;
    border: 1px solid var(--peek-lad-border, #eff3f4) !important;
    border-radius: var(--peek-reader-radius) !important;
    box-shadow: var(--peek-lad-shadow, none) !important;
    scrollbar-width: thin;
    scrollbar-color: var(--peek-lad-dim, #536471) transparent;
  }
  /* ---- right conversation sheet: constant geometry (never animated — the
     virtualizer measures cells against these widths) + card background so the
     dimmed canvas shows through the gaps as visual separation ---- */
  html[data-peek-lad="on"] [data-testid="cellInnerDiv"] {
    margin-left: calc(52vw + var(--peek-reader-column-gap)) !important;
    width: calc(48vw - var(--peek-reader-column-gap) - var(--peek-reader-inset)) !important;
    background: var(--peek-lad-bg, #ffffff);
  }
  /* X's own detail app bar ("← 帖子") is replaced by the reader top bar. The
     bar's DOM depth varies by X build, so mountSkinChrome TAGS it (attribute)
     instead of relying on a brittle structural selector. */
  html[data-peek-lad="on"] [data-peek-reader-appbar] {
    display: none !important;
  }
  /* conversation starts below the reader top bar: a CONSTANT offset applied to
     the list's scroll container (measurement-safe — set once at mount) */
  html[data-peek-lad="on"] [data-testid="primaryColumn"] section[role="region"] {
    padding-top: var(--peek-reader-card-top) !important;
  }
  /* X's column hairlines must not cross the canvas gaps */
  html[data-peek-lad="on"] [data-testid="primaryColumn"] {
    border-inline: 0 !important;
  }
  /* ---- dimmed page canvas: the "surround" IS the page background. The card
     and the sheet cells paint their own bright surface; every gap, margin and
     the strip under the top bar show this canvas colour. No overlay node, no
     stacking race. X's primary column paints its own theme background across
     the full viewport (measured), so it must carry the canvas colour too. ---- */
  html[data-peek-lad="on"], html[data-peek-lad="on"] body,
  html[data-peek-lad="on"] [data-testid="primaryColumn"] {
    background-color: var(--peek-lad-page, #edf1f4) !important;
  }
  /* ---- extension-owned chrome: the top bar IS the canvas colour (the page
     scrolls under it). X packs its whole page into root-level z-index:0
     contexts, so a z-index ≥1 bar is the only way to stay above the sheet —
     and that also puts it above X's #layers. While the image lightbox is open
     the bar therefore yields (CSS-only :has, no JS): the lightbox owns the
     screen and its own close control must never be covered (measured live). ---- */
  html[data-peek-lad="on"]:has([data-testid="swipe-to-dismiss"]) #${SKIN_TOPBAR_ID} {
    display: none !important;
  }
  #${SKIN_TOPBAR_ID} {
    position: fixed; top: 0; left: 0; right: 0; height: var(--peek-reader-top);
    z-index: 1; display: flex; align-items: center; gap: 4px;
    padding: 0 12px; box-sizing: border-box;
    background: var(--peek-lad-page, #edf1f4);
    color: var(--peek-lad-fg, #0f1419);
    font-family: inherit;
  }
  #${SKIN_TOPBAR_ID} .pk-tb-btn {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 36px; height: 36px; padding: 0 8px; box-sizing: border-box;
    border: 0; border-radius: 9999px; background: transparent;
    color: inherit; cursor: pointer; font: inherit;
  }
  #${SKIN_TOPBAR_ID} .pk-tb-btn:hover { background: var(--peek-lad-hover, rgba(15,20,25,0.06)); }
  #${SKIN_TOPBAR_ID} .pk-tb-btn:focus-visible {
    outline: 2px solid var(--peek-lad-accent, #1d9bf0); outline-offset: -2px;
  }
  #${SKIN_TOPBAR_ID} .pk-tb-title {
    font-size: 17px; font-weight: 700; line-height: 20px; margin-left: 4px;
    user-select: none;
  }
  #${SKIN_TOPBAR_ID} .pk-tb-spacer { flex: 1; }
  #${SKIN_TOPBAR_ID} .pk-tb-native {
    gap: 6px; font-size: 13px; color: var(--peek-lad-dim, #536471);
  }
  #${SKIN_TOPBAR_ID} .pk-tb-native:hover { color: var(--peek-lad-fg, #0f1419); }
}
@media (max-width: 979.98px) {
  /* below the split breakpoint the skin's chrome must not exist visually;
     the canvas rule above is inside the min-width block and is inert here */
  #${SKIN_TOPBAR_ID} { display: none !important; }
}`;
}

// ---------- chrome mount (controller calls with its close/release callbacks) ----------

let chrome = null; // { bar, appBar }

// Tag X's own detail app bar so the skin CSS can hide it. Structural depth of
// the bar varies across X builds; the stable anchor is the back button. The
// tagged element is the back button's ancestor that is a direct child of the
// primary column's inner wrapper (primaryColumn > wrapper > BAR). Cosmetic
// only: a miss leaves X's bar visible under ours, never breaks the layout.
function tagXAppBar() {
  try {
    const col = document.querySelector('[data-testid="primaryColumn"]');
    const back = col?.querySelector('[data-testid="app-bar-back"]');
    if (!col || !back) return null;
    let el = back;
    while (el && el !== col) {
      const p = el.parentElement;
      if (p === col || p?.parentElement === col) break;
      el = p;
    }
    if (el && el !== col && el.contains(back)) {
      el.setAttribute("data-peek-reader-appbar", "");
      return el;
    }
  } catch { /* tagging is cosmetic */ }
  return null;
}

export function mountSkinChrome({ onBack, onNativeView } = {}) {
  removeSkinChrome();
  const bar = document.createElement("div");
  bar.id = SKIN_TOPBAR_ID;
  bar.setAttribute("role", "toolbar");
  setUILanguage(document.documentElement.dataset.peekUiLanguage);
  bar.setAttribute("aria-label", t("ThreadLume 阅读器"));

  const back = document.createElement("button");
  back.type = "button";
  back.className = "pk-tb-btn";
  back.setAttribute("aria-label", t("返回"));
  back.innerHTML = ICON_BACK;
  back.addEventListener("click", () => { try { onBack?.(); } catch { /* close is best-effort */ } });

  const title = document.createElement("div");
  title.className = "pk-tb-title";
  title.textContent = "ThreadLume";

  const spacer = document.createElement("div");
  spacer.className = "pk-tb-spacer";

  const nativeBtn = document.createElement("button");
  nativeBtn.type = "button";
  nativeBtn.className = "pk-tb-btn pk-tb-native";
  nativeBtn.setAttribute("aria-label", t("切换 X 原生视图"));
  nativeBtn.innerHTML = `${ICON_X_VIEW}<span>${t("原生视图")}</span>`;
  nativeBtn.addEventListener("click", () => { try { onNativeView?.(); } catch { /* best-effort */ } });

  bar.append(back, title, spacer, nativeBtn);
  chrome = { bar, appBar: tagXAppBar() };
  try {
    document.body?.appendChild(bar);
  } catch (err) {
    // half-mounted chrome must not survive — drop both nodes and rethrow so
    // the caller's own failure path (layout teardown) sees it
    removeSkinChrome();
    throw err;
  }
  return chrome;
}

export function removeSkinChrome() {
  if (!chrome) {
    // defensive: a node may exist from a crashed mount without module state
    document.getElementById(SKIN_TOPBAR_ID)?.remove();
    document.querySelector("[data-peek-reader-appbar]")?.removeAttribute("data-peek-reader-appbar");
    return;
  }
  chrome.bar?.remove();
  try { chrome.appBar?.removeAttribute("data-peek-reader-appbar"); } catch { /* node gone */ }
  chrome = null;
}

export function mountSkinStyle() {
  if (document.getElementById(SKIN_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = SKIN_STYLE_ID;
  style.textContent = skinCss();
  document.head?.appendChild(style);
}

export function removeSkinStyle() {
  document.getElementById(SKIN_STYLE_ID)?.remove();
}

export const skinChromeMounted = () => Boolean(chrome);

if(typeof window!=='undefined')window.addEventListener('peek-ui-language',event=>{const value=event.detail?.language;if(!['en','zh-CN'].includes(value))return;setUILanguage(value);localizeUI(document.getElementById(SKIN_TOPBAR_ID),value);});
