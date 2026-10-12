// Peek Native — focal-post extraction from X's own rendered DOM (R4-verified).
// GraphQL remains authoritative in the product contract; here the native detail
// page IS the data source — we only read what X itself renders for the user.
// Every helper is pure DOM reading: no fetch/XHR, no webpack probing, no
// credential capture, no writes.

import { statusIdFromPath, sleep } from "./constants.js";

export function parseCount(text) {
  const m = String(text ?? "").trim().match(/^([\d.,]+)\s*([KMkM])?$/);
  if (!m) return null; // unknown — never fabricate 0
  const base = parseFloat(m[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;
  return Math.round(base * (m[2] === "K" || m[2] === "k" ? 1e3 : m[2] === "M" ? 1e6 : 1));
}

export function countOf(root, name) {
  // X flips the testid with state: like/unlike, retweet/unretweet, bookmark/unbookmark
  const active = Boolean(root.querySelector(`[data-testid="un${name}"]`));
  const node = root.querySelector(`[data-testid="${name}"], [data-testid="un${name}"]`);
  // zero-count buttons render no text; the number lives in aria-label ("0 喜欢次数。喜欢")
  const aria = node?.getAttribute("aria-label") || "";
  const fromAria = aria ? parseCount(aria.match(/^([\d.,]+\s*[KMkM]?)/)?.[1] ?? "") : null;
  const value = parseCount(node?.innerText) ?? fromAria;
  return { value, active, known: Boolean(node) };
}

export function focalCellByStatusId(focalId) {
  // The matching timestamp link must NOT sit inside a quote card
  // (div[role="link"]): a timeline cell that merely QUOTES the focal post
  // would otherwise match and feed the pane the quoter's content. The
  // post's own cell (timeline or detail) nests its time link directly.
  return [...document.querySelectorAll('[data-testid="cellInnerDiv"]')]
    .find((cell) => [...cell.querySelectorAll(`a[href*="/status/${focalId}"]`)]
      .some((a) => a.querySelector("time") && !a.closest('div[role="link"]')));
}

// Photo URLs inside `scope`, skipping any img contained in one of the
// `excludes` subtrees. Video posters (ext_tw_video_thumb) and card thumbnails
// (card_img) do not match the selector, so they are never attributed as post
// photos; quote/card media are excluded structurally by the callers.
export function photoUrlsIn(scope, ...excludes) {
  const urls = [];
  for (const img of scope.querySelectorAll('[data-testid="tweetPhoto"] img, img[src*="pbs.twimg.com/media"]')) {
    if (excludes.some((ex) => ex && ex.contains(img))) continue;
    if (!img.src) continue; // half-hydrated media: skip rather than render ""
    urls.push(img.src);
  }
  return [...new Set(urls)];
}

// Quote cards are div[role="link"]; so are website cards. A quote card nests
// the quoted author or text (or is the last role=link after media/cards —
// X renders quotes at the bottom), and never contains card.wrapper.
export function findQuoteNode(art) {
  const isCard = (n) => n.getAttribute("data-testid") === "card.wrapper" || Boolean(n.querySelector('[data-testid="card.wrapper"]'));
  const candidates = [...art.querySelectorAll('div[role="link"]')].filter((n) => !isCard(n));
  return candidates.find((n) => n.querySelector('[data-testid="tweetText"], [data-testid="User-Name"]'))
    || candidates[candidates.length - 1]
    || null;
}

// X Articles render title/body in dedicated containers (not tweetText).
export function extractArticle(art) {
  const title = art.querySelector('[data-testid="twitter-article-title"]')?.innerText?.trim() || null;
  const body = art.querySelector('[data-testid="twitterArticleRichTextView"]');
  if (!body) return null;
  return { title, text: body.innerText || "", photos: photoUrlsIn(body) };
}

// Logged-out / no-testid fallback. Non-body chrome is skipped POSITIONALLY
// (the action-bar group / count nodes, the timestamp, the quote card, cards,
// the player are never descended into), so a body line like "2026" or "42"
// survives even when it textually equals an engagement count; unknown stays
// unknown. No text-equality matching is involved.
export function fallbackText(art) {
  const UI_LINE = /^(show translation|显示翻译|translate post|show more|显示更多)$/i;
  const SKIP_SEL = '[role="group"], [data-testid="like"], [data-testid="retweet"], [data-testid="reply"], [data-testid="bookmark"], time, div[role="link"], [data-testid="card.wrapper"], [data-testid="videoPlayer"]';
  const blocks = [];
  const collect = (node) => {
    if (node.matches?.(SKIP_SEL)) return; // positionally excluded subtree
    if (!node.querySelector(SKIP_SEL)) {
      const text = String(node.innerText || "").trim();
      if (text) blocks.push(text);
      return;
    }
    for (const child of node.children) collect(child);
  };
  collect(art);
  const lines = blocks.join("\n").split("\n").map((l) => l.trim()).filter(Boolean)
    .filter((l) => !UI_LINE.test(l));
  const handleIdx = lines.slice(0, 3).findIndex((l) => l.startsWith("@") && l.length <= 20);
  if (handleIdx >= 0) lines.splice(0, handleIdx + 1);
  return lines.join("\n");
}

export function findShowMore(art) {
  // Premium long posts collapse the body behind a show-more link.
  const quote = findQuoteNode(art);
  return [...art.querySelectorAll('[data-testid="tweet-text-show-more-link"], a[href*="show-more"], [role="button"]')]
    .filter((el) => !(quote && quote.contains(el)))
    .find((el) => /^(显示更多|Show more)$/i.test((el.innerText || "").trim())) || null;
}

export async function expandShowMore(art) {
  // One display expansion, bounded to the focal article (never inside the
  // quote card), mirrors what a reading user does. Not an account write.
  const more = findShowMore(art);
  if (more) {
    more.click();
    await sleep(700);
  }
}

export async function extractFocal(focalId, isCurrent, { expand = true } = {}) {
  if (statusIdFromPath() !== focalId) return null;
  const cell = focalCellByStatusId(focalId);
  const art = cell && (cell.querySelector("article[data-testid='tweet']") || cell.querySelector("article"));
  if (!art) return null;
  if (expand) {
    await expandShowMore(art);
    // the show-more wait is an async gap: the route may have moved, or React
    // virtualization may have recycled the cell — never extract a stale node
    if (!isCurrent() || statusIdFromPath() !== focalId) return null;
    if (!cell.isConnected || !art.isConnected) return null;
  }
  return { ...extractFromArticle(art, focalId), nativeCell: cell };
}

export function extractFromArticle(art, focalId) {
  const handle = [...art.querySelectorAll('a[href^="/"]')]
    .map((a) => a.getAttribute("href"))
    .find((h) => /^\/[^/]+$/.test(h));
  const nameNode = art.querySelector('[data-testid="User-Name"]');
  // rich media the pane mirrors but never hides — the native cell stays visible
  const video = Boolean(art.querySelector('[data-testid="videoPlayer"]')) || Boolean(art.querySelector("video"));
  const poll = Boolean(art.querySelector('[data-testid="poll"], [role="group"] [data-testid="vote"]'));
  const cardNode = art.querySelector('[data-testid="card.wrapper"]');
  const quoteNode = findQuoteNode(art);
  const quoteAuthorNode = quoteNode?.querySelector('[data-testid="User-Name"]');
  const quoteAuthor = quoteAuthorNode?.innerText.split("\n")[0] || null;
  let quoteText = quoteNode?.querySelector('[data-testid="tweetText"]')?.innerText || "";
  if (quoteAuthor && quoteText.trim().startsWith(quoteAuthor.trim())) {
    quoteText = quoteText.trim().slice(quoteAuthor.trim().length).replace(/^\s+/, "");
  }
  const article = extractArticle(art);
  let text, textSource;
  if (article) {
    text = article.title ? `${article.title}\n\n${article.text}` : article.text;
    textSource = "article";
  } else {
    const textNode = art.querySelector('[data-testid="tweetText"]');
    text = textNode ? textNode.innerText : "";
    textSource = "tweetText";
    if (!textNode) {
      text = fallbackText(art);
      textSource = "fallback";
    }
  }
  // main-post photos: everything photo-shaped in the article minus the quote
  // and website-card subtrees (article body images + article cover included)
  const photos = photoUrlsIn(art, quoteNode, cardNode);
  return {
    statusId: focalId,
    name: nameNode ? nameNode.innerText.split("\n")[0] : (handle ? handle.slice(1) : "未知作者"),
    handle: handle || "",
    avatar: art.querySelector('img[src*="profile_images"]')?.src || "",
    time: art.querySelector("time")?.getAttribute("datetime") || "",
    timeText: art.querySelector("time")?.innerText || "",
    text,
    textKnown: text.trim().length > 0, // absent text node = unknown, not empty
    textSource,
    photos,
    showMorePending: Boolean(findShowMore(art)), // collapsed body: first paint shows it, upgrade follows
    quote: quoteNode ? {
      author: quoteAuthor,
      text: quoteText,
      photos: photoUrlsIn(quoteNode)
    } : null,
    rich: { video, poll, card: Boolean(cardNode), article: Boolean(article) },
    reply: countOf(art, "reply"),
    retweet: countOf(art, "retweet"),
    like: countOf(art, "like"),
    bookmark: countOf(art, "bookmark")
  };
}
