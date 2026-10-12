# R3 功能验收矩阵（逐项，按原版功能合同）

日期：2026-10-12。基线：第二轮最新提交 `7c29352ad28265c250796cbf82d3ac9362dcc22d`；原版对照 `c93066f9fa9b22aba1ba46e1cc3c0154027b9aae`（manifest 0.8.10）。

口径：

- **判定**：PASS（有证据证明当前 R1 路线能实现）／PARTIAL（主要能力可实现但存在明确功能或体验差异）／BLOCKED（技术机制或已确认平台限制导致当前路线不可行）／NOT_TESTED（缺样本、环境或授权）。
- **证据级别**（独立字段，不与判定合并）：SRC＝源码分析；OFF＝离线/合成 fixture 测试；RO＝登录会话 CDP 只读实测；MV3＝真实 MV3 运行时；HUMAN＝人工账号写入验收。
- 本矩阵把第二轮 feature-matrix.md 中被聚合在同一行的独立用户能力**拆开**（例如"图片/GIF"拆为渲染、查看器、原图地址三项），避免漏项。
- 原版行为引用固定 SHA 的源码位置。全部真实账号写入保持 NOT_TESTED，除非用户亲自执行。
- "X 原生网页理论上具备该功能"不记 PASS。

判定图例：✅=PASS，🟡=PARTIAL，⛔=BLOCKED，⬜=NOT_TESTED（下表以文字为准）。

## A. 入口与阅读

| # | 能力 | 原版承载（c93066f 锚点） | R1 承载方式 | R2 基线 | R3 判定 | R3 证据级别 | R3 证据 / 备注 |
|---|---|---|---|---|---|---|---|
| A1 | 时间线/通知点击进入阅读视图 | 点击拦截浮层（content.js:2808） | 原生 SPA 导航至详情页 + 注入增强 | 判定不等价（时间线被卸载，实锤） | 待测 | — | — |
| A2 | 详情页普通点击避让 | /status/ 不拦截 | 天然成立 | PASS | 待测 | — | — |
| A3 | 引用帖卡片点击打开被引用帖 | core.js:545 语义引用识别 | 原生引用卡导航 | PASS | 待测 | — | — |
| A4 | 回复详情显示完整上级对话链 | READ_THREAD ancestors | 原生祖先链 | PASS（3 层实测） | 待测 | — | — |
| A5 | 打开时定位焦点回复 | focal-reply 滚动定位 | 原生详情页默认定位 | PASS | 待测 | — | — |
| A6 | 独立焦点帖（无上下文）置顶显示 | content.css 布局 | 原生即置顶 | PASS | 待测 | — | — |
| A7 | 双栏 52:48 独立滚动 | content.css | vw 统一参照双栏 | PASS（52.0% 实测） | 待测 | — | — |
| A8 | Esc/关闭按钮关闭阅读视图 | content.js Esc+遮罩 | history 感知关闭 | PASS | 待测 | — | — |
| A9 | 关闭后信息流位置恢复 | 坐标记录+恢复 | 原生 SPA back | PASS（像素级） | 待测 | — | — |
| A10 | 主题跟随（浅/暗/熄灯） | content.js 主题 | 面板读 X 主题变量 | 浅色 PASS、暗色合成输入 PASS | 待测 | — | — |
| A11 | 设置 popup（增强开关、翻译开关） | popup.js + chrome.storage.sync | 保留 popup 形态 | SRC（PoC 未含） | 待测 | — | — |
| A12 | 复制链接 | content.js action bar | 面板按钮（clipboard API） | SRC | 待测 | — | — |
| A13 | 在 X 打开原帖 | 面板按钮 | 面板头部按钮 | MV3 | 待测 | — | — |
| A14 | 紧凑全局头部（图标+Peek+打开+关闭，无多余元素） | content.css | PoC 面板头部 | SRC | 待测 | — | — |
| A15 | 回复工具行布局（排序+计数左，查看引用右） | content.js 工具行 | PoC 未实现 | ⬜ | 待测 | — | — |
| A16 | 阅读密度 15px/20px | content.css | PoC content.css 已用 15px/20px | SRC | 待测 | — | — |
| A17 | 原帖操作条五项原生顺序与密度 | content.js action bar | 面板镜像条（顺序一致） | SRC | 待测 | — | — |
| A18 | 操作悬停背景紧凑圆角（含数字） | content.css | 原生格承载时天然满足 | SRC | 待测 | — | — |
| A19 | 作者悬浮资料卡（300px/头像/关注/统计） | content.js hover card + REST 关注桥 | 原生 hover card 天然承载 | 设计推定 | 待测 | — | — |
| A20 | 悬停目标贴合（头像/昵称/handle 文本） | content.js 绑定 | 原生行为 | 设计推定 | 待测 | — | — |

## B. 内容与媒体

| # | 能力 | 原版承载 | R1 承载方式 | R2 基线 | R3 判定 | R3 证据级别 | R3 证据 / 备注 |
|---|---|---|---|---|---|---|---|
| B1 | 焦点帖基本字段（作者/正文/时间/计数） | core.js GraphQL 解析 | 详情页 DOM 提取 | PASS（0.1ms 提取） | 待测 | — | — |
| B2 | 认证徽标显示 | content.js verified 检测 | 原生渲染/提取 | ⬜ 未单列 | 待测 | — | — |
| B3 | 普通长帖全文 | 15px/20px 全文 | 详情页 DOM 即全文 | PASS（363 字符） | 待测 | — | — |
| B4 | Premium 超长帖"显示更多"展开后全文 | 展开+提取 | 原生"显示更多" | 部分（未复现样本） | 待测 | — | — |
| B5 | X Article 完整正文内联渲染 | content.js:2384 READ_ARTICLE | **NOT_COVERED** | ⬜ 无样本 | 待测 | — | — |
| B6 | 引用帖嵌套渲染（含文本/图片提取） | content.js 引用卡 | 原生渲染+提取摘要 | PASS | 待测 | — | — |
| B7 | 多层引用（引用的引用） | content.js 规则 | 原生渲染 | ⬜ | 待测 | — | — |
| B8 | 已删除引用帖显示 | 引用卡占位 | 原生占位+提取 | PASS（realchendahuang 样本） | 待测 | — | — |
| B9 | 多图帖子渲染 | content.js 图片 | 原生渲染+提取 URL | PASS（双图） | 待测 | — | — |
| B10 | 图片点击放大查看器 | 原生 lightbox（原版未自绘） | 原生 lightbox | ⬜ | 待测 | — | — |
| B11 | 网站预览卡片渲染 | content.js attachment | 原生渲染 | ⬜ 无样本 | 待测 | — | — |
| B12 | 投票展示 | content.js（09-25 投票展示） | 原生渲染 | ⬜ 无样本 | 待测 | — | — |
| B13 | 投票控件可交互（投票写入 NOT_TESTED） | 原生控件 | 原生控件 | ⬜ | 待测 | — | — |
| B14 | 视频播放（HLS/自适应/HD-first/预热） | content.js 本地 hls.js | 原生播放器完整承载 | PASS（blob 源在播） | 待测 | — | — |
| B15 | 视频真实宽高比/引用内视频不压缩 | content.css 规则 | 原生渲染规则 | 设计推定 | 待测 | — | — |
| B16 | 单视频协调播放/预热协调 | content.js:1330 互斥 | 原生行为 | 设计推定 | 待测 | — | — |
| B17 | GIF 播放 | content.js | 原生渲染 | ⬜ 无独立样本 | 待测 | — | — |
| B18 | 正文冗余短 URL 抑制 | content.js | 原生显示逻辑 | ⬜ | 待测 | — | — |
| B19 | 特殊字符/@提及渲染 | content.js（09-25 修复） | 原生渲染 | PASS | 待测 | — | — |

## C. 评论

| # | 能力 | 原版承载 | R1 承载方式 | R2 基线 | R3 判定 | R3 证据级别 | R3 证据 / 备注 |
|---|---|---|---|---|---|---|---|
| C1 | 评论列表与数量一致 | core.js TweetDetail | 原生评论流 | PASS | 待测 | — | — |
| C2 | 评论排序（相关/最新/最多喜欢） | content.js 本地排序 | **原生无对应** | PARTIAL（需研究局部重排） | 待测 | — | — |
| C3 | 多级子回复树 | ancestors+descendants | 原生层级渲染+展开 | 部分（未深测） | 待测 | — | — |
| C4 | 子回复展开（显示回复） | 09-25 子回复状态机 | 原生"显示回复" | ⬜ 入口目视未点击 | 待测 | — | — |
| C5 | 分支回复分页/重试 | 子回复状态机 | 原生行为 | ⬜ | 待测 | — | — |
| C6 | 评论自动分页 | IntersectionObserver | 原生滚动分页 | PASS（16→29→52） | 待测 | — | — |
| C7 | 分页终止（无 sentinel 残留） | content.js 终止逻辑 | 原生行为 | ⬜ 未做边界样本 | 待测 | — | — |
| C8 | 评论去重/循环防护 | content.js | 原生行为 | ⬜ | 待测 | — | — |
| C9 | "发现更多"推荐与真实评论区分 | fail-closed 过滤 | 原生模块明示推荐 | PASS（设计） | 待测 | — | — |
| C10 | 评论虚拟化后继续滚动正确性 | 原版无此问题（自绘列表） | 原生虚拟列表 | ⬜ | 待测 | — | — |
| C11 | 从评论回看完整上级对话链 | READ_THREAD | 原生回复详情页 | PASS | 待测 | — | — |
| C12 | 打开引用帖讨论 | 引用导航 | 原生引用卡导航 | PASS | 待测 | — | — |
| C13 | 纯文字回复撰写与发送 | composer+CREATE_REPLY | 原生编辑器承载 | 打开目视 PASS；发送 NOT_TESTED | 待测 | — | — |
| C14 | 回复目标选择（回复指定评论） | composer 目标状态 | 原生回复目标行为 | ⬜ | 待测 | — | — |
| C15 | 回复后本地置顶+滚动可见 | content.js pin 逻辑 | 原生行为（新回复出现于流中） | ⬜ | 待测 | — | — |
| C16 | 无 /280 计数器、无本地字数上限 | content.js 合同 | 原生编辑器自身 | 设计推定（原生 entitlement） | 待测 | — | — |
| C17 | 草稿保留/重复提交防护/不确定状态 | 09-25 状态机 | 原生编辑器行为 | ⬜ | 待测 | — | — |

## D. 翻译

| # | 能力 | 原版承载 | R1 承载方式 | R2 基线 | R3 判定 | R3 证据级别 | R3 证据 / 备注 |
|---|---|---|---|---|---|---|---|
| D1 | 焦点帖/祖先/引用即时翻译（默认开） | TRANSLATE_TWEET X 端点 | 原生"显示翻译"按钮（非自动） | 原生承载但体验不同 | 待测 | — | — |
| D2 | 评论接近视口时翻译 | translationObserver | TranslationScheduler 合成验证 | 调度层 PASS（9/9） | 待测 | — | — |
| D3 | 并发≤2 + 单标签缓存 | content.js | 调度器已验证 | PASS（调度层） | 待测 | — | — |
| D4 | 显示原文/显示翻译切换 | content.js | 原生按钮自带 | PASS | 待测 | — | — |
| D5 | 失败回退原文、不阻塞 | content.js | 调度器契约 | PASS（离线） | 待测 | — | — |
| D6 | 设置中可关闭自动翻译 | popup+storage | 原生按钮方案无"自动"语义 | 设计推定 | 待测 | — | — |
| D7 | DBC 后端接入就绪 | — | backend 契约已验证 | SRC | 待测 | — | — |

## E. 互动（写入一律 NOT_TESTED，除非用户亲自执行）

| # | 能力 | 原版承载 | R1 承载方式 | R2 基线 | R3 判定 | R3 证据级别 | R3 证据 / 备注 |
|---|---|---|---|---|---|---|---|
| E1 | 点赞/取消点赞 | TOGGLE_ACTION 桥 | A 类原生控件 / B 类合成委托 | 控件 PASS；写入 NOT_TESTED | 待测 | — | — |
| E2 | 转发/取消转发 | 同上 | 同上 | 同上 | 待测 | — | — |
| E3 | 收藏/取消收藏 | 同上 | 同上 | 同上 | 待测 | — | — |
| E4 | 原生收藏夹分类（选择/全部书签/重分类/管理页） | content.js:2533-2557 桥 | 原生收藏按钮自带流程 | 设计推定；NOT_TESTED | 待测 | — | — |
| E5 | 关注/取关/待批准 | TOGGLE_FOLLOW REST 桥 | 原生 hover card 控件 | NOT_TESTED | 待测 | — | — |
| E6 | 回复原帖 | composer+CreateTweet | 原生编辑器 | 打开 PASS；发送 NOT_TESTED | 待测 | — | — |
| E7 | 回复指定评论 | 同上 | 原生评论格内编辑器 | ⬜ | 待测 | — | — |
| E8 | 富媒体回复（图片/视频上传） | composer media+uploadMedia 桥 | 原生编辑器完整承载 | 设计推定；NOT_TESTED | 待测 | — | — |
| E9 | 复制链接/分享 | content.js action bar | 面板按钮/原生分享 | SRC | 待测 | — | — |
| E10 | 作者卡内关注控件 | TOGGLE_FOLLOW | 原生 hover card | NOT_TESTED | 待测 | — | — |

## F. 工程机制（不计用户功能丢失）

| # | 能力 | 原版承载 | R1 处置 | R2 基线 | R3 判定 | R3 证据级别 | R3 证据 / 备注 |
|---|---|---|---|---|---|---|---|
| F1 | 读路径零扩展自构造 GraphQL | page-bridge.js | 无 bridge，DOM 提取 | PASS（0 自构造） | 待测 | — | — |
| F2 | 无 Webpack 探测/凭据捕获 | page-bridge.js | 整体移除 | PASS | 待测 | — | — |
| F3 | 权限最小化 | storage+两域 | PoC 零 permissions | PASS | 待测 | — | — |
| F4 | MV3 生命周期（挂载/拆除/重载幂等） | manifest document_idle | 路由观察+拆除 | 六场景 PASS | 待测 | — | — |
| F5 | SPA 路由观察（无 history 包装） | — | popstate+Navigation API+有界轮询 | PASS | 待测 | — | — |
| F6 | 切换帖子旧内容/异步任务清理 | 原版 rebuild 语义 | buildToken 生成 | SRC | 待测 | — | — |
| F7 | 不改 body/html overflow | content.js 合同 | 未改 | PASS | 待测 | — | — |
| F8 | 卸载增强层后原页面完全恢复 | — | removeReader 还原 | PASS | 待测 | — | — |
| F9 | 登录态真实 MV3 集成验收 | — | 用户检查单待执行 | NOT_MEASURED | 待测 | — | — |
| F10 | 构建产物完备（Phosphor/hls.js 可缩减） | build-extension.mjs | PoC 无依赖 | SRC | 待测 | — | — |

## 统计

（S6 前回填）

| 判定 | 数量 |
|---|---|
| PASS | — |
| PARTIAL | — |
| BLOCKED | — |
| NOT_TESTED | — |
