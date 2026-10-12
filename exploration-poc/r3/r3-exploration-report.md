# Peek 第三轮探索报告：R1 原生 React 承载的功能完整性与低风险验证

日期：2026-10-12。分支：`exp/r1-native-function-validation-r3`（基线 `7c29352a`）。原版对照 `c93066f9`。PoC：`exploration-poc/mv3-poc/`（本轮升级 v3，0.3.0）。配套：`r3-feature-parity.md`（83 项矩阵）、`r3-native-actions.md`、`r3-network-audit.md`、`r3-reading-experience.md`、`r3-architecture-gate.md`。

## 0. 直答八问（任务书要求的第一部分）

**1. R1 是否已经能满足 Peek 的核心数据获取需求？**
**能。** 登录会话实测 6 类焦点帖（普通长帖 363 字全文 / 双图 / 视频 720×1280 在播 / 真实 X Article 4511 字 / 网站卡片 / 引用帖含已删除引用）全部可从原生详情页 DOM 提取；评论树、自动分页、分页终止、祖先链、子回复原地展开全部由原生承载并实测。X Article 本轮拿到了真实样本并找到专用提取容器（`twitter-article-title` + `twitterArticleRichTextView`），补上了前两轮 NOT_COVERED 的最大缺口。未获样本的投票/GIF/多层引用标 NOT_TESTED（检测路径与已验证类型同类）。

**2. 哪些原版功能完全保留，哪些部分保留，哪些仍不可行？**
83 项矩阵（Reviewer G9 复核后口径）：**PASS 63 / PARTIAL 10 / BLOCKED 0 / NOT_TESTED 10**（写入面统一 NOT_TESTED，见矩阵注）。
- 完全保留：阅读双栏、主题、关闭/恢复（Δ1px）、六类内容提取、评论系统全链、全部互动的 A 类路径、复制链接、悬浮卡。翻译体验由 X 原生承载（本会话实测自动显示译文+"显示原文"切换），但"默认开"依赖 X 账号语言设置，Peek 不可保证（D1 记 PARTIAL）。
- 部分保留：①评论排序——原生无排序 UI，虚拟化 `transform` 定位使 DOM 重排不安全（实锤），可行替代是 Peek 自绘"已加载评论"排序视图（纯展示+跳转，互动仍在原生侧）；全量语料排序需私有接口，R1 放弃。②交互模型——"不跳走的浮层"变"页面级导航+像素级恢复"（R2 实锤，用户取舍）。③设置 popup、超长帖展开路径等工程项。
- 不可行（BLOCKED 0）：无。R1 路线下没有判 BLOCKED 的用户功能。

**3. 能否让 Peek 不再自行调用 X 私有接口？**
**能，且已实测到位。** 同样本冷载请求普查：原生 18 个 `/i/api/` 请求 vs PoC 注入后**逐操作一致**（18:18）——扩展零新增；源码认证 0 fetch/XHR、无 Webpack 探测、无凭据捕获、无请求重放。唯一例外是"产品级自动翻译默认开"：若不接受 X 原生翻译的触发条件，默认开+自定义并发需要外接翻译后端（DBC，契约已离线验证）或回到 X 端点（即回到私有接口调用）——按当前实测，X 原生翻译在本会话已自动显示译文，这个例外实际不触发。

**4. 用户能否通过原生控件完成原版的重要互动？**
**能，全部 10 项互动都有实测的 A 类路径**（用户亲手点击原生控件，Peek 零参与写入）：点赞/转发/收藏（原生操作条，v3 焦点格可见）、收藏夹（原生流程承载）、关注（悬浮卡+caret 菜单双入口）、回复原帖/指定评论（原生编辑器，空内容禁用实测）、富媒体回复（原生编辑器全能力）、复制链接/分享（双路径）、悬浮卡（300px 实测）。v3 已移除全部合成写入委托（B 类），面板按钮改为"定位+高亮原生控件"。端到端写入 NOT_TESTED（0 次真实写入，留用户检查单第 11 项）。

**5. 实际连续阅读体验是否可以接受？**
**PARTIAL，由用户决定。** 十场景全部有实测证据（打开 896ms/关闭返回 190ms/滚动恢复 Δ1px/前进后退/直达/重载/清理断言全零）。核心差异是结构性的：R1 每次打开都是真实页面切换（时间线被卸载），原版是不跳走的浮层。恢复精度持平甚至更稳，但"关闭瞬间无切换感"这一点 R1 给不了。详见 r3-reading-experience.md §3。

**6. 网络和性能代价与原版相比如何？**
扩展自身私有接口调用：**1 读 N 写 → 0**。总请求量：R1 ≈ 原生详情页基线（整页导航的代价由 X 自己的请求构成，非扩展成本）；原版少一次整页导航但多扩展自构造请求。性能：原帖可读 98ms（原版快照观感）vs 896ms（R1 整页）；评论可读两者都受 GraphQL 支配；返回信息流 190ms。无不可接受的退化，代价结构如实拆分见 r3-network-audit.md §2。

**7. 是否推荐进入 R1 正式工程改造？**
**推荐"R1 为唯一候选进入正式工程"，附一个用户决策点**：本 轮把前两轮的 P0/P1 缺口（Article、写入路线、生命周期、网络审计、功能矩阵）全部补齐且没有发现新的架构级阻断；剩余 PARTIAL 项要么是产品取舍（交互模型、排序降级），要么是工程实现项（popup、检查单验收）。决策点：用户须先接受"页面级导航替代浮层"与"评论排序降级"这两项体验差异（详见 r3-architecture-gate.md）。若用户不能接受，则 R1 不动工，维持 R4b/R6 路线——这不是本报告能替用户决定的。

**8. 下一阶段需要修改哪些文件，哪些功能应优先处理？**
优先级排序（正式工程范围，均不动 `main`）：
1. `extension/manifest.json` + `extension/content.js`（新形态）：路由观察（popstate+Navigation API+有界轮询）、详情页增强挂载/拆除、`extractFocal` 提取器（含 Article 专用路径）——直接以 `exploration-poc/mv3-poc/content.js` v3 为起点。
2. 删除项（原版源码）：`extension/page-bridge.js` 全部（bridge/凭据/Webpack 探测/GraphQL 发现）、`content.js` 的 TOGGLE_ACTION/CREATE_REPLY/TOGGLE_FOLLOW/SAVE_BOOKMARK_FOLDER 桥、自研 hls.js 播放器区段——原生承载后无存在必要。
3. 优先处理的功能：评论排序的 Peek 自绘视图（C2 的替代方案，避免功能"静默消失"）；设置 popup 对接新开关语义（A11）；`extension/content.css` 双栏与阅读密度合并到新形态。
4. 验收门槛：`exploration-poc/MV3-LOGIN-VERIFY.md` v3 检查单（12 项，含用户亲手写入第 11 项）+ 原版测试套件中对 bridge/浮层的断言按新架构改写（不得静默删除）。

## 1. 本轮做了什么（S0–S6 摘要）

- **S0**：建分支与 83 项逐能力矩阵（把第二轮聚合行拆为独立用户能力）。
- **S1-A**：6 类焦点帖实测（含真实 X Article 样本获取与专用容器发现）；投票/GIF 样本经 5 种途径未获（搜索页不渲染投票控件本身亦为发现）→ NOT_TESTED。
- **S1-B**：子回复原地展开（真实指针点击 42→46 格、URL 不变）、分页终止形态（自然停止无残载）、祖先链 3 层、排序不可行性实锤（虚拟化 transform + 无原生 UI）。
- **S1-C**：CSS 承载原生焦点格实验——初始可行（视频继续在播）、~3577px 滚动后被虚拟化回收失效；该结论直接推动 v3 设计变更。
- **S2**：10 项互动 A 类路径逐项识别与实测；B 类合成委托正式移除；发现 X 当前操作条结构（caret/reply/retweet/like/bookmark + 独立分享控件）。
- **S3**：十场景计时与清理断言；指标对照口径声明（快照首显 ≠ 完整评论首读）。
- **S4**：CDP Network 事件普查（不采头/体/凭据）：原生 vs 注入 18:18 逐操作一致。
- **S5**：PoC v3 功能性修复（见 §2）+ 离线单元测试 4/4 + 登录态 12 项检查单更新 + v3 回归实测。
- **S6**：独立 Reviewer 审查（G1–G8），见 r3-architecture-gate.md。

## 2. 本轮发现并修复的 PoC 缺陷（v2 → v3）

| # | 缺陷 | 实测证据 | v3 修复 |
|---|---|---|---|
| 1 | 轮询周期无条件重标记焦点格，把已正确识别的富媒体帖重新隐藏（说明条与实际状态自相矛盾） | 卡片帖：richNote 已显示、focalHidden=true | 移除隐藏机制本身 |
| 2 | 富媒体检测与水合竞态：视频帖构建时 videoPlayer 未挂载 → 误判纯文本 → 隐藏格、无说明 | 视频帖首测 richNote 缺失、右栏大片空白、视频在播但不可见 | 焦点格保持可见 + 构建后 `syncRichNote` 补显说明 |
| 3 | 隐藏焦点格预留全高空白（实测 1387px），回复被推到折叠线下，"评论首次可读"被显著推迟 | 首测 replyVisibleWithoutScroll=false；User-Name 全在 y≥987 | v3 复测 replyVisibleWithoutScroll=true |
| 4 | 隐藏格内原生操作条/悬浮卡/回复框不可达 → 曾用合成委托替代 | S2 控件可达性分析 | 定位+高亮替代合成写入 |
| 5 | X Article 无专用提取路径，fallback 把互动计数行（"3/3/11/3,578"）混入正文 | Article 首测正文含计数噪音 | `twitter-article-title`+`twitterArticleRichTextView` 专用路径 + fallback 计数行过滤（离线 4/4） |
| 6 | handle 显示带前导斜杠（"/077G_"） | 首测截图 | 渲染为 "@077G_" |

## 3. 诚实边界（不改口的部分）

- **真实账号写入 0 次**：所有写入功能是"路径已验证存在"，不是"功能已验收"。唯一写入验收路径是用户检查单第 11 项（用户亲手点赞）。
- **真实 MV3 扩展加载未完成**：ego-browser 无法加载扩展、Chrome 155 移除命令行加载，均已留档；等效注入（隔离世界自动注入，Chromium 与内容脚本同机制）覆盖行为面，`exploration-poc/MV3-LOGIN-VERIFY.md` v3 覆盖扩展运行时本体——两者互补，后者待用户执行。
- **投票/GIF/多层引用**：无样本，NOT_TESTED；不得假设其行为等同已验证类型（尽管检测路径同类）。
- **"减少私有接口调用 ≠ 账号风控降低"**：本轮只验证了工程依赖归零；平台合规与账号风险评估独立存在，不在本报告断言范围。
- **样本量小**：性能数字为同会话单样本原始值（非 p95）；请求普查同样本冷载 2 次。逐操作一致性比绝对数更有意义。
- **原版 Peek 对照数据**沿用第二轮同会话实测，本轮未重复注入原版产品。

## 4. 证据索引

- 截图（`exploration-poc/r3/evidence/`）：s1a-longpost-pane / s1a-longpost-replies / s1a-longpost-deepscroll / s1b-subreply-expanded / s1b-ancestor-chain / s1c-css-carry / s1c-video-native-cell / s1a-article-native / s1a-card-pane / s2-hover-card / s2-caret-menu / s2-reply-composer / s2-share-sheet / s3-open-from-timeline / s3-reload-state / s5-v3-video-visible / s5-v3-article
- 代码：`exploration-poc/mv3-poc/`（v3，0.3.0）、`exploration-poc/r3/r3-poc-units.test.mjs`（4/4）、`exploration-poc/r3/run.sh` + `_prelude.js`（CDP 只读试验工具，无 fetch 包装、无凭据采集）
- 日志：各场景 JSON 断言值已在本文与专项报告内引用；原始截图为公开区域内容，无账号菜单/凭据/私信。
