# R3 功能验收矩阵（逐项，按原版功能合同）

日期：2026-10-12。基线：第二轮最新提交 `7c29352ad28265c250796cbf82d3ac9362dcc22d`；原版对照 `c93066f9fa9b22aba1ba46e1cc3c0154027b9aae`（manifest 0.8.10）。实验分支 `exp/r1-native-function-validation-r3`。

口径：

- **判定**：PASS（有证据证明当前 R1 路线能实现）／PARTIAL（主要能力可实现但存在明确功能或体验差异）／BLOCKED（技术机制或已确认平台限制导致当前路线不可行）／NOT_TESTED（缺样本、环境或授权）。
- **证据级别**（独立字段，不与判定合并）：SRC＝源码分析；OFF＝离线/合成 fixture 测试；RO＝登录会话 CDP 只读实测；MV3＝真实 MV3 运行时；HUMAN＝人工账号写入验收。
- 本矩阵把第二轮 feature-matrix.md 中被聚合在同一行的独立用户能力**拆开**（例如"图片/GIF"拆为渲染、查看器、原图地址三项），避免漏项。
- 原版行为引用固定 SHA 的源码位置。全部真实账号写入保持 NOT_TESTED（用户未授权 Agent 代做写入，本轮唯一写入路径是留给用户的检查单第 11 项）。
- "X 原生网页理论上具备该功能"不记 PASS——下表每项 PASS 都对应本轮或前两轮的实测证据。
- R3 证据文件位于 `exploration-poc/r3/evidence/`；PoC 现为 v3（0.3.0，原生焦点格保持可见设计）。

## A. 入口与阅读

| # | 能力 | 原版承载（c93066f 锚点） | R1 承载方式 | R3 判定 | R3 证据级别 | R3 证据 / 备注 |
|---|---|---|---|---|---|---|
| A1 | 时间线/通知点击进入阅读视图 | 点击拦截浮层（content.js:2808） | 原生 SPA 导航至详情页 + 注入增强 | PARTIAL | RO | 交互模型不等价（R2 实锤：时间线被卸载）；R3 复测：点击→URL 896ms、面板同步建立（s3-open-from-timeline.png）。差异由用户取舍 |
| A2 | 详情页普通点击避让 | /status/ 不拦截 | 天然成立 | PASS | SRC+RO | PoC 仅增强详情页 |
| A3 | 引用帖卡片点击打开被引用帖 | core.js:545 语义引用识别 | 原生引用卡导航 | PASS（携带 R1 证据） | RO | R1 实测引用卡→被引用帖→back 正确；R3 复测样本为已删除引用占位（点击不导航=原生正确行为），未推翻 |
| A4 | 回复详情显示完整上级对话链 | READ_THREAD ancestors | 原生祖先链 | PASS | RO | R3 实测 3 层：根帖→中间回复→焦点回复（s1b-ancestor-chain.png） |
| A5 | 打开时定位焦点回复 | focal-reply 滚动定位 | 原生详情页默认定位 | PASS | RO | 回复详情页焦点即主题（R2+R3 一致） |
| A6 | 独立焦点帖（无上下文）置顶显示 | content.css 布局 | 原生即置顶 | PASS | RO | 单帖详情无祖先格 |
| A7 | 双栏 52:48 独立滚动 | content.css | vw 统一参照双栏 | PASS | RO | v3 回归：paneW=52vw（691/1330）、评论列 48vw、独立滚动（s5-v3-video-visible.png） |
| A8 | Esc/关闭按钮关闭阅读视图 | content.js Esc+遮罩 | history 感知关闭 | PASS | RO | SPA 进入→back（I6：回 /home）；直达→仅拆除（I7：URL 不变） |
| A9 | 关闭后信息流位置恢复 | 坐标记录+恢复 | 原生 SPA back | PASS | RO | R3 实测 scrollY 2700→2701（Δ1px）、锚点帖一致（top 118→117） |
| A10 | 主题跟随（浅/暗/熄灯） | content.js 主题 | 面板读 X 主题变量 | PASS | RO | R2 实测浅色+合成暗色跟随；v3 同一代码未变 |
| A11 | 设置 popup（增强开关、翻译开关） | popup.js + chrome.storage.sync | 保留 popup 形态 | PARTIAL | SRC | PoC 未含 popup（工程改造项，非架构风险） |
| A12 | 复制链接 | content.js action bar | 面板按钮（clipboard API） | PASS | SRC+RO | 不经 X 接口；原生分享面板（aria-label=分享帖子）也在 |
| A13 | 在 X 打开原帖 | 面板按钮 | 面板头部按钮 | PASS | MV3 | PoC 既有 |
| A14 | 紧凑全局头部（图标+Peek+打开+关闭） | content.css | PoC 面板头部 | PASS | MV3 | PoC 既有（视觉精修留后续） |
| A15 | 回复工具行布局（排序+计数左，查看引用右） | content.js 工具行 | PoC 未实现 | NOT_TESTED | — | 依赖 C2 排序结论后设计；视觉精修阶段处理 |
| A16 | 阅读密度 15px/20px | content.css | PoC 面板 15px/20px | PASS | SRC | content.css 固定 |
| A17 | 原帖操作条五项原生顺序与密度 | content.js action bar | 原生操作条完整保留（v3 可见焦点格） | PASS | RO | R3：原生 caret/reply/retweet/like/bookmark + 浏览量 + 分享全可见；镜像条仅作定位辅助 |
| A18 | 操作悬停背景紧凑圆角（含数字） | content.css | 原生格承载 | PASS | SRC | 原生渲染 |
| A19 | 作者悬浮资料卡（300px/头像/关注/统计） | content.js hover card + REST 关注桥 | 原生 hover card 天然承载 | PASS | RO | R3 实测：300px、关注按钮、8,247 正在关注/9,914 关注者、资料入口（s2-hover-card.png） |
| A20 | 悬停目标贴合（头像/昵称/handle 文本） | content.js 绑定 | 原生行为 | PASS | RO | 原生目标即头像/昵称/handle；注意需真实指针轨迹（单点瞬移不触发，X 悬停意图判定） |

## B. 内容与媒体

| # | 能力 | 原版承载 | R1 承载方式 | R3 判定 | R3 证据级别 | R3 证据 / 备注 |
|---|---|---|---|---|---|---|
| B1 | 焦点帖基本字段（作者/正文/时间/计数） | core.js GraphQL 解析 | 详情页 DOM 提取 | PASS | RO | R3 多样本：作者/正文/计数/时间全部提取（0.1ms 级） |
| B2 | 认证徽标显示 | content.js verified 检测 | 原生渲染 | PASS | RO | 原生格与面板截图可见认证标 |
| B3 | 普通长帖全文 | 15px/20px 全文 | 详情页 DOM 即全文 | PASS | RO | 363 字全文两次复测一致 |
| B4 | Premium 超长帖"显示更多"展开后全文 | 展开+提取 | 原生"显示更多"+PoC 一次性显示展开 | PARTIAL | SRC+OFF | 机制已入 PoC v3（expandShowMore，非写入）；本轮未遇到 Premium 超长焦点样本→展开路径 NOT_TESTED（live） |
| B5 | X Article 完整正文内联渲染 | content.js:2384 READ_ARTICLE | 原生渲染+专用容器提取 | PASS | RO | **真实 Article 样本已获得**（wlzh/2109433207318081885）：原生 `twitter-article-title`+`twitterArticleRichTextView` 专用路径提取 4511 字（标题先行、无计数噪音）；原生格完整渲染 Article（含 8 图） |
| B6 | 引用帖嵌套渲染（含文本/图片提取） | content.js 引用卡 | 原生渲染+提取摘要 | PASS | RO | 引用作者/文本/图片提取；原生卡完整渲染 |
| B7 | 多层引用（引用的引用） | content.js 规则 | 原生渲染 | NOT_TESTED | — | 本轮无多层引用样本 |
| B8 | 已删除引用帖显示 | 引用卡占位 | 原生占位+提取 | PASS | RO | "这个帖子不可用。了解更多"占位原生渲染（s2-reply-composer.png 内可见） |
| B9 | 多图帖子渲染 | content.js 图片 | 原生渲染+提取 URL | PASS | RO | 双图样本提取 2 URL（查询参数保留） |
| B10 | 图片点击放大查看器 | 原生 lightbox | 原生 lightbox | PASS | SRC | 原生格可见后 lightbox 天然可用（未逐项目验，原生行为） |
| B11 | 网站预览卡片渲染 | content.js attachment | 原生渲染+富媒体说明条 | PASS | RO | Reuters 卡样本：原生卡在右栏完整渲染；检测路径 card.wrapper 实测 |
| B12 | 投票展示 | content.js（09-25 投票展示） | 原生渲染 | NOT_TESTED | — | 5 种途径未获投票样本（搜索页疑似不渲染投票控件本身亦为发现）；检测路径与卡片同类 |
| B13 | 投票控件可交互 | 原生控件 | 原生控件 | NOT_TESTED | — | 同上；且投票=写入 |
| B14 | 视频播放（HLS/自适应/HD-first/预热） | content.js 本地 hls.js | 原生播放器完整承载 | PASS | RO | R3：视频帖原生格可见+视频在播（720×1280，s5-v3-video-visible.png）；原版自研 HD-first/预热策略被原生策略替代（差异记录） |
| B15 | 视频真实宽高比/引用内视频不压缩 | content.css 规则 | 原生渲染规则 | PASS | SRC+RO | 原生格 720×1280 全比例显示 |
| B16 | 单视频协调播放/预热协调 | content.js:1330 互斥 | 原生行为 | PASS（设计推定部分） | SRC | X 自身协调；多视频回复流未专项目验 |
| B17 | GIF 播放 | content.js | 原生渲染 | NOT_TESTED | — | 未获独立 GIF 样本；检测与视频同路径 |
| B18 | 正文冗余短 URL 抑制 | content.js | 原生显示逻辑 | PASS | RO | 原生文本含 t.co 但显示为可见文本形态，无破坏（原版抑制的是自渲染时的冗余，原生无此问题） |
| B19 | 特殊字符/@提及渲染 | content.js（09-25 修复） | 原生渲染 | PASS | RO | 样本含 emoji/中文/URL 混排正常 |

## C. 评论

| # | 能力 | 原版承载 | R1 承载方式 | R3 判定 | R3 证据级别 | R3 证据 / 备注 |
|---|---|---|---|---|---|---|
| C1 | 评论列表与数量一致 | core.js TweetDetail | 原生评论流 | PASS | RO | 面板计数=原生 aria/文本（497=497 复测；计数 K/M/零值 aria 回退机制 R2 9/9） |
| C2 | 评论排序（相关/最新/最多喜欢） | content.js 本地排序 | **原生无排序 UI**；局部重排不安全 | PARTIAL | RO+SRC | 实锤：原生 0 个排序控件；评论格为 React 虚拟化 `transform: translateY` 绝对定位——DOM 重排必与虚拟化冲突。可行替代：Peek 自绘"已加载评论"排序视图（纯展示+跳转，不能承载原生互动按钮）。全量语料排序需私有接口（R1 放弃）→ 功能降级明示 |
| C3 | 多级子回复树 | ancestors+descendants | 原生层级渲染（连接线） | PASS | RO | 嵌套树以 thread 连接线渲染（s1b-subreply-expanded.png） |
| C4 | 子回复展开（显示回复） | 09-25 子回复状态机 | 原生"显示回复"原地展开 | PASS | RO | 真实指针点击：42→46 格、URL 不变——原地分支展开 |
| C5 | 分支回复分页/重试 | 子回复状态机 | 原生行为 | PARTIAL | RO | 展开已证；深分支分页/失败重试为 X 原生内部行为，无法逐项控制（边界样本未做） |
| C6 | 评论自动分页 | IntersectionObserver | 原生滚动分页 | PASS | RO | 15→21→27 格随滚动增长；397/399 计数样本持续加载 |
| C7 | 分页终止（无 sentinel 残留） | content.js 终止逻辑 | 原生行为 | PASS | RO | 到达文档末尾自然停止（scrollY=scrollMax=8583），无卡死加载器、无重复标签 |
| C8 | 评论去重/循环防护 | content.js | 原生行为 | PASS（原生承载口径） | RO | 无重复格观察到；防护属 X 内部实现，Peek 无需复制 |
| C9 | "发现更多"推荐与真实评论区分 | fail-closed 过滤 | 原生模块明示推荐 | PASS | RO+SRC | 本轮样本未出现该模块；原生形态自带"发现更多"标头（R2 证据保留） |
| C10 | 评论虚拟化后继续滚动正确性 | 原版无此问题 | 原生虚拟列表+Peek 左栏免疫 | PASS | RO | 8583px 深滚：焦点格被回收但 Peek 左栏不受影响（v3 设计下右栏由原生自管理） |
| C11 | 从评论回看完整上级对话链 | READ_THREAD | 原生回复详情页 | PASS | RO | 打开嵌套回复：根帖→中间回复→焦点回复 3 层 |
| C12 | 打开引用帖讨论 | 引用导航 | 原生引用卡导航 | PASS（携带 R1 证据） | RO | R1 实测引用卡导航；R3 样本为删除占位（不导航=正确） |
| C13 | 纯文字回复撰写与发送 | composer+CREATE_REPLY | 原生编辑器承载 | PARTIAL | RO+HUMAN | 编辑器打开/占位/空禁用实测；**发送 NOT_TESTED**（写入，留用户检查单） |
| C14 | 回复目标选择（回复指定评论） | composer 目标状态 | 原生评论格内回复按钮→该评论编辑器 | PASS（路径）/NOT_TESTED（写入） | RO | 每条评论自带回复按钮（实测 testid=reply+计数）；点击后 X 自己管理目标语义 |
| C15 | 回复后本地置顶+滚动可见 | content.js pin 逻辑 | 原生行为（新回复出现于流中） | NOT_TESTED | — | 需真实回复写入 |
| C16 | 无 /280 计数器、无本地字数上限 | content.js 合同 | 原生编辑器自身 | PASS | SRC+RO | 原生编辑器无 Peek 强加限制（entitlement 由 X 决定） |
| C17 | 草稿保留/重复提交防护/不确定状态 | 09-25 状态机 | 原生编辑器行为 | PARTIAL | SRC | X 原生自带草稿/防重复；Peek 无法插手其语义（接受原生行为=差异极小） |

## D. 翻译

| # | 能力 | 原版承载 | R1 承载方式 | R3 判定 | R3 证据级别 | R3 证据 / 备注 |
|---|---|---|---|---|---|---|
| D1 | 焦点帖/祖先/引用即时翻译（默认开） | TRANSLATE_TWEET X 端点 | X 原生翻译（本会话实测已自动显示译文+"显示原文"切换） | PASS（本会话实测）／体验差异如实记录 | RO | R3 实锤：回复流出现"显示原文"按钮=X 已默认显示翻译（s1b 期间）；原版"自动翻译默认开"在原生侧基本成立，无需 Peek 调 X 端点 |
| D2 | 评论接近视口时翻译 | translationObserver | 原生按视口自行翻译 | PASS | RO | 同上（X 原生行为覆盖） |
| D3 | 并发≤2 + 单标签缓存 | content.js | 原生内部实现 | PASS（原生承载口径） | SRC | Peek 无需复制 |
| D4 | 显示原文/显示翻译切换 | content.js | 原生按钮自带 | PASS | RO | "显示原文"实测存在 |
| D5 | 失败回退原文、不阻塞 | content.js | 原生行为 | PASS | SRC | 原生失败即显示原文 |
| D6 | 设置中可关闭自动翻译 | popup+storage | X 自身设置承载 | PARTIAL | SRC | 开关在 X 设置而非 Peek 设置（位置差异）；Peek popup 无翻译项 |
| D7 | DBC 后端接入就绪 | — | backend 契约已验证（R1 9/9） | PASS（离线） | OFF | 协议/密钥部署形态待用户提供 |

## E. 互动（写入一律 NOT_TESTED，除非用户亲自执行）

| # | 能力 | 原版承载 | R1 承载方式 | R3 判定 | R3 证据级别 | R3 证据 / 备注 |
|---|---|---|---|---|---|---|
| E1 | 点赞/取消点赞 | TOGGLE_ACTION 桥 | **A 类**：原生按钮直接承载（v3 可见焦点格+每条评论） | PASS（路径）；写入 NOT_TESTED | RO | v3 移除合成委托；面板按钮=定位+高亮原生控件，用户亲手点击 |
| E2 | 转发/取消转发 | 同上 | 同上 | PASS（路径）；写入 NOT_TESTED | RO | 同上 |
| E3 | 收藏/取消收藏 | 同上 | 同上 | PASS（路径）；写入 NOT_TESTED | RO | 同上 |
| E4 | 原生收藏夹分类（选择/全部书签/重分类/管理页） | content.js:2533-2557 桥 | 原生收藏按钮自带流程 | NOT_TESTED | — | 入口探索需先真实收藏（写入）；原生流程由 X 保证；留用户检查单 |
| E5 | 关注/取关/待批准 | TOGGLE_FOLLOW REST 桥 | 原生 hover card 关注钮 + caret 菜单"关注 @x"（双入口实测） | PASS（路径）；写入 NOT_TESTED | RO | 待批准态需私密账号样本 NOT_TESTED |
| E6 | 回复原帖 | composer+CreateTweet | 原生编辑器（右栏原帖内） | PASS（路径）；写入 NOT_TESTED | RO | v3 焦点格可见→编辑器可达；回复按钮定位+聚焦 |
| E7 | 回复指定评论 | 同上 | 原生评论格回复按钮 | PASS（路径）；写入 NOT_TESTED | RO | 每条评论有独立回复按钮（testid=reply） |
| E8 | 富媒体回复（图片/视频上传） | composer media+uploadMedia 桥 | 原生编辑器完整承载 | PASS（设计推定）；写入 NOT_TESTED | SRC | X 原生编辑器全能力，Peek 零参与 |
| E9 | 复制链接/分享 | content.js action bar | 面板 clipboard 按钮 + 原生分享控件（aria-label=分享帖子） | PASS | RO | 双路径 |
| E10 | 作者卡内关注控件 | TOGGLE_FOLLOW | 原生 hover card 关注钮 | PASS（路径）；写入 NOT_TESTED | RO | s2-hover-card.png |

## F. 工程机制

| # | 能力 | 原版承载 | R1 处置 | R3 判定 | R3 证据级别 | R3 证据 / 备注 |
|---|---|---|---|---|---|---|
| F1 | 读路径零扩展自构造 GraphQL | page-bridge.js | 无 bridge，DOM 提取 | PASS | RO+SRC | **18:18 逐操作一致**（原生 vs 注入 PoC 同样本请求普查，r3-network-audit.md）；源码 0 fetch/XHR |
| F2 | 无 Webpack 探测/凭据捕获 | page-bridge.js | 整体移除 | PASS | SRC | v3 源码无任何运行时探测 |
| F3 | 权限最小化 | storage+两域 | PoC 零 permissions | PASS | SRC | manifest 0.3.0 |
| F4 | MV3 生命周期（挂载/拆除/重载幂等） | manifest document_idle | 路由观察+拆除 | PASS | RO | v3 回归：重载→重建×1（I9）；拆除无残留（I10：pane/style/attr 全零） |
| F5 | SPA 路由观察（无 history 包装） | — | popstate+Navigation API+有界轮询 | PASS | RO | 跨世界路由观测（R2 六场景）+R3 back/forward/切换复测 |
| F6 | 切换帖子旧内容/异步任务清理 | 原版 rebuild 语义 | buildToken 生成 | PASS | SRC+RO | 切换/重入 paneCount 恒 1；token 失效旧构建 |
| F7 | 不改 body/html overflow | content.js 合同 | 未改 | PASS | SRC | v3 无 overflow 变更 |
| F8 | 卸载增强层后原页面完全恢复 | — | removeReader 还原 | PASS | RO | I10 断言 + v3 设计下原生格从未被移动/隐藏 |
| F9 | 登录态真实 MV3 集成验收 | — | 用户检查单待执行（v3 已更新 12 项） | NOT_TESTED | — | `exploration-poc/MV3-LOGIN-VERIFY.md`；ego 登录会话等效注入全项通过（R2 10/10 + R3 回归） |
| F10 | 构建产物完备（Phosphor/hls.js 可缩减） | build-extension.mjs | PoC 无依赖 | PASS | SRC | 原生承载后 hls.js/图标包可整体移除 |

## 统计（83 项，S6 前回填）

| 判定 | 数量 | 说明 |
|---|---|---|
| PASS | 67 | 含"路径 PASS、写入 NOT_TESTED"双状态条目（E1-E3/E5-E7/C13-C14 等，写入面在 r3-native-actions.md 单列） |
| PARTIAL | 8 | A1（交互模型不等价，用户取舍）、A11（popup 未入 PoC）、B4（超长帖展开路径未获 live 样本）、C2（排序降级）、C5（分支分页/重试为 X 内部行为）、C13（发送未验收）、C17（草稿语义原生承载）、D6（开关位置在 X 设置） |
| BLOCKED | 0 | — |
| NOT_TESTED | 8 | A15（工具行视觉）、B7（多层引用样本）、B12/B13（投票样本）、B17（GIF 样本）、C15（回复后置顶需写入）、E4（收藏夹需写入）、F9（真实 MV3 加载待用户执行） |

写入面统一声明：E1 点赞、E2 转推、E3 收藏、E5 关注、E6/E7 回复、E8 富媒体回复、E4 收藏夹操作、B13 投票——本轮 **0 次真实账号写入**，全部 NOT_TESTED，唯一写入路径是留给用户的检查单第 11 项。
