# Peek 功能矩阵 — 原生页面承载路线（第一轮探索）

日期：2026-10-12。源码基线：上游提交 `c93066f9fa9b22aba1ba46e1cc3c0154027b9aae`（manifest 0.8.10，本地工作区与该提交逐字节一致，仅多出未入库构建产物 `dist-extension/`）。

口径说明（任务书 3.2）：

- **覆盖结果**（等价保留 / 原生承载但体验不同 / 部分保留 / 阻断 / 尚未判断）与**验证状态**分开标注，不合并为单一 PASS。
- 验证状态：`SRC`＝固定源码+离线测试；`BROWSER-RO`＝登录会话只读浏览器试验（ego-browser CDP）；`MV3`＝隔离 Edge 149 加载最小 PoC 的运行时验证；`NOT_TESTED`＝本轮真实账号写入未验收；`NOT_COVERED`＝本轮无样本。
- 原版行为一律引用固定 SHA 的源码位置。原始 66 项清单只是索引，下表按用户可感知功能归组。
- 全部真实账号写入（点赞/转发/收藏/关注/回复/投票/上传）本轮 **NOT_TESTED**：按钮存在只记"控件保留"，不记"互动功能通过"。

## A. 入口与阅读

| 功能 | 原版（c93066f） | 原生路线承载方式 | 覆盖结果 | 证据 | 差异与后续验收 |
| --- | --- | --- | --- | --- | --- |
| 时间线/通知页点击打开阅读器 | content.js 点击拦截（`handleTimelineClick` 起于 content.js:2808，锚点解析在 2816） | 不拦截点击；原生 SPA 导航到详情页，Peek 在详情页注入增强 | 原生承载但体验不同 | BROWSER-RO（原生点击导航 25ms 内完成，S2） | 差异：不再"不跳走"，改为页面级导航。需验收：用户对"关闭=返回"的接受度 |
| 详情页普通点击避让 | 原版在 /status/ 页不拦截 | 天然成立（Peek 只增强详情页自身） | 等价保留 | 源码+设计（S3 PoC 仅在 /status/ 激活） | — |
| 引用帖卡片点击打开被引用帖 | core.js:545 语义引用容器识别 + GraphQL `quoted_status_result` 解析 | 原生行为：点击引用卡原生导航到被引用帖 | 等价保留 | BROWSER-RO（realchendahuang 样本：点击 div[role=link] 引用卡 → `/status/2108672092422177100`，返回正确） | 原生路线不再需要 `quoted_status_result` 解析代码 |
| 回复的上文链（祖先链+焦点回复） | 原版左侧渲染 root→父级链（READ_THREAD ancestors） | 原生详情页自带祖先链（回复详情页顶部渲染根帖→中间回复→焦点回复） | 等价保留 | BROWSER-RO（077G_ 样本回复详情：3 层结构渲染正确） | 需验收：深层链与"显示此对话"折叠形态 |
| 双栏比例 52:48 + 独立滚动 | content.css 布局 | Peek 自绘左栏（fixed 52% 独立滚动）+ 原生评论列右移 48% | 部分保留 | BROWSER-RO + MV3（S2/S3 双栏成立；但纯 CSS 方案在 ~4000px 滚动后被虚拟化回收，必须用 Peek 自绘左栏规避） | 关键限制已找到可行解，见 exploration-report §S1 |
| 首次定位到焦点回复 | 原版 focal-reply 滚动定位 | 原生详情页默认定位焦点回复（祖先在上） | 等价保留 | BROWSER-RO（回复详情页焦点即主题） | — |
| Esc/遮罩/关闭按钮 | content.js Esc、遮罩、关闭 | Esc→`history.back()`；关闭按钮→`history.back()`（无遮罩概念） | 等价保留（机制不同） | MV3（PoC 实现该行为）；语义差异：Esc 在无历史时离开站点，需要边界处理 | 验收：历史栈为空的进入方式 |
| 信息流恢复（关闭后位置连续） | 原版记录坐标+恢复，禁改 body/html overflow | 原生 SPA back 恢复 | 等价保留（实测优于原版） | BROWSER-RO（返回后 scrollY=2800 分毫不差、锚点帖与视口位置一致，S2） | 需验收：长信息流+虚拟化窗口回收后的 back 恢复 |
| 主题（浅/暗/熄灯） | content.js 主题 + content.css 变量 | 跟随 X 原生主题（Peek 面板用 CSS 变量对齐） | 原生承载但体验不同 | SRC（PoC 用固定暗色；主题对齐未实现） | 后续实现 Peek 面板主题变量 |
| 设置（开关/自动翻译） | popup.js + chrome.storage.sync | 保留 popup 形态；开关语义改为"详情页增强" | 部分保留 | SRC | PoC 未含 popup |
| 复制链接 / 在 X 打开 | content.js action bar | Peek 面板头部"在 X 打开"；复制可保留 | 部分保留 | MV3（PoC 有"在 X 打开"） | 复制按钮未入 PoC |

## B. 内容与媒体

| 功能 | 原版 | 原生路线承载方式 | 覆盖结果 | 证据 | 差异与后续验收 |
| --- | --- | --- | --- | --- | --- |
| 作者/头像/时间/互动数 | core.js 解析 GraphQL 用户对象 | 详情页 DOM 提取（登录态 testid 完备；未登录回退提取已验证） | 等价保留（数据来源换为 DOM） | BROWSER-RO + MV3（作者/头像/时间/正文/图片/计数 0.1ms 提取完成，S2/S3） | DOM 结构变更时需维护解析器（与原版维护 GraphQL 解析器等价） |
| 特殊字符/@提及渲染 | content.js（2026-09-25 修复） | 原生渲染 | 等价保留 | 设计推定+SRC；BROWSER-RO 样本含 emoji/中文混排显示正确 | — |
| 普通长帖全文 | 原版正文 15px/20px 全文 | 详情页焦点帖 DOM 即全文（xiangxiang103 样本 363 字符完整）；极长折叠帖用原生"显示更多"展开后提取 | 等价保留 | BROWSER-RO（时间线预览折叠≠详情页折叠，已实证） | 需验收：Premium 超长帖的展开态提取 |
| X Article 完整正文 | content.js:2384 READ_ARTICLE（TweetResultByRestId 动态发现） | **NOT_COVERED**（时间线无 Article 样本，未爬取补齐） | 尚未判断 | — | 下一轮必须补一个 Article 样本；Article 原生详情页渲染能力待验证 |
| 引用帖嵌套渲染 | content.js 引用卡渲染（含引用内视频/Article 规则） | 原生渲染引用卡；Peek 左栏提取引用摘要 | 原生承载但体验不同 | BROWSER-RO（引用卡文本/图片可提取；原生卡片完整渲染） | 原生引用卡样式即 X 原生样式 |
| 网站卡片 / 投票展示 | content.js（2026-09-25 增加投票展示） | 原生渲染 | 等价保留（原生即来源） | NOT_COVERED（本轮样本无投票/卡片帖；原生页面显示能力由 X 自身保证） | 需各补一样本目验 |
| 图片 / GIF | content.js 图片渲染 | 原生渲染 + Peek 左栏提取 photo URL 直显 | 等价保留 | BROWSER-RO + MV3（xiangxiang103 双图、realchendahuang 单图提取成功） | — |
| 视频（HLS/MP4、自适应、预热、单视频协调） | content.js 大段本地 hls.js 播放器实现（实测区段约 content.js:1258-1490） | **原生播放器完整承载**（blob/MSE 源实测在播） | 原生承载但体验不同 | BROWSER-RO（077G_ 样本 video 元素 blob: 源正常） | 差异：放弃 Peek 自研 HD-first/预热/带宽探测，接受 X 原生清晰度与预载策略；收益：删除最大的一块自维护播放器代码 |
| 视频真实宽高比、引用内视频不被压缩 | content.css 规则 | 原生渲染规则天然满足 | 等价保留 | 设计推定（原生页面无该 bug） | — |
| 单视频协调播放 | content.js play 事件互斥（content.js:1330） | 原生页面自身行为 | 等价保留 | 设计推定 | 需验收：多视频回复流 |

## C. 评论

| 功能 | 原版 | 原生路线承载方式 | 覆盖结果 | 证据 | 差异与后续验收 |
| --- | --- | --- | --- | --- | --- |
| 评论列表与数量 | core.js 解析 TweetDetail replies | 原生评论流 | 等价保留 | BROWSER-RO（样本 16-52 格随滚动增长） | — |
| 上下文/父子关系 | 原版 ancestors+descendants 解析 | 原生"回复给"标记+层级渲染 | 等价保留 | BROWSER-RO（回复详情 3 层祖先链实证） | — |
| 子回复展开/分支分页/重试/终止/去重/循环防护 | content.js 2026-09-25 子回复状态机 | 原生展开（"显示回复"）与原生分页 | ⚠️ 原生承载但体验不同（终止/去重/重试/循环防护未验证——原生行为替代但未做边界样本；展开仅目视到"显示回复"入口未点击） | BROWSER-RO（原生分页 16→29→52 格持续追加）；原版自研状态机被原生行为替代 | 需验收：深层分支展开、"显示更多回复"形态、终止与去重边界 |
| 排序（相关/最新/最多喜欢） | content.js 对已加载评论本地排序 | **无对应物**：原生仅相关排序 | 部分保留/体验差异 | 设计（原生无本地重排入口） | 需产品决策：放弃，或 Peek 对原生已加载评论 DOM 重排（有虚拟化冲突风险，未验证） |
| 排除"发现更多"推荐 | 原版 fail-closed 过滤（有专项测试） | 原生"发现更多"模块仍在页面上，但它明确标注为推荐而非评论 | 原生承载但体验不同 | SRC（原版测试 `fails closed when TweetDetail omits the focal post`）；原生形态无"推荐冒充评论"风险 | — |
| 评论自动加载（无手动按钮） | content.js IntersectionObserver | 原生滚动自动分页 | 等价保留 | BROWSER-RO（多轮滚动持续加载） | — |

## D. 翻译

| 功能 | 原版 | 原生路线承载方式 | 覆盖结果 | 证据 | 差异与后续验收 |
| --- | --- | --- | --- | --- | --- |
| 原帖/祖先/引用即时翻译 | content.js TRANSLATE_TWEET（X 内部翻译端点） | 方案一：原生"显示翻译"按钮（语言不匹配时出现；已实测英文 UI+中文帖出现） | 原生承载但体验不同 | BROWSER-RO（未登录截图含 Show translation；登录态中文 UI+中文帖无按钮=按语言差异出现） | 差异：非自动、非默认译文 |
| 评论滚动接近时翻译、并发≤2、单标签缓存 | content.js translationObserver + 缓存 | 方案二：**TranslationScheduler（合成验证完成）**——注入后端即可复用原版调度语义 | 等价保留（调度层） | SRC+离线测试 9/9（缓存/去重/并发=2/取消/超时/代次隔离/驱逐） | 后端可插拔：X 端点、DBC、任何符合契约的服务；DBC 协议未提供，未接 |
| 显示原文/显示翻译切换 | content.js 切换按钮 | 方案一原生自带；方案二 UI 自绘 | 原生承载但体验不同 | BROWSER-RO | — |
| 失败回退原文、不阻塞阅读 | content.js | 调度器契约：失败保留原文、永不阻塞（`TranslationError` 类型化） | 等价保留 | SRC+离线测试 | — |
| DBC 接入 | 无 | 接口已就绪（`backend` 契约），协议/鉴权/配额/数据条款待用户提供 | 尚未判断 | SRC | 缺：DBC 协议文档、密钥部署形态（个人自带 vs 服务端代理）决策 |

## E. 互动（全部 NOT_TESTED，仅控件与路线审查）

| 功能 | 原版 | 原生路线承载方式 | 覆盖结果 | 证据 | 差异与后续验收 |
| --- | --- | --- | --- | --- | --- |
| 点赞/转发/收藏/取消 | content.js TOGGLE_ACTION → bridge GraphQL 写操作（FavoriteTweet 等） | **原生按钮直接承载**（用户本人点击原生按钮，不经扩展代码） | 原生承载但体验不同（最接近"与人直接操作"） | BROWSER-RO（原生按钮存在且为原生控件）；NOT_TESTED | 需真人验收端到端写入 |
| 原生收藏夹分类/分页/管理页跳转 | content.js:2533-2557（BookmarkFoldersSlice/bookmarkTweetToFolder 桥接） | 原生收藏按钮自带收藏夹流程 | 等价保留（原生即权威） | 设计推定；NOT_TESTED | 需真人验收：分类/取消/权限缺失路径 |
| 作者卡/关注/粉丝数 | content.js hover card + TOGGLE_FOLLOW REST 桥接 | 原生 hover card 天然承载 | 等价保留 | 设计推定；NOT_TESTED | 需验收：私密账号待批准态 |
| 纯文字回复（无 280 限制/无 /280 计数） | content.js composer + CREATE_REPLY（CreateTweet） | 原生回复框承载（体验=X 原生） | 原生承载但体验不同 | BROWSER-RO（原生回复框存在；打开后关闭=只读界面检查，未输入未发送）；NOT_TESTED | 差异：原生富媒体/提及能力回归 X 原生（原版本来也不做） |
| 回复目标选择/草稿保留/重复提交防护/不确定状态 | content.js 2026-09-25 状态机 | AI 草稿接口（合成验证）+ 原生编辑器承载最终发送 | 部分保留 | SRC+离线测试 4/4（draft-only/human-review-required/web-text-as-data/截断标识） | 需真人验收 |
| 图片/视频选择/粘贴/拖放/上传 | content.js composer media + bridge uploadMedia | 原生编辑器完整承载 | 等价保留（原生能力） | 设计推定；NOT_TESTED | — |

## F. 工程机制（另表——移除旧机制是改造收益，不计用户功能丢失）

| 机制 | 原版 | 原生路线处置 | 证据 |
| --- | --- | --- | --- |
| page-bridge.js MAIN world 注入 + fetch/XHR 包装 + Webpack 探测 | manifest document_start；page-bridge.js 全文（无条件安装） | **整体移除**（干净基线已证明无 bridge 时页面正常） | SRC + BROWSER-RO（`__tuzaiPageBridgeInstalled`/fetch 包装/tuzai DOM 均阴性） |
| 凭据/CSRF/Authorization 捕获（内存） | page-bridge.js:51-72,224-261 | 随 bridge 移除；读取路线不再需要任何凭据 | SRC |
| GraphQL 动态发现（queryId/features/fieldToggles） | page-bridge.js findOperation/findTransactionIdFunction | 读路径移除；若互动保留桥接则仅写路径需要（待定） | SRC |
| 权限（storage + x.com/twitter.com） | manifest | 原生路线仍只需同两域内容脚本；PoC 已验证**零 permissions** 可运行 | MV3（PoC manifest 无 permissions 字段） |
| 消息边界（window.postMessage request/response） | content.js ↔ page-bridge | 随 bridge 移除 | SRC |
| 本地打包（Phosphor/hls.js/brand icon） | build-extension.mjs | hls.js 与 Phosphor 可按需缩减（原生播放器/原生图标） | SRC（构建脚本核验） |
| 设置存储 chrome.storage.sync | popup.js/content.js | 保留（增强开关/翻译设置） | SRC |
| MV3 内容脚本生命周期 | manifest document_idle | PoC 已验证 SPA 路由监听+挂载/拆除（pushState 包装+popstate） | MV3（挂载）+ BROWSER-RO（拆除等价；MV3 内 pushState 清理测试因未登录路由重定向不可判读，见报告 §6.1） |

---

## 第二轮修订（2026-10-12，P0 补证后）

| 条目 | 首轮记录 | 第二轮修订 | 证据 |
| --- | --- | --- | --- |
| A.双栏比例 52:48 | 部分保留（纯 CSS 边界） | **vw 统一参照后成立**：paneW 560/1077（52.0%）、cellW 517（≈48%）、右栏推荐栏隐藏、焦点格隐藏 | BROWSER-RO（登录态隔离世界注入）+ 截图 r2-loggedin-layout.png |
| A.主题 | 原生承载未实现 | 浅色跟随实测生效；**暗色 NOT_MEASURED**（不改用户账号主题） | BROWSER-RO（theme=#ffffff） |
| A.Esc/关闭 | 等价保留（机制不同） | 语义修复：SPA 进入→back；直达/外部进入→仅拆除不导航（实测不跳出 X） | BROWSER-RO + MV3 |
| A.入口点击 | 导航式（不等价风险） | **判定不等价（实锤）**：SPA 后其他时间线帖不在 DOM；原版停留 /home、R1 变 /status/ | BROWSER-RO（otherTimelinePostStillInDom=false）+ 截图对照 |
| B.作者/时间/计数 | 等价保留 | 维持；计数 K/M 解析与「未知」展示修复并通过真实函数单测 9/9 | MV3 CDP 测试钩子 |
| B.富媒体（视频/投票/卡片） | 原生承载 | 明确策略：焦点含富媒体时**原生格保持可见**，面板显示承载说明，不假装等价 | BROWSER-RO（视频帖 richNote 实测） |
| C.评论 | 等价保留 | 维持（原生承载，分页/上下文不变） | BROWSER-RO |
| E.互动 | NOT_TESTED | 补充实现：面板操作条镜像原生状态（like/unlike testid 翻转）并委托原生按钮（第 3 类自动化）；**写入仍 NOT_TESTED** | BROWSER-RO（likeActive=false 状态镜像实测） |
| F.MV3 生命周期 | MV3（挂载）+ BROWSER-RO（拆除等价） | 路由机制重写（移除 history 包装）：popstate+Navigation API+500ms 有界轮询；六场景（SPA 进入/切换/back/forward/home 拆除/重复进入）全通过；双重注入幂等 | BROWSER-RO（登录态隔离世界，跨世界路由观测实证）+ MV3 |
| F.登录态 MV3 | NOT_MEASURED | 维持 NOT_MEASURED；用户操作材料 `exploration-poc/MV3-LOGIN-VERIFY.md` 已备齐（Chrome 155 限制与 ego-browser 限制均已留档） | 留档尝试记录 |
| F.登录态 MV3（第三轮更新） | NOT_MEASURED | **ego 登录会话检查单 10/10 通过**：以 Chromium 原生隔离世界自动注入（addScriptToEvaluateOnNewDocument+worldName）在真实登录会话逐项实测（52vw/计数 parity 含零计数 aria 回退/回复焦点/切换/back-forward/关闭语义/直达不跳出/重载/无残留/暗色合成输入跟随） | BROWSER-RO（登录态，等效 manifest 注入语义）；「Chrome 隔离 profile 真实扩展包加载」仍待用户检查单（MV3-LOGIN-VERIFY.md），两种验证互补 |
| B.计数展示（第三轮更新） | — | 零计数按钮无文本→补 aria-label 数值回退（「0 喜欢次数。喜欢」→0），非零值与 aria 逐值一致；缺失仍显「未知」不造 0 | BROWSER-RO（2a/2b 实测） |
| A.主题（第三轮更新） | 暗色 NOT_MEASURED | 主题跟随机制实测：合成暗色输入→面板暗色、恢复原值→浅色（未改账号设置）；补 body 观察器+500ms 轮询重涂+透明回退读 color-scheme；真实 X 设置切换仍留给用户检查单 | BROWSER-RO（D 项实测） |
