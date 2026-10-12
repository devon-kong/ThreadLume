# R3-R 数据完整性：DOM 提取、Article 能力与媒体归属

## 1. fallbackText 数字行误删修复（P0-C1）

**缺陷**：v3 的 `fallbackText()` 用 `/^[\d.,]+\s*[KMkM]?$/` 删除所有"纯数字行"——正文里真实存在的 `2026`、`1`、`42`、`0` 会被静默吞掉。

**修复**：改为**位置化提取**（Reviewer 复核后进一步由文本匹配升级为纯位置跳过）——
- **位置化遍历**：从 article 顶部按 DOM 序递归收集子树文本；凡结构性命中非正文子树（`[role="group"]` 及 like/retweet/reply/bookmark 计数节点、`<time>`、`div[role="link"]` 引用卡、`card.wrapper`、`videoPlayer`）**整棵跳过、不进入**。子树不含任何跳过节点时整体取 innerText（保持阅读顺序）。全程**无任何文本相等匹配**——正文行 `42` 与喜欢计数 `42` 同值也不碰撞（碰撞场景有专门测试）。
- UI 行（显示翻译/Show more 等）维持正则剔除；引导作者块维持前 3 行启发式跳过。
- 无法确定字段时维持"未知"标注（`textKnown=false` → "正文未识别"；计数 `known/value` 分离，垃圾文本→未知，绝不伪造 0）。

验证：`poc-extraction.test.mjs` C1 四场景（计数位置剔除且正文 `2026/42/0` 保留、**正文数字与计数文本同值不碰撞**、引用子树不混入、无计数节点时不误删）+ R3 既有 4 项单元测试移植（`r3/r3-poc-units.test.mjs`，行为变更已注明）。

## 2. 主帖/引用帖媒体归属修复（P0-C2）

**缺陷**：v3 `photos = photoUrlsIn(art)` 递归整个 article——引用帖图片、（旧式 /media/ 地址的）网站卡片缩略图都被归入主帖；Article 分支还做了一次双重 union。

**修复**：
1. `photoUrlsIn(scope, ...excludes)` 支持子树排除；空 `src`（半水合媒体）跳过，不渲染破图；去重。
2. `findQuoteNode(art)` 结构化引用识别：`div[role="link"]` 候选中排除含 `card.wrapper` 的节点（自身或后代），优先命中嵌套 `tweetText/User-Name` 的结构，兜底取最后一个候选（X 把引用卡渲染在媒体/卡片之下）；已删除引用占位（无嵌套 testid）仍被识别——保持 R3 实测行为。
3. 主帖照片 = `photoUrlsIn(art, quoteNode, cardNode)`；引用照片 = `photoUrlsIn(quoteNode)`；视频封面（`ext_tw_video_thumb`）与卡片缩略图（`card_img`）不匹配选择器，天然不归属。
4. Article：主帖照片 = 正文图 + 封面各一次（去重）；`extractArticle().photos` 限于正文容器。

### Fixture 验证矩阵（全部通过，`poc-extraction.test.mjs`）

| 场景 | 断言 |
|---|---|
| 主帖图片 | photos=[主图]，计数/时间/作者正确 |
| 引用帖图片 | photos=[主图] 不含引用图；quote.photos=[引用图] |
| 主帖+引用均有图 + 网站卡片 | 卡片缩略图（card_img）不归属任何一方；结构化识别引用、卡片不误判为引用 |
| 仅网站卡片 | quote=null（card.wrapper 子树永不充当引用） |
| 已删除引用占位 | 仍识别为引用（保持 R3 行为） |
| 视频封面 | 不归属为照片；rich.video=true |
| 旧式 /media/ 卡片缩略图 | 结构性排除（不只靠 URL 形状） |
| Article 正文图+封面 | 主帖照片=[封面,正文图] 各一次；article.photos=[正文图] 不重复 |
| 空 src/重复 URL | 跳过/合并 |

## 3. X Article 结构化能力表（P0-C3）

背景：R3 证明完整 Article 文本可从原生页面读取（真实样本 wlzh/2109433207318081885，4511 字），但 `innerText` ≠ 富文本。下表区分"可结构化提取"与"应保留 X 原生 React 渲染"。探针测试（`poc-extraction.test.mjs` C3）在 DOM fixture 上实测了各结构的可枚举性；**本轮不开发富文本渲染器**，正式工程若需富渲染应基于此表决策。

| 结构 | 可结构化提取？ | 提取方式 | 现状与建议 |
|---|---|---|---|
| 标题 | ✅ | `[data-testid="twitter-article-title"]` | 已提取（面板首行） |
| 正文全文 | ✅（文本完整） | `[data-testid="twitterArticleRichTextView"]`.innerText | 已提取；段落顺序即 DOM 顺序 |
| 段落边界 | ✅ | 块级元素枚举 | innerText 按块分行；逐段对象化需遍历子块（工程期可做） |
| 子标题层级 | ⚠️ 部分 | `h1/h2/h3` 可枚举（探针实测 ["第一节"]） | **innerText 丢失层级**；结构枚举可行，渲染需自建 |
| 超链接 | ⚠️ 部分 | `a[href]` 可枚举（文本+href 实测） | innerText 只剩链接文字；href 需结构枚举 |
| 列表 | ⚠️ 部分 | `ul/li` 可枚举（实测 3 项） | innerText 保留条目文本、丢失列表语义 |
| 图片顺序 | ✅ | `tweetPhoto` img DOM 序（实测 [art1, art2]） | 已提取（面板按序渲染） |
| 引用块 | ⚠️ 部分 | `blockquote` 可枚举（实测） | 文本保留、语义需结构枚举 |
| 嵌入媒体（文内视频/投票） | ⚠️ 检测级 | video/[data-testid] 可检测 | 渲染交给原生格（右栏顶部原生格完整承载） |
| 原生交互（文内展开/跟随/音频） | ❌ 不提取 | — | **保留 X 原生渲染**；不克隆、不移动 React 节点（任务书红线） |

**结论**：R1 面板当前承载"标题+全文+图片顺序"（已测试）；层级/链接/列表语义**可以**结构化提取（探针已证）但 v4 不渲染——阅读完整富文本体验由右栏原生格负责，这是设计而非缺陷。任何未来的富文本渲染器必须先过 C2 的媒体归属测试集。

## 4. 测试与生产一致性（P0-C4）

全部提取测试通过共享 harness（`r3-r/tests/poc-env.mjs`）**逐字执行生产 `content.js`** 后调用其导出的真实函数（`extractFromArticle / extractArticle / findQuoteNode / photoUrlsIn / fallbackText / countOf / parseCount`），零测试专供算法。jsdom 30 缺 `innerText`，harness 提供块级分行近似实现（仅测试侧，生产不受影响）——已在 harness 注释中明示该近似边界。

反例覆盖（`poc-negative.test.mjs`）：删除帖、缺失字段、垃圾计数、半水合媒体、虚拟化回收、离线超时——提取层"未知"语义与渲染层"未识别"提示贯通验证。
