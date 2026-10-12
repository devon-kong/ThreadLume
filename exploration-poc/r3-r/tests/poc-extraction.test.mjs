// R3-R content-extraction tests (P0-C1/C2/C3/C4).
// Every assertion runs against the REAL production extraction functions
// (loaded from exploration-poc/mv3-poc/content.js via the shared harness) —
// no test-only reimplementation of extraction logic.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeEnv, makeStatusId, buildCell, buildAuthor, buildTweetText,
  buildPhoto, buildActionBar,
} from "./poc-env.mjs";

const MEDIA = "https://pbs.twimg.com/media/";
let doc = null;

function loadPoc() {
  const env = makeEnv();
  const poc = env.boot();
  doc = env.document;
  return { env, poc };
}

function mainPostFixture(statusId, text, children = []) {
  return { statusId, articleChildren: [buildAuthor(), buildTweetText(text), ...children, buildActionBar()] };
}

function bodyLine(text) {
  const d = doc.createElement("div");
  d.textContent = text;
  return d;
}

function buildQuote({ withPhoto = true } = {}) {
  const node = doc.createElement("div");
  node.setAttribute("role", "link");
  node.appendChild(buildAuthor({ name: "引用者", handle: "quoter" }));
  node.appendChild(buildTweetText("引用的正文"));
  if (withPhoto) node.appendChild(buildPhoto(MEDIA + "quote1.jpg"));
  return node;
}

test("extractFromArticle: 主帖基本字段（作者/handle/正文/时间/计数）", () => {
  const { poc } = loadPoc();
  const id = makeStatusId();
  const { art } = buildCell(mainPostFixture(id, "正文第一行\n2026", [buildPhoto(MEDIA + "abc123.jpg")]));
  const d = poc.extractFromArticle(art, id);
  assert.equal(d.statusId, id);
  assert.equal(d.name, "葛飞");
  assert.equal(d.handle, "/gefei55");
  assert.equal(d.textSource, "tweetText");
  assert.equal(d.textKnown, true);
  assert.ok(d.text.includes("2026"), "numeric body line preserved");
  assert.deepEqual(d.photos, [MEDIA + "abc123.jpg"]);
  assert.equal(d.reply.value, 12);
  assert.equal(d.retweet.value, 3);
  assert.equal(d.like.value, 42);
  assert.equal(d.like.active, false);
  assert.equal(d.bookmark.known, true);
  assert.equal(d.bookmark.value, null, "empty bookmark count is unknown, never 0");
  assert.equal(d.time, "2026-10-12T10:00:00.000Z");
});

test("C2 引用帖媒体归属：主帖照片与引用帖照片互不混入", () => {
  const { poc } = loadPoc();
  const id = makeStatusId();
  const { art } = buildCell(mainPostFixture(id, "主帖正文", [buildPhoto(MEDIA + "main1.jpg"), buildQuote()]));
  const d = poc.extractFromArticle(art, id);
  assert.deepEqual(d.photos, [MEDIA + "main1.jpg"], "main photos exclude the quote subtree");
  assert.equal(d.quote.author, "引用者");
  assert.equal(d.quote.text, "引用的正文");
  assert.deepEqual(d.quote.photos, [MEDIA + "quote1.jpg"]);
});

test("C2 主帖与引用帖均有图片 + 网站卡片：卡片缩略图不归属任何一方", () => {
  const { poc } = loadPoc();
  const id = makeStatusId();
  // website card BEFORE the quote card (X DOM order), with a card_img thumbnail
  const card = doc.createElement("div");
  card.setAttribute("role", "link");
  const wrapper = doc.createElement("div");
  wrapper.setAttribute("data-testid", "card.wrapper");
  const thumb = doc.createElement("img");
  thumb.src = "https://pbs.twimg.com/card_img/12345/img/xxx";
  wrapper.appendChild(thumb);
  const cardTitle = doc.createElement("div");
  cardTitle.textContent = "Reuters 新闻标题";
  wrapper.appendChild(cardTitle);
  card.appendChild(wrapper);
  const { art } = buildCell(mainPostFixture(id, "主帖正文", [buildPhoto(MEDIA + "main1.jpg"), card, buildQuote()]));
  const d = poc.extractFromArticle(art, id);
  assert.deepEqual(d.photos, [MEDIA + "main1.jpg"], "card thumbnail excluded from main photos");
  assert.equal(d.quote.author, "引用者", "quote detected structurally, card never mistaken for the quote");
  assert.deepEqual(d.quote.photos, [MEDIA + "quote1.jpg"]);
  assert.equal(d.rich.card, true);
});

test("C2 仅网站卡片（无引用帖）时不得误判为引用", () => {
  const { poc } = loadPoc();
  const id = makeStatusId();
  const card = doc.createElement("div");
  card.setAttribute("role", "link");
  const wrapper = doc.createElement("div");
  wrapper.setAttribute("data-testid", "card.wrapper");
  const thumb = doc.createElement("img");
  thumb.src = "https://pbs.twimg.com/card_img/999/img/yyy";
  wrapper.appendChild(thumb);
  card.appendChild(wrapper);
  const { art } = buildCell(mainPostFixture(id, "主帖正文", [card]));
  const d = poc.extractFromArticle(art, id);
  assert.equal(d.quote, null, "card.wrapper subtree is never a quote");
  assert.deepEqual(d.photos, [], "card thumbnail not attributed as a post photo");
});

test("C2 已删除引用占位（无嵌套 User-Name/tweetText）仍识别为引用", () => {
  const { poc } = loadPoc();
  const id = makeStatusId();
  const placeholder = doc.createElement("div");
  placeholder.setAttribute("role", "link");
  placeholder.textContent = "这个帖子不可用。了解更多";
  const { art } = buildCell(mainPostFixture(id, "主帖正文", [placeholder]));
  const d = poc.extractFromArticle(art, id);
  assert.ok(d.quote, "deleted-quote placeholder still resolves as the quote node");
});

test("C2 视频封面不归属为照片；/media 卡片图不归属主帖", () => {
  const { poc } = loadPoc();
  const id = makeStatusId();
  const videoPlayer = doc.createElement("div");
  videoPlayer.setAttribute("data-testid", "videoPlayer");
  const poster = doc.createElement("img");
  poster.src = "https://pbs.twimg.com/ext_tw_video_thumb/123/pu/img/abc.jpg";
  videoPlayer.appendChild(poster);
  // a website card whose thumbnail is (legacy-style) a /media URL — must be
  // excluded structurally, not just by URL shape
  const card = doc.createElement("div");
  card.setAttribute("role", "link");
  const wrapper = doc.createElement("div");
  wrapper.setAttribute("data-testid", "card.wrapper");
  const legacyThumb = doc.createElement("img");
  legacyThumb.src = MEDIA + "cardthumb.jpg";
  wrapper.appendChild(legacyThumb);
  card.appendChild(wrapper);
  const { art } = buildCell(mainPostFixture(id, "视频帖", [videoPlayer, card]));
  const d = poc.extractFromArticle(art, id);
  assert.deepEqual(d.photos, [], "video poster and card media never attributed as post photos");
  assert.equal(d.rich.video, true);
});

test("B5/C2 X Article：专用容器提取标题+正文；封面图归属主帖且不重复", () => {
  const { poc } = loadPoc();
  const id = makeStatusId();
  const readView = doc.createElement("div");
  readView.setAttribute("data-testid", "twitterArticleReadView");
  const coverWrap = doc.createElement("div");
  coverWrap.setAttribute("data-testid", "tweetPhoto");
  const cover = doc.createElement("img");
  cover.src = MEDIA + "cover1.jpg";
  coverWrap.appendChild(cover);
  readView.appendChild(coverWrap);
  const title = doc.createElement("div");
  title.setAttribute("data-testid", "twitter-article-title");
  title.textContent = "文章标题";
  readView.appendChild(title);
  const body = doc.createElement("div");
  body.setAttribute("data-testid", "twitterArticleRichTextView");
  const p1 = doc.createElement("div");
  p1.textContent = "第一段。";
  const bodyPhotoWrap = doc.createElement("div");
  bodyPhotoWrap.setAttribute("data-testid", "tweetPhoto");
  const bodyImg = doc.createElement("img");
  bodyImg.src = MEDIA + "body1.jpg";
  bodyPhotoWrap.appendChild(bodyImg);
  body.append(p1, bodyPhotoWrap);
  readView.appendChild(body);
  const { art } = buildCell({ statusId: id, articleChildren: [buildAuthor(), readView, buildActionBar()] });
  const d = poc.extractFromArticle(art, id);
  assert.equal(d.textSource, "article");
  assert.ok(d.text.startsWith("文章标题"), "title first");
  assert.ok(d.text.includes("第一段"));
  assert.deepEqual([...d.photos], [MEDIA + "cover1.jpg", MEDIA + "body1.jpg"], "cover + body photo, once each, no duplication");
  const a = poc.extractArticle(art);
  assert.deepEqual(a.photos, [MEDIA + "body1.jpg"], "article-scoped photos exclude the cover");
  assert.equal(a.title, "文章标题");
});

test("C1 fallbackText：互动计数按结构剔除，正文数字行完整保留", () => {
  const { poc } = loadPoc();
  const id = makeStatusId();
  // logged-out shape: no tweetText node; body contains meaningful bare numbers
  const { art } = buildCell({
    statusId: id,
    articleChildren: [
      buildAuthor(),
      bodyLine("免费领 Cursor Pro：保姆级图文教程"),
      bodyLine("2026"),
      bodyLine("42"),
      bodyLine("0"),
      bodyLine("实测日期：2026-10-11"),
      buildActionBar({ reply: "3", retweet: "3", like: "11", bookmark: "3,578" }),
      bodyLine("显示翻译"),
    ],
  });
  const text = poc.fallbackText(art);
  assert.ok(text.includes("免费领 Cursor Pro"), "body starts at the title");
  assert.ok(/\n2026\n/.test("\n" + text + "\n"), "body number line 2026 survives");
  assert.ok(/\n42\n/.test("\n" + text + "\n"), "body number line 42 survives");
  assert.ok(/\n0\n/.test("\n" + text + "\n"), "body number line 0 survives");
  assert.ok(text.includes("实测日期"), "body content preserved");
  assert.ok(!/显示翻译/.test(text), "UI lines filtered");
  assert.ok(!/\n3\n/.test("\n" + text + "\n"), "action-bar count lines still excluded (structural)");
  assert.ok(!text.includes("3,578"), "bookmark count excluded (structural)");
  assert.equal(poc.extractFromArticle(art, id).textSource, "fallback");
});

test("C1 fallbackText：引用子树文本不混入主帖正文", () => {
  const { poc } = loadPoc();
  const id = makeStatusId();
  const { art } = buildCell({
    statusId: id,
    articleChildren: [buildAuthor(), bodyLine("主帖正文"), buildQuote({ withPhoto: false }), buildActionBar()],
  });
  const text = poc.fallbackText(art);
  assert.ok(text.includes("主帖正文"));
  assert.ok(!text.includes("引用的正文"), "quote text rendered separately, not in main text");
});

test("C1 fallbackText：文本碰撞边界——正文数字与计数文本相同时仍保留正文行", () => {
  const { poc } = loadPoc();
  const id = makeStatusId();
  const { art } = buildCell({
    statusId: id,
    articleChildren: [
      buildAuthor(),
      bodyLine("42"),
      bodyLine("正文继续"),
      buildActionBar({ reply: "3", retweet: "11", like: "42", bookmark: "3,578" }),
    ],
  });
  const text = poc.fallbackText(art);
  assert.ok(/\n42\n/.test("\n" + text + "\n"), "body line 42 survives even though the like count is also 42 (positional skip, no text matching)");
  assert.ok(!text.includes("3,578"), "action-bar counts still excluded positionally");
  assert.ok(text.includes("正文继续"));
});

test("C1 fallbackText：正文内 @提及保留、无 DOM 计数节点时不误删数字", () => {
  const { poc } = loadPoc();
  const id = makeStatusId();
  const { art } = buildCell({
    statusId: id,
    articleChildren: [buildAuthor(), bodyLine("作者"), bodyLine("@someone"), bodyLine("这条 @xiangxiang103 说得对"), bodyLine("11")],
  });
  const text = poc.fallbackText(art);
  assert.ok(text.includes("@xiangxiang103"), "in-body mentions preserved");
  assert.ok(/\n11\n/.test("\n" + text + "\n"), "no action-bar group in DOM → bare number lines are content, kept");
});

test("countOf: 状态翻转（unlike）、aria 零值回退、垃圾文本标未知", () => {
  const { poc } = loadPoc();
  const id = makeStatusId();
  const { art } = buildCell({ statusId: id, articleChildren: [buildAuthor(), buildTweetText("正文"), buildActionBar({ like: "0" })] });
  const like = poc.countOf(art, "like");
  assert.equal(like.value, 0, "zero from aria-label, not fabricated");
  assert.equal(like.known, true);
  const likeBtn = art.querySelector('[data-testid="like"]');
  likeBtn.removeAttribute("data-testid");
  likeBtn.setAttribute("data-testid", "unlike");
  likeBtn.textContent = "1,282";
  const flipped = poc.countOf(art, "like");
  assert.equal(flipped.active, true, "unlike testid → active state");
  assert.equal(flipped.value, 1282);
  likeBtn.textContent = "2万";
  likeBtn.removeAttribute("aria-label"); // isolate the text-unparseable path
  const garbage = poc.countOf(art, "like");
  assert.equal(garbage.known, true);
  assert.equal(garbage.value, null, "CJK unit with no aria fallback → unknown, never fabricated");
});

test("photoUrlsIn: 空 src（半水合媒体）跳过、重复 URL 去重", () => {
  const { poc } = loadPoc();
  const scope = doc.createElement("div");
  const p1 = doc.createElement("div");
  p1.setAttribute("data-testid", "tweetPhoto");
  p1.appendChild(doc.createElement("img")); // no src yet
  const p2 = doc.createElement("div");
  p2.setAttribute("data-testid", "tweetPhoto");
  const img2 = doc.createElement("img");
  img2.src = MEDIA + "dup.jpg";
  p2.appendChild(img2);
  const p3 = doc.createElement("div");
  p3.setAttribute("data-testid", "tweetPhoto");
  const img3 = doc.createElement("img");
  img3.src = MEDIA + "dup.jpg";
  p3.appendChild(img3);
  scope.append(p1, p2, p3);
  assert.deepEqual(poc.photoUrlsIn(scope), [MEDIA + "dup.jpg"], "empty src skipped, duplicates merged");
});

test("C3 Article 结构化能力探针：标题/段落/子标题/链接/列表/图片顺序/引用可结构化枚举", () => {
  const { poc } = loadPoc();
  const id = makeStatusId();
  const readView = doc.createElement("div");
  readView.setAttribute("data-testid", "twitterArticleReadView");
  const title = doc.createElement("div");
  title.setAttribute("data-testid", "twitter-article-title");
  title.textContent = "深度报告";
  const rich = doc.createElement("div");
  rich.setAttribute("data-testid", "twitterArticleRichTextView");
  const h2a = doc.createElement("h2");
  h2a.textContent = "第一节";
  const p1 = doc.createElement("div");
  const link = doc.createElement("a");
  link.setAttribute("href", "https://example.com/source");
  link.textContent = "引用来源";
  p1.appendChild(link);
  const ul = doc.createElement("ul");
  for (const item of ["要点一", "要点二", "要点三"]) {
    const li = doc.createElement("li");
    li.textContent = item;
    ul.appendChild(li);
  }
  const bq = doc.createElement("blockquote");
  bq.textContent = "引述原文";
  const imgWrap = doc.createElement("div");
  imgWrap.setAttribute("data-testid", "tweetPhoto");
  const i1 = doc.createElement("img");
  i1.src = MEDIA + "art1.jpg";
  imgWrap.appendChild(i1);
  const imgWrap2 = doc.createElement("div");
  imgWrap2.setAttribute("data-testid", "tweetPhoto");
  const i2 = doc.createElement("img");
  i2.src = MEDIA + "art2.jpg";
  imgWrap2.appendChild(i2);
  rich.append(h2a, p1, ul, bq, imgWrap, imgWrap2);
  readView.append(title, rich);
  const { art } = buildCell({ statusId: id, articleChildren: [buildAuthor(), readView] });

  const d = poc.extractFromArticle(art, id);
  assert.equal(d.textSource, "article");
  assert.ok(d.text.includes("深度报告") && d.text.includes("第一节") && d.text.includes("要点三") && d.text.includes("引述原文"), "full text via innerText");
  assert.deepEqual(d.photos, [MEDIA + "art1.jpg", MEDIA + "art2.jpg"], "image ORDER preserved");

  // structural probe (capability survey — informs r3-r-data-integrity.md, not a renderer)
  const richView = art.querySelector('[data-testid="twitterArticleRichTextView"]');
  const probe = {
    subheads: [...richView.querySelectorAll("h1,h2,h3")].map((h) => h.textContent),
    links: [...richView.querySelectorAll("a[href]")].map((a) => [a.textContent, a.getAttribute("href")]),
    listItems: richView.querySelectorAll("li").length,
    blockquote: richView.querySelector("blockquote")?.textContent ?? null,
  };
  assert.deepEqual(probe.subheads, ["第一节"], "subheading structure is enumerable");
  assert.deepEqual(probe.links, [["引用来源", "https://example.com/source"]], "links with hrefs are enumerable");
  assert.equal(probe.listItems, 3, "list structure is enumerable");
  assert.equal(probe.blockquote, "引述原文", "blockquotes are enumerable");
});
