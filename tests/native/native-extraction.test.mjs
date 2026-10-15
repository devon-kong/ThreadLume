// M1 Native content-extraction tests: the R4-verified extraction semantics
// must survive the engineering re-packaging, driven through the REAL built
// artifact. Scenario set mirrors the R3-R/R4 extraction contract (identity,
// quote-not-focal guard, counts, photos, article, positional fallback).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeEnv, makeStatusId, buildCell, buildAuthor, buildTweetText,
  buildPhoto, buildActionBar, mountCell,
} from "./native-env.mjs";

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

test("提取：主帖基本字段（作者/handle/正文/时间/计数）", () => {
  const { poc } = loadPoc();
  const id = makeStatusId();
  const { art } = buildCell(mainPostFixture(id, "正文第一行\n2026", [buildPhoto(MEDIA + "abc123.jpg")]));
  const d = poc.extractFromArticle(art, id);
  assert.equal(d.statusId, id);
  assert.equal(d.name, "葛飞");
  assert.equal(d.handle, "/gefei55");
  assert.equal(d.textSource, "tweetText");
  assert.equal(d.textKnown, true);
  assert.equal(d.text, "正文第一行\n2026");
  assert.equal(d.time, "2026-10-12T10:00:00.000Z");
  assert.equal(d.reply.value, 12);
  assert.equal(d.like.value, 42);
  assert.deepEqual(d.photos, [MEDIA + "abc123.jpg"]);
});

test("提取：引用帖不被误当焦点帖（引用卡内时间链接不匹配）", () => {
  const { poc } = loadPoc();
  const focalId = makeStatusId();
  const { cell } = buildCell({
    statusId: makeStatusId(),
    articleChildren: [buildAuthor(), buildTweetText("引用者的正文")],
  });
  const quoteCard = doc.createElement("div");
  quoteCard.setAttribute("role", "link");
  const link = doc.createElement("a");
  link.setAttribute("href", `/somebody/status/${focalId}`);
  const t = doc.createElement("time");
  t.setAttribute("datetime", "2026-10-12T10:00:00.000Z");
  link.appendChild(t);
  quoteCard.appendChild(link);
  cell.appendChild(quoteCard);
  doc.body.appendChild(cell);
  assert.equal(poc.focalCellByStatusId(focalId), undefined, "a cell that only quotes the post never matches");
});

test("提取：真实焦点格（时间链接不在引用卡内）匹配", () => {
  const { poc } = loadPoc();
  const id = makeStatusId();
  const { cell } = buildCell(mainPostFixture(id, "正文"));
  doc.body.appendChild(cell);
  assert.equal(Boolean(poc.focalCellByStatusId(id)), true);
});

test("提取：引用内容提取（作者/正文去重/引用图片）且主帖图片不含引用图", () => {
  const { poc } = loadPoc();
  const id = makeStatusId();
  const quote = buildQuote();
  const { art } = buildCell(mainPostFixture(id, "主帖正文", [buildPhoto(MEDIA + "main1.jpg"), quote]));
  const d = poc.extractFromArticle(art, id);
  assert.equal(d.quote.author, "引用者");
  assert.equal(d.quote.text, "引用的正文");
  assert.deepEqual(d.quote.photos, [MEDIA + "quote1.jpg"]);
  assert.deepEqual(d.photos, [MEDIA + "main1.jpg"], "quote photos never attributed to the main post");
});

test("提取：计数以 aria-label 兜底，0 与未知区分（绝不伪造 0）", () => {
  const { poc } = loadPoc();
  const id = makeStatusId();
  // bookmark button with no text and aria "0 书签次数。书签"
  const { art } = buildCell({ statusId: id, articleChildren: [buildAuthor(), buildTweetText("正文"), buildActionBar({ bookmark: "0" })] });
  const d = poc.extractFromArticle(art, id);
  assert.equal(d.bookmark.value, 0);
  assert.equal(d.bookmark.known, true);
  // remove the whole bookmark button: unknown, never 0
  art.querySelector('[data-testid="bookmark"]').remove();
  const d2 = poc.extractFromArticle(art, id);
  assert.equal(d2.bookmark.known, false);
  assert.equal(d2.bookmark.value, null);
});

test("提取：K/M 缩写计数解析", () => {
  const { poc } = loadPoc();
  assert.equal(poc.parseCount("1,234").valueOf(), 1234);
  assert.equal(poc.parseCount("12K"), 12000);
  assert.equal(poc.parseCount("1.5M"), 1500000);
  assert.equal(poc.parseCount("查看翻译"), null);
});

test("提取：无 tweetText 时的位置式回退正文（动作条/时间行不混入，正文数字行保留）", () => {
  const { poc } = loadPoc();
  const id = makeStatusId();
  const { art } = buildCell({ statusId: id, articleChildren: [buildAuthor(), bodyLine("真正的正文内容"), bodyLine("2026"), buildActionBar()] });
  const d = poc.extractFromArticle(art, id);
  assert.equal(d.textSource, "fallback");
  assert.equal(d.text, "真正的正文内容\n2026", "positional exclusion keeps the action bar out; a numeric body line legitimately survives");
});

test("提取：X Article 正文与图片归入主帖（标题+正文）", () => {
  const { poc } = loadPoc();
  const id = makeStatusId();
  const title = doc.createElement("div");
  title.setAttribute("data-testid", "twitter-article-title");
  title.textContent = "文章标题";
  const richBody = doc.createElement("div");
  richBody.setAttribute("data-testid", "twitterArticleRichTextView");
  const p = doc.createElement("div");
  p.textContent = "文章第一段";
  richBody.appendChild(p);
  richBody.appendChild(buildPhoto(MEDIA + "article-cover.jpg"));
  const { art } = buildCell({ statusId: id, articleChildren: [buildAuthor(), title, richBody, buildActionBar()] });
  const d = poc.extractFromArticle(art, id);
  assert.equal(d.textSource, "article");
  assert.equal(d.text, "文章标题\n\n文章第一段");
  assert.deepEqual(d.photos, [MEDIA + "article-cover.jpg"]);
  assert.equal(d.rich.article, true);
});

test("提取：网站卡片缩略图不算主帖照片", () => {
  const { poc } = loadPoc();
  const id = makeStatusId();
  const card = doc.createElement("div");
  card.setAttribute("data-testid", "card.wrapper");
  card.appendChild(buildPhoto(MEDIA + "card-img.jpg", { inTweetPhoto: false }));
  const { art } = buildCell(mainPostFixture(id, "带卡片正文", [card]));
  const d = poc.extractFromArticle(art, id);
  assert.deepEqual(d.photos, [], "card thumbnails are never post photos");
  assert.equal(d.rich.card, true);
});

test("提取：视频/投票富媒体标记", () => {
  const { poc } = loadPoc();
  const id = makeStatusId();
  const player = doc.createElement("div");
  player.setAttribute("data-testid", "videoPlayer");
  const { art } = buildCell(mainPostFixture(id, "视频帖", [player]));
  const d = poc.extractFromArticle(art, id);
  assert.equal(d.rich.video, true);

  const poll = doc.createElement("div");
  poll.setAttribute("data-testid", "poll");
  const { art: art2 } = buildCell(mainPostFixture(id, "投票帖", [poll]));
  const d2 = poc.extractFromArticle(art2, id);
  assert.equal(d2.rich.poll, true);
});

test("提取：当前 X radiogroup/radio 投票进入即时预览标记", () => {
  const { poc } = loadPoc();
  const id = makeStatusId();
  // X's current poll markup has a radiogroup containing role="radio"
  // choices, but no poll/vote testid. The preview must announce it.
  const group = doc.createElement("div");
  group.setAttribute("role", "radiogroup");
  const option = doc.createElement("div");
  option.setAttribute("role", "radio");
  group.appendChild(option);
  const { art: art3 } = buildCell(mainPostFixture(id, "投票帖", [group]));
  const d3 = poc.extractFromArticle(art3, id);
  assert.equal(d3.rich.poll, true);
});

test("提取：引用卡内投票不归属主帖", () => {
  const { poc } = loadPoc();
  const id = makeStatusId();
  const quote = buildQuote({ withPhoto: false });
  const group = doc.createElement("div");
  group.setAttribute("role", "radiogroup");
  const option = doc.createElement("div");
  option.setAttribute("role", "radio");
  group.appendChild(option);
  quote.appendChild(group);
  const { art } = buildCell(mainPostFixture(id, "主帖正文", [quote]));
  const data = poc.extractFromArticle(art, id);
  assert.equal(data.rich.poll, false, "quoted poll must not appear as a focal-post poll");
  assert.equal(data.quote.text, "引用的正文");
});

test("提取：引用卡内视频和 Article 不归属主帖", () => {
  const { poc } = loadPoc();
  const id = makeStatusId();
  const quote = buildQuote({ withPhoto: false });
  const player = doc.createElement("div");
  player.setAttribute("data-testid", "videoPlayer");
  quote.appendChild(player);
  const title = doc.createElement("div");
  title.setAttribute("data-testid", "twitter-article-title");
  title.textContent = "引用文章标题";
  const body = doc.createElement("div");
  body.setAttribute("data-testid", "twitterArticleRichTextView");
  body.textContent = "引用文章正文";
  quote.append(title, body);
  const { art } = buildCell(mainPostFixture(id, "主帖正文", [quote]));
  const data = poc.extractFromArticle(art, id);
  assert.equal(data.rich.video, false);
  assert.equal(data.rich.article, false);
  assert.equal(data.text, "主帖正文");
  assert.equal(data.quote.text, "引用的正文");
});

test("提取：含网站卡的语义引用仍是引用，不提升其媒体和 Article", () => {
  const { poc } = loadPoc();
  const id = makeStatusId();
  const quote = buildQuote({ withPhoto: false });
  const card = doc.createElement("div");
  card.setAttribute("data-testid", "card.wrapper");
  quote.appendChild(card);
  const title = doc.createElement("div");
  title.setAttribute("data-testid", "twitter-article-title");
  title.textContent = "引用文章标题";
  const body = doc.createElement("div");
  body.setAttribute("data-testid", "twitterArticleRichTextView");
  body.textContent = "引用文章正文";
  const player = doc.createElement("div");
  player.setAttribute("data-testid", "videoPlayer");
  const group = doc.createElement("div");
  group.setAttribute("role", "radiogroup");
  const option = doc.createElement("div");
  option.setAttribute("role", "radio");
  group.appendChild(option);
  quote.append(title, body, player, group);
  const { art } = buildCell(mainPostFixture(id, "主帖正文", [quote]));
  const data = poc.extractFromArticle(art, id);
  assert.equal(data.text, "主帖正文");
  assert.equal(data.quote?.text, "引用的正文");
  assert.equal(data.rich.article, false);
  assert.equal(data.rich.video, false);
  assert.equal(data.rich.poll, false);
  assert.equal(data.rich.card, false);
});

test("提取：半水合图片（无 src）跳过，不渲染空字符串", () => {
  const { poc } = loadPoc();
  const id = makeStatusId();
  const { art } = buildCell(mainPostFixture(id, "正文", [buildPhoto("", { inTweetPhoto: false })]));
  const d = poc.extractFromArticle(art, id);
  assert.deepEqual(d.photos, []);
});

test("提取：激活状态读取（unlike testid 翻转）", () => {
  const { poc } = loadPoc();
  const id = makeStatusId();
  const bar = buildActionBar({ like: "43" });
  bar.querySelector('[data-testid="like"]').setAttribute("data-testid", "unlike");
  const { art } = buildCell({ statusId: id, articleChildren: [buildAuthor(), buildTweetText("正文"), bar] });
  const d = poc.extractFromArticle(art, id);
  assert.equal(d.like.active, true);
  assert.equal(d.like.value, 43);
});

test("提取：extractFocal 从挂载格取焦点数据且身份一致（快速首显路径）", async () => {
  const { env, poc } = loadPoc();
  const id = makeStatusId();
  await env.pushNavigate(`/somebody/status/${id}`);
  mountCell(env, mainPostFixture(id, "信息流中的正文"));
  const data = await poc.extractFocal(id, () => true, { expand: false });
  assert.equal(data.statusId, id);
  assert.equal(data.text, "信息流中的正文");
  assert.ok(data.nativeCell, "native cell carried for the hydration upgrade");
});

test("提取：展开升级等待期间路由变更 → 放弃过期提取", async () => {
  const { env, poc } = loadPoc();
  const id = makeStatusId();
  await env.pushNavigate(`/somebody/status/${id}`);
  mountCell(env, mainPostFixture(id, "长帖"));
  // isCurrent() returns false = generation superseded mid-wait
  const data = await poc.extractFocal(id, () => false, { expand: true });
  assert.equal(data, null, "superseded extraction returns null");
});
