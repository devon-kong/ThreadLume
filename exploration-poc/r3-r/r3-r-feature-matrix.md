# R3-R 功能验收矩阵（双维度修订版，83 项）

日期：2026-10-12。基线：R3 gate 提交 `96065bd`。本矩阵把 R3 的单维度判定（PASS/PARTIAL/…）拆分为两个独立维度，消除"入口存在"与"端到端通过"混计的问题。

## 判定口径

**维度一：架构覆盖**（该架构能否承担该能力）
- **FULL**：此架构能够完整承担对应能力（含"由 X 原生网页提供、Peek 无需自建"的能力——原生承载即架构承载）。
- **PARTIAL**：存在确定的功能或体验差异。
- **BLOCKED**：已确认的技术阻断。**UNKNOWN**：证据不足以判定。

**维度二：实际验证**（每项取已达到的最高层级，写入面单独标注）
- **SRC**＝源码证据；**OFFLINE**＝离线测试（46 项，`npm run test:r3-r`）；**BROWSER_RO**＝真实登录网页只读实测（CDP 注入层级，见 MV3-LOGIN-VERIFY.md L3）；**MV3**＝真实扩展运行验证；**HUMAN_WRITE**＝用户人工写入验收；**NOT_TESTED**＝未验证。

**R3-R 口径修正**（相对 R3 矩阵）：
1. R3 的 A13/A14 证据级别标了 "MV3"——实为 CDP 等效注入（L3），属层级混计，本轮更正为 BROWSER_RO。**全矩阵 MV3 层级证据为 0 项**（真实扩展加载 NOT_TESTED）。
2. A11（popup）、C5/C8（分页/去重）、C17（草稿语义）由 PARTIAL 改判架构 FULL——依据"X 原生提供、Peek 无需自建"的承载规则；其实际验证状态如实保留（popup 未实现 = SRC；C5 边界样本未做等）。
3. B14/B16（视频）改判架构 PARTIAL——原版 HD-first/预热/单视频协调策略在 R1 下被原生策略替代，属确定的能力差异（R3 已在备注记录差异但判定为 PASS/NOT_TESTED，本轮口径归一）。
4. 全部真实账号写入（E1-E3/E5-E8/E10、C13-C15、B13、E4）统一标注 **HUMAN_WRITE=NOT_TESTED**；本轮 0 次真实账号写入。

证据索引：R3 证据 = `exploration-poc/r3/evidence/`（截图）与 r3-*.md；R3-R 证据 = `exploration-poc/r3-r/`（46 项离线测试、12 窗口网络证据、r3-r-*.md 报告）。

## A. 入口与阅读（20）

| # | 能力 | 架构 | 验证 | 备注 |
|---|---|---|---|---|
| A1 | 时间线/通知点击进入阅读视图 | PARTIAL | BROWSER_RO | 原生 SPA 导航替代不跳走浮层（R2 实锤差异）；点击→URL 896ms、面板同步（s3-open-from-timeline）。**用户取舍项** |
| A2 | 详情页普通点击避让 | FULL | BROWSER_RO | 原生详情页保持权威 |
| A3 | 引用帖卡片点击导航 | FULL | BROWSER_RO | R1 实测引用卡→被引用帖→back 正确 |
| A4 | 回复详情完整祖先链 | FULL | BROWSER_RO | 三层链实测（s1b-ancestor-chain） |
| A5 | 打开时定位焦点回复 | FULL | BROWSER_RO | 原生详情页默认定位 |
| A6 | 独立焦点帖置顶 | FULL | BROWSER_RO | 单帖详情无祖先格 |
| A7 | 双栏 52:48 独立滚动 | FULL | BROWSER_RO | v3/v4 vw 统一参照 |
| A8 | Esc/关闭关闭阅读视图 | FULL | BROWSER_RO | SPA 进入→back；直达→仅拆除（v4 离线测试同证） |
| A9 | 关闭后信息流位置恢复 | FULL | BROWSER_RO | scrollY Δ1px、锚点一致（R3） |
| A10 | 主题跟随 | FULL | BROWSER_RO | 浅/暗实测 |
| A11 | 设置 popup | FULL | SRC | 架构无阻碍（普通扩展 UI）；PoC 未含，正式工程实现项。R3 判 PARTIAL 系单维口径所致 |
| A12 | 复制链接 | FULL | BROWSER_RO | clipboard API，不经 X 接口 |
| A13 | 在 X 打开原帖 | FULL | BROWSER_RO | R3 误标 MV3，本轮更正（层级混计） |
| A14 | 紧凑全局头部 | FULL | BROWSER_RO | 同上更正 |
| A15 | 回复工具行布局 | PARTIAL | NOT_TESTED | PoC 未实现；设计依赖 C2 取舍结论 |
| A16 | 阅读密度 15px/20px | FULL | SRC | content.css 固定 |
| A17 | 原帖操作条原生五项顺序 | FULL | BROWSER_RO | 原生条完整保留（v3+ 设计） |
| A18 | 操作悬停紧凑圆角 | FULL | SRC | 原生渲染 |
| A19 | 作者悬浮资料卡 | FULL | BROWSER_RO | 300px/关注钮/统计实测（s2-hover-card） |
| A20 | 悬停目标贴合 | FULL | BROWSER_RO | 原生目标即头像/昵称/handle |

## B. 内容与媒体（19）

| # | 能力 | 架构 | 验证 | 备注 |
|---|---|---|---|---|
| B1 | 焦点帖基本字段 | FULL | BROWSER_RO+OFFLINE | 提取函数 fixture 测试（r3-r extraction 套件） |
| B2 | 认证徽标 | FULL | BROWSER_RO | 原生渲染 |
| B3 | 普通长帖全文 | FULL | BROWSER_RO | 363 字复测 |
| B4 | Premium"显示更多"展开 | FULL | OFFLINE | v4 展开路径 + 竞态下一次性点击（B4-4 离线证）；live 超长样本未遇→live 面 NOT_TESTED |
| B5 | X Article 完整正文 | FULL | BROWSER_RO+OFFLINE | 真实样本 4511 字（wlzh/…885）；fixture 提取+媒体归属测试；富文本结构能力表见 r3-r-data-integrity.md |
| B6 | 引用帖嵌套渲染 | FULL | BROWSER_RO+OFFLINE | C2 修复：主帖/引用照片互不混入（离线证） |
| B7 | 多层引用 | FULL | NOT_TESTED | 无样本；原生渲染机制与单层引用同路 |
| B8 | 已删除引用占位 | FULL | BROWSER_RO+OFFLINE | 占位识别离线测试 |
| B9 | 多图帖子 | FULL | BROWSER_RO | 双图样本 |
| B10 | 图片点击查看器 | FULL | NOT_TESTED | 原生 lightbox；未逐项目验（R3 G9-2 口径保留） |
| B11 | 网站预览卡片 | FULL | BROWSER_RO+OFFLINE | card.wrapper 缩略图不误归属（离线证） |
| B12 | 投票展示 | FULL | NOT_TESTED | 无样本 |
| B13 | 投票可交互 | FULL | NOT_TESTED | 原生控件；投票=写入（HUMAN_WRITE NOT_TESTED） |
| B14 | 视频播放与原版 HD-first/预热策略 | PARTIAL | BROWSER_RO | 原生播放器在播实测（720×1280）；**原版自研 HD-first≥720p 起播、预热窗口、码率自适应策略被原生策略替代**——确定的能力差异，正式迁移属用户取舍 |
| B15 | 视频真实宽高比 | FULL | BROWSER_RO | 原生全比例 |
| B16 | 单视频协调/预热协调 | PARTIAL | NOT_TESTED | 原版互斥协调不被 R1 承载（原生多视频行为自身管理，无 Peek 保证） |
| B17 | GIF 播放 | FULL | NOT_TESTED | 无独立样本；原生承载与视频同路 |
| B18 | 冗余短 URL 抑制 | FULL | BROWSER_RO | 原生显示形态无破坏 |
| B19 | 特殊字符/提及渲染 | FULL | BROWSER_RO | emoji/中文/URL 混排 |

## C. 评论（17）

| # | 能力 | 架构 | 验证 | 备注 |
|---|---|---|---|---|
| C1 | 评论计数一致 | FULL | BROWSER_RO+OFFLINE | 497=497 复测；parseCount/countOf 离线测试（K/M/零值 aria/垃圾→未知） |
| C2 | 评论排序 | PARTIAL | BROWSER_RO+SRC | 原生无排序 UI；虚拟化 DOM 重排不安全；可行替代=自绘已加载评论排序视图（未实现）。**用户决策：接受降级或批准进工程范围** |
| C3 | 多级子回复树 | FULL | BROWSER_RO | 连接线层级渲染 |
| C4 | 子回复展开 | FULL | BROWSER_RO | 真实指针点击 42→46 格 |
| C5 | 分支回复分页/重试 | FULL | BROWSER_RO | 原生承载（"显示回复"原地展开实测）；深分支边界样本未做（如实记录） |
| C6 | 评论自动分页 | FULL | BROWSER_RO | 15→21→27 随滚动增长 |
| C7 | 分页终止 | FULL | BROWSER_RO | 自然停止、无残载 |
| C8 | 评论去重/循环防护 | FULL | BROWSER_RO | 深滚无重复格；X 内部实现、Peek 不可控但由原生提供 |
| C9 | "发现更多"推荐区分 | FULL | BROWSER_RO+SRC | 原生明示推荐标头 |
| C10 | 虚拟化后滚动正确性 | FULL | BROWSER_RO | 8583px 深滚左栏免疫 |
| C11 | 评论回看祖先链 | FULL | BROWSER_RO | 三层复测 |
| C12 | 打开引用帖讨论 | FULL | BROWSER_RO | 引用卡导航 |
| C13 | 纯文字回复撰写 | FULL | BROWSER_RO | 编辑器路径实测；**发送=HUMAN_WRITE NOT_TESTED** |
| C14 | 回复目标选择 | FULL | BROWSER_RO | 每条评论独立回复钮；写入 NOT_TESTED |
| C15 | 回复后展示位置 | FULL | NOT_TESTED | 原生行为（需写入）；原版"本地置顶+滚动"语义差异→**用户取舍确认** |
| C16 | 无 /280 强加限制 | FULL | BROWSER_RO+SRC | 原生无 Peek 强加限制 |
| C17 | 草稿/重复提交语义 | FULL | SRC | X 原生编辑器自带；R1 整体委托（原版 Peek 亦无法插手其内部） |

## D. 翻译（7）

| # | 能力 | 架构 | 验证 | 备注 |
|---|---|---|---|---|
| D1 | 即时翻译默认开 | PARTIAL | BROWSER_RO | 本会话实测自动显示译文；**依赖 X 账号语言设置，Peek 不可保证**（R3 G9-1 改判保留） |
| D2 | 评论接近视口翻译 | FULL | BROWSER_RO | 原生按视口自行翻译 |
| D3 | 并发≤2 + 缓存 | FULL | SRC | 原生内部实现，Peek 无需复制 |
| D4 | 显示原文/翻译切换 | FULL | BROWSER_RO | 原生按钮实测 |
| D5 | 失败回退原文 | FULL | SRC | 原生行为 |
| D6 | 设置中可关闭 | PARTIAL | SRC | 开关在 X 设置而非 Peek 设置（位置差异明示） |
| D7 | DBC 后端契约 | FULL | OFFLINE | R1 用原生翻译不需要它；原版增强路径契约已验证（9/9），部署形态待用户提供 |

## E. 互动（10）——写入面统一 HUMAN_WRITE NOT_TESTED，本轮 0 次真实写入

| # | 能力 | 架构 | 验证 | 备注 |
|---|---|---|---|---|
| E1 | 点赞/取消 | FULL | BROWSER_RO | 路径：定位+高亮原生控件（离线 B4 套件同证无合成点击）；**写入 NOT_TESTED** |
| E2 | 转发/取消 | FULL | BROWSER_RO | 同上 |
| E3 | 收藏/取消 | FULL | BROWSER_RO | 同上 |
| E4 | 原生收藏夹分类 | FULL | NOT_TESTED | 原生收藏按钮自带流程（09-25 合同）；入口探索需真实收藏→HUMAN_WRITE NOT_TESTED |
| E5 | 关注/取关 | FULL | BROWSER_RO | hover card + caret 菜单双入口实测；**写入 NOT_TESTED**；待批准态无私密样本 |
| E6 | 回复原帖 | FULL | BROWSER_RO | v3+ 焦点格可见→编辑器可达；写入 NOT_TESTED |
| E7 | 回复指定评论 | FULL | BROWSER_RO | 每条评论独立回复钮；写入 NOT_TESTED |
| E8 | 富媒体回复 | FULL | SRC | 原生编辑器全能力、Peek 零参与；写入 NOT_TESTED |
| E9 | 复制链接/分享 | FULL | BROWSER_RO | 面板 clipboard + 原生分享双路径 |
| E10 | 作者卡关注控件 | FULL | BROWSER_RO | 原生 hover card 关注钮；写入 NOT_TESTED |

## F. 工程机制（10）

| # | 能力 | 架构 | 验证 | 备注 |
|---|---|---|---|---|
| F1 | 读路径零扩展自构造 GraphQL/REST | FULL | BROWSER_RO+OFFLINE | **R3-R 强化**：分类器修复后 2 轮×3 场景×2 条件=12 窗口脱敏证据，R1 独有 API 操作=**无**、非 API 请求=**无**，可独立复算（r3-r-network-audit.md） |
| F2 | 无 Webpack 探测/凭据捕获 | FULL | SRC | v4 源码复审 |
| F3 | 权限最小化 | FULL | SRC | manifest 0.4.0 零 permissions |
| F4 | MV3 生命周期（挂载/拆除/重载幂等） | FULL | BROWSER_RO+OFFLINE | R3 RO 回归 + **v4 竞态套件 10 场景**（gen 失效/有界恢复/单观察链） |
| F5 | SPA 路由观察 | FULL | BROWSER_RO+OFFLINE | popstate+Navigation API+自调度有界轮询（500ms 活动/2s 闲置，异常安全） |
| F6 | 切换帖子旧任务清理 | FULL | OFFLINE+BROWSER_RO | v4：removeReader 递增代际，B4-3/B4-5 迟到 DOM 不抢占 |
| F7 | 不改 body/html overflow | FULL | SRC | v4 无 overflow 变更 |
| F8 | 卸载后页面完全恢复 | FULL | OFFLINE+BROWSER_RO | B4-1/B4-9：拆除后 30 万 ms 假时间推进零残留挂载 |
| F9 | 登录态真实 MV3 集成验收 | FULL | NOT_TESTED | 架构=标准 MV3 manifest（SRC）；**L4/L5 全部 NOT_TESTED**，检查单 13 项待用户执行（MV3-LOGIN-VERIFY.md） |
| F10 | 构建产物完备 | FULL | SRC | 原生承载后 hls.js/图标包可整体移除 |

## 统计

**架构覆盖**（83 项）：FULL **76** ｜ PARTIAL **7**（A1、A15、B14、B16、C2、D1、D6）｜ BLOCKED **0** ｜ UNKNOWN **0**

**实际验证**（每项取已达到的最高层级；83 = 59 + 12 + 2 + 10）：
| 验证层级（最高） | 项数 | 明细 |
|---|---|---|
| BROWSER_RO | 59 | A1-A10、A12-A14、A17、A19、A20；B1-B3、B5、B6、B8、B9、B11、B14、B15、B18、B19；C1-C14、C16；D1、D2、D4；E1-E3、E5-E7、E9、E10；F1、F4、F5、F6、F8（其中 A8、B1、B5、B6、B8、B11、C1、F1、F4、F5、F6、F8 并列 OFFLINE 证据） |
| SRC | 12 | A11、A16、A18；C17；D3、D5、D6；E8；F2、F3、F7、F10 |
| OFFLINE | 2 | B4（机制已测、live 样本未遇）、D7（契约验证） |
| NOT_TESTED | 10 | A15、B7、B10、B12、B13、B16、B17、C15、E4、F9 |
| MV3 层级证据 | **0** | R3 的 2 处误标（A13/A14）本轮更正为 BROWSER_RO |
| HUMAN_WRITE | **0 执行** | E1-E3/E5-E8/E10、C13-C15、B13、E4 写入面全部 NOT_TESTED（本轮 0 次真实账号写入） |

### 与 R3 统计（PASS 63 / PARTIAL 10 / BLOCKED 0 / NOT_TESTED 10）的差异解释

1. **口径拆分本身**：R3 的 "PASS 63" 把"架构能承担"与"已端到端验证"压成一个数。拆分后：架构 FULL 76，其中 55 项有真实只读实测，其余靠 SRC/OFFLINE/NOT_TESTED 如实分层。
2. **PARTIAL 10 → 7**：A11（popup）、C5/C8（分页/去重）、C17（草稿）五项中的四项改判 FULL——R3 把"Peek 不可控"误算作"能力缺损"，按本轮承载规则，X 原生提供即架构 FULL（验证状态不变）；新增 B14/B16 两项 PARTIAL（视频策略差异，R3 已记录差异但判定未归一）。净减 3 项。
3. **NOT_TESTED 10 → 10**（项有出入）：B4 升为 OFFLINE（live 样本未遇如实记录）；B16 由 NOT_TESTED 改 PARTIAL/NOT_TESTED 双标；A15 维持。
4. **MV3 误标更正**：R3 A13/A14 的 "MV3" 证据实为 CDP 等效注入（L3）。全矩阵当前无任何 L4/L5 证据——真实扩展验收仍待用户检查单。
5. **写入面不变**：全部真实写入维持 NOT_TESTED，本轮 0 次写入，与 R3 一致。

> 用户决策点（正式迁移前确认，不因技术 GO 而自动通过）：A1 交互模型、C2 排序降级或自绘方案进范围、B14/B16 视频策略差异、C15 回复位置语义、D1/D6 翻译预期。
