# Peek 优化第一轮探索报告（原生页面承载路线）

日期：2026-10-12。执行：本地 Agent（ZCode），按《Peek 扩展优化：第一轮探索任务书（评审修订版）》（2026-10-11 附件 `Peek-探索任务书-修订版-20261011.md`）执行。本文件是探索报告，不是已验收的改造方案。

> **第二轮补证（2026-10-12）**：首轮产物经评审"有条件通过、不批准迁移"并给出 P0 清单。本轮已按清单完成 PoC v2 修复与复测，见文末「第二轮补证结果」章节——该章节与首轮正文冲突之处，以补证章节为准（核心变化：问题 A 已有实锤证据，R1 交互模型判定为不等价）。

## 1. 执行摘要

1. **同源 iframe 路线被 X 的响应头直接阻断**：详情文档返回 `X-Frame-Options: DENY`，任何祖先（包括 x.com 自身与 chrome-extension:// 页面）都无法内嵌。行为验证一致（iframe 注入 14 秒 contentDocument 恒为 null）。该路线在合规手段内无解，已停止。
2. **原生 SPA 详情页承载路线可行且体验关键项全部落地**：原生导航往返对信息流位置的恢复是像素级（scrollY=2800 分毫不差、锚点帖与视口相对位置一致）；祖先链、引用卡导航、评论分页、视频播放、长文全文均由原生页面直接承载。
3. **推荐架构**：保留单一 MV3 扩展；Peek 从"浮层+GraphQL 桥"改为"**原生详情页增强**"——Peek 自绘左栏（DOM 提取数据，独立滚动）+ 原生评论列右移（48%）+ Esc/关闭=`history.back()`。混合双栏在登录会话（CDP 试验）与真实 MV3 运行时（隔离 Edge 149 + 未登录页面）双重验证。
4. **读路径可完全去除内部 API 依赖**：DOM 提取提供作者/正文/媒体/引用/互动计数字段（Views 数未提取；未登录回退形态下时间/计数可能缺失——提取+建面板 ~0.9ms，单次实测）；干净基线证明无 page-bridge 时页面正常。旧 bridge 的 fetch/XHR 包装、Webpack 探测、凭据捕获可整体移除。
5. **明确保留的缺口**：本地评论排序无原生对应物；X Article 无样本未覆盖；登录态下的扩展运行时验证未完成（见 §7）；全部真实账号写入 NOT_TESTED。

## 2. 基线（S0）

- 上游 SHA `c93066f9fa9b22aba1ba46e1cc3c0154027b9aae`；本地工作区 `/Users/devon/claude/peek-main` 为非 git 副本，与该提交 `diff -rq` 仅差 `dist-extension/`（构建产物）。manifest 0.8.10。
- 环境记录：node v26.9.0 / npm 11.19.1；依赖 hls.js 1.7.0、sharp 0.35.3、vite 6.4.3 等（`npm ls --depth=0`）。
- 离线测试：`npm test`（含 preview+extension 构建）**119/119 通过**，与 CHANGELOG"119 项通过"一致。未删改任何断言；上游"不用 iframe/必须走 page bridge"断言保持原样（旧架构约束，正式选型后再变更）。
- 功能索引：README 02 节 + CHANGELOG 2026-09-25/09-16 + 源码锚点（见 feature-matrix.md 各行"原版"列）。
- **干净浏览器基线**：ego-browser 空间（扩展目标仅 Chrome 内建 Media Router 与 x.com 自身 sw.js）；在 x.com/home 新文档上运行证据：`__tuzaiPageBridgeInstalled` 阴性、fetch/XHR 无 tuzai 包装、无 tuzai DOM/样式。原版 Peek 未安装=基线干净。原版性能对照 NOT_MEASURED（按任务书不为对照启用其内部请求）。

## 3. 样本（S3.1 口径）

| # | 样本 | 类型覆盖 |
| --- | --- | --- |
| 1 | xiangxiang103/2109088800903483616 | 折叠长帖（时间线预览折叠、详情页全文 363 字符）+ 双图 + 28 回复 |
| 2 | 077G_/2109125048972001688 | 视频（blob/MSE）+ 206 回复多级讨论池 |
| 3 | realchendahuang/2108753599711088801 | 引用帖卡片（被引用帖已删）+ 图 + 30 回复 |
| 4 | gefei55/2109304575786393643、aibizhe/2109253405365719281、gefei55/2109157237499531308 | 普通图文（性能测量轮换样本） |

- X Article：未在时间线出现 → **NOT_COVERED**（未爬取补齐）。
- 投票/网站卡片：未出现在固定样本 → NOT_COVERED（原生渲染能力由 X 自身保证，风险低）。
- 未登录形态：xiangxiang103 同帖用于 MV3 运行时验证（服务端渲染 `#urt:conversation:*` 结构）。

## 4. S1 路线筛选

### 4.1 同源 iframe —— 当前阻断

- 证据（固定样本 1）：对 `https://x.com/xiangxiang103/status/2109088800903483616` 的文档 GET 返回 `x-frame-options: DENY`（响应头白名单采集，仅记录安全头）；CSP 头以 connect-src 开头（frame-ancestors 判定不依赖该头，XFO DENY 在 Chrome 系已足够禁止一切内嵌，规范上 frame-ancestors 存在时 XFO 被忽略——两者任一都阻断）。
- 行为证据：在 x.com/home DOM 注入命名空间浮层 + 单个详情 iframe，14 秒轮询 `contentDocument` 恒为 null，帧从未初始化。
- 按任务书 5.1 判定：**被安全策略阻断 → 停止此路线**。不改写 CSP/XFO、不代理绕过（任务书约束 2.6）。
- 顺带成立：`chrome-extension://` 页面内嵌同样被 DENY 阻断（XFO DENY 不区分祖先），无需在扩展页重复试验。
- 清理：浮层移除后页面 scrollY 不变（2800→2800），无 body/html 改动。

### 4.2 原生 SPA 路由与局部布局 —— 技术上可继续

结构性事实（登录会话，样本 1）：

- 详情页**无内部滚动容器**（文档级滚动）；焦点帖与回复是同一虚拟化列表的兄弟格，X 用 `position:absolute + translateY` 内联定位单元格。
- 冷载（goto 直达详情）到首段正文 1.57s；会话内 SPA 点击→URL 变更 ~25ms、→首段正文 342–447ms、→首批回复可读 1.3–1.4s（暖缓存，原始样本见 §6）。

CSS 双栏实验（不动 React 节点，3 次迭代封顶内）：

1. sticky 左栏首次尝试：X 的内联 absolute 定位压过普通样式表；但滚动 2400px 内焦点格保持挂载（focalConnected 恒真），评论 16→52 格持续分页。
2. `position: sticky !important; transform: none !important` 生效：视觉双栏成立（焦点格恒 top:0，宽度 52%），滚动至 4690px 分页正常。
3. **边界发现**：滚动 ~5000px 后 X 虚拟化器回收焦点格（revert 后列表第 0 格 translateY=4519，已非焦点帖）——纯 CSS 左栏长滚动会失效。
- 结论：**双栏独立滚动不能靠纯 CSS 达成**（两栏共享一个虚拟列表），但"Peek 自绘左栏 + 原生评论列右移"规避了回收问题（左栏内容归 Peek 所有，原生焦点格被隐藏或回收都无害）。

### 4.3 筛选结论

- iframe：当前阻断（§4.1）。
- SPA+局部布局：技术上可继续，作为唯一深入候选（选择理由：核心体验三项——阅读位置连续、祖先上下文、评论完整性——全部由原生承载且实测成立；维护成本上删除 bridge/播放器/解析器三大块）。

## 5. S2 候选路线验证（全部 BROWSER-RO，登录会话，只读）

| 验证项 | 结果 | 证据要点 |
| --- | --- | --- |
| 混合双栏（左 Peek 自绘+右原生评论） | ✅ 成立 | 面板由 DOM 提取数据渲染（作者/正文/图/引用摘要/计数）；右列 margin-left 48% 后分页持续（20→29 格）；清理后 focus/布局完全还原 |
| 左栏独立滚动 | ✅ 结构成立 | fixed+overflow 独立于文档滚动（docY=1594 时面板 scrollTop 独立）；样本正文短无溢出属预期 |
| 焦点身份一致 | ✅ | 左栏与右列同源提取自同一焦点格，无"引用当主帖/推荐当评论"路径 |
| 信息流恢复 | ✅ 像素级 | 点击→详情→back：scrollY 2800→2800，首可见帖 yupi996/2109155282685440210 top=490 完全一致 |
| 引用卡导航 | ✅ | 点击 div[role=link] 引用卡→被引用帖详情，back 正确（原生行为，替代原版 quoted_status_result 解析） |
| 祖先链 | ✅ | 回复详情页原生渲染 根帖→中间回复→焦点回复 3 层 |
| 长文全文 | ✅ | 详情页焦点帖 DOM 即全文（时间线折叠≠详情页折叠）；"显示更多"折叠极端情形可在展开后提取（本样本未复现焦点帖折叠，部分验证） |
| 翻译入口 | ⚠️ 部分 | 原生"显示翻译"按钮按语言差异出现（英文 UI+中文帖可见）；登录态中文 UI 下中文帖无按钮；自动翻译需 Peek 调度器方案（§7 合成验证） |
| 视频播放 | ✅ 原生承载 | 077G_ 样本 video 元素 blob: MSE 源在播；单视频协调/清晰度策略归 X 原生 |
| 评论分页终止/去重 | ⚠️ 未完整验证 | 原生持续加载已证；终止与去重是 X 原生行为，未做边界样本 |

清理责任（任务书 6.3）：所有注入实验以 `finally` 移除节点/样式并复核（浮层移除、focus 可见性还原、scrollY 不变均有断言输出）；未修改 body/html overflow；未重放 GraphQL、未扫 Webpack。

## 6. S3/S5：MV3 边界与性能

### 6.1 最小 MV3 PoC（exploration-poc/mv3-poc/）

- 内容：manifest（**零 permissions、零 host_permissions 声明**，仅 content_scripts matches）+ content.js（ISOLATED，SPA 路由监听、DOM 提取、左栏渲染、Esc/关闭=history.back()、路由离开拆除）+ content.css。
- 明确不做：无 MAIN world、无 fetch/XHR 包装、无 Webpack 探测、无 GraphQL、无 storage。
- 运行时验证（隔离配置，未触碰用户主配置/凭据）：
  - Chrome 155 稳定版：`--load-extension` 已被 Google 移除（`--disable-features=DisableLoadExtensionCommandLineSwitch` 无效），**无法**加载未打包扩展。
  - **Edge 149（Chromium 内核）+ 全新隔离 profile：验证通过**——内容脚本隔离世界存在（`Peek Native Carrier PoC` execution context）、未登录服务端渲染 DOM 上提取 421 字符正文并建栏、样式注入、`data-peek-poc=on`、截图证据 `evidence/s3-mv3-poc.png`。
  - 页内合成 pushState 清理测试因未登录路由强制跳转（/home→/i/jf/onboarding/web）不可判读；路由拆除逻辑在 CDP 试验中等价验证（S2 清理断言）。
- **登录态扩展运行时验证未完成**：ego-browser 无法在启动期加载扩展（无启动参数接口），登录会话只能以 CDP 注入等价逻辑验证（已做，S2）。按任务书 7："CDP 成功不能替代扩展集成验证"——正式改造前需在用户日常 Chrome 的隔离 profile（带登录态）或手工加载完成一次集成验收。

### 6.2 性能（小样本，原始数据如实列出；原版 NOT_MEASURED）

| 指标 | 原生 SPA（候选基座） | 说明 |
| --- | --- | --- |
| 点击→URL 变更 | 25ms, 24ms（2 样本暖缓存） | SPA 导航本身 |
| 点击→首段正文可读 | 447ms / 342ms（2 样本暖缓存）；1.57s（冷载直达） | rAF 轮询测得，非 p95 |
| 点击→首批回复可读 | 1414ms / 1277ms（同上） | ≥3 条回复格 |
| Peek 提取+建面板开销 | 0.1ms + 0.8ms ≈ 0.9ms（单次实测） | 登录会话实测 |
| 额外页面实例 | 0（SPA 路线）/ 1（iframe 路线，已否决） | — |
| 关闭后残留 | 无 iframe/无 Peek observer/无计时器（PoC 路由拆除） | CDP 试验断言 |

第三次测量轮次因时间线虚拟化状态抖动未取得有效样本（如实记录，不重跑凑数）。

### 6.3 合成验证（离线，无网络）

- **TranslationScheduler**（exploration-poc/translation-provider/）：缓存命中、并发去重、并发上限 2、调用方取消、超时、代次隔离（reset 后旧结果永不浮现）、类型化失败、缓存驱逐——`node --test` **9/9 通过**。后端可插拔（X 端点/DBC/其他）；DBC 协议未提供，未接真实服务。
- **AI 回复草稿接口**（exploration-poc/ai-draft/）：上下文围栏（网页文本按不可信数据引用）、缺失上下文显式标识、draft-only + human-review-required 免责元数据、截断上下文如实传递——**4/4 通过**。模型仅为纯文本→文本函数，无工具、无自动发送路径。

## 7. 未完成 / 未验收清单（直接回答任务书九.3 问题）

1. **哪些路线在什么环境下已验证？** iframe：登录会话 BROWSER-RO 证伪（阻断）。SPA+混合双栏：登录会话 BROWSER-RO 证实 + 未登录 MV3（Edge 149）运行时证实。
2. **关键能力哪些仍不等价？** 本地评论排序（无原生对应）；自动翻译默认开启体验（原生按钮按需出现；Peek 调度器需接后端）；X Article（NOT_COVERED）；原版自研视频 HD-first/预热策略被原生播放器替代。
3. **真实账号写入验收？** 全部 NOT_TESTED：点赞/转发/收藏/关注/回复/上传/投票。原生按钮路线下这些是"用户本人操作原生控件"，仍需真人端到端验收。
4. **MV3 运行时验证？** 部分：未登录页面 + 零权限 PoC 在 Edge 149 通过；**登录态集成验证未完成**；Chrome 155 测试通道问题需用户侧决策（见 architecture-decision.md）。
5. **是否仍需要旧 GraphQL/认证桥接？** 读路径：**不需要**（DOM 提取+原生承载，0.9ms 开销已证）。写路径：若保留"Peek 自绘互动按钮"则需要；若接受原生按钮则**完全不需要**——推荐后者，见决策文件。
6. **DBC/AI 草稿缺什么？** DBC：协议/鉴权/配额/数据条款文档，密钥部署形态决策。AI 草稿：真实模型服务接入与提示词打磨（接口与护栏已合成验证）。
7. **信息流恢复/完整长文/子回复/排序/媒体如何处理？** 恢复：原生像素级（优于原版坐标法）；长文：详情页 DOM 即全文；子回复：原生展开承载；排序：体验损失，需产品取舍；媒体：原生播放器完整承载。

## 8. 研究范围变更记录（任务书 2.2 要求）

上游 AGENTS.md 规定"不使用 iframe、必须走 GraphQL 动态发现桥接、不搬移 React 节点"。本轮依据任务书明确授权，在隔离 PoC 与只读试验中研究了**原生页面替代路线**（含一次性 iframe 嵌入验证）。该授权仅覆盖探索；未修改旧架构测试断言、未改动正式产品包、未推送/发布任何内容。AGENTS.md 的修订留给正式选型后（见 architecture-decision.md 下一阶段范围）。

## 9. 证据清单

- `exploration-poc/mv3-poc/`：最小 MV3 包（manifest/content.js/content.css；含 Reviewer 确认缺陷的修复：焦点格按 status id 定位、Esc 守卫、history 包装幂等）
- `exploration-poc/translation-provider/`：TranslationScheduler 实现 + 9 项离线测试
- `exploration-poc/ai-draft/`：草稿接口 + 4 项离线测试
- `exploration-poc/evidence/`：s1-iframe-raw.png、s1-spa-cold-detail.png、s1-spa-split-scroll.png、s1-spa-split-v2.png、s2-spa-detail-from-timeline.png、s2-quote-sample.png、s2-hybrid-split.png、s2-reply-ancestors.png、s2-reply-detail-ancestors.png、s3-mv3-poc.png（均为公开区域截图，无账号菜单/凭据/私信）

## 附录 A：逐样本试验触发台账（任务书 3.1 预算对账）

| 样本 | 原生展开 | 分页触发（滚动加载） | 导航 | 说明 |
| --- | --- | --- | --- | --- |
| xiangxiang103/2109088800903483616 | 1（"显示更多"点击，实际命中回复的折叠而非焦点帖，对焦点帖无效） | 7（S1.2 三次迭代中的视口滚动观察，16→34→38→52→44→49→40 格） | 2 goto 重载 | **超出最严格"每样本≤2 次分页触发"口径**：虚拟化存活测量本身以滚动为预定步骤（三次迭代=三次额外开关预算内）。全部为只读滚动，产生的分页请求与真人阅读等价，无任何写入与爬取补齐 |
| realchendahuang/2108753599711088801 | 0 | 2（混合 PoC 右列滚动，20→29 格） | 2（引用卡导航→被引用帖→back） | — |
| 077G_/2109125048972001688 | 0 | 2（嵌套回复搜寻滚动，未找到目标） | 1（进入首条回复详情验证祖先链） | — |
| gefei55/aibizhe 等性能轮换样本 | 0 | 0 | 2（点击→详情→back 计时往返；第三轮因时间线状态抖动作废未触发） | — |

翻译探针 0 次触发（原生"显示翻译"按钮为静态目验）；未登录 MV3 验证页面为公开帖只读渲染。真实账号写入：0。

---

## 第二轮补证结果（P0 逐项，2026-10-12）

评审意见：有条件通过探索阶段，不批准正式迁移；先做 P0 补证。以下为逐项执行与验证记录。环境标注沿用首轮口径：BROWSER-RO＝登录会话 CDP 试验（本轮为**隔离世界注入**，比首轮更接近真实内容脚本执行环境）；MV3＝隔离 Edge 149 加载扩展的运行时验证（未登录）。

### P0-2 路由机制：缺陷确认 → 重写 → 六场景复测通过

- **评审判断成立**：ISOLATED 世界对 `history.pushState/replaceState` 的包装无法观测主世界 SPA 调用（两个世界各自持有独立的 JS 包装对象）。首轮 PoC 的路由只在直达加载时有效——这是实质性缺陷，评审发现正确。
- **修复**：完全移除 history 包装。新机制 = popstate + hashchange + Navigation API（`window.navigation.addEventListener("navigate")`，隔离世界可用性做了运行时守卫）+ **500ms 有界 pathname 轮询兜底**（2Hz 常数开销，不触碰 X 内部运行时）。状态 id 变更即重建，非详情路由即拆除。
- **复测**（登录会话、隔离世界注入真实 X 会话）：
  - 时间线点击 → 详情（主世界 SPA 导航）：面板自动建立（sid 与点击帖一致）——跨世界路由观测生效；
  - 详情内切换到另一帖（引用/回复链接）：面板重建为新帖；
  - `history.back()` / `history.forward()`：面板正确消失/重建；
  - 回到 /home：面板拆除、X 右栏与原生列布局还原（cellW 598 恢复）；
  - 重复进入同一帖：paneCount 恒为 1（无双挂载）；
  - 双重注入（模拟扩展重载）：安装守卫生效，无重复观察器。

### P0-2 关闭语义：历史感知关闭

- `sessionNavigated` 标记本文档是否发生过 X 站内路由变更：发生过 → 关闭= `history.back()`；直达/外部进入 → 关闭=仅拆除增强层，**不导航**。
- 实测：直达详情页点 ✕ → 面板消失、URL 不变（未跳出 X）；SPA 进入后点 ✕ → 回到来源视图（/home）。

### P0-3 焦点帖功能补齐

- 焦点定位：一律按 URL status id 匹配（登录态=cell 内时间戳 permalink；未登录=会话容器内规范 permalink 且取最后一个匹配），**任何路径都不再用"第一个 article"**。回复详情页实测面板显示回复自身（回复 2 · 喜欢 142），非祖先根帖。
- 数字解析：`parseCount` 支持 K/M/千分位，缺失显示「未知」绝不造 0。真实函数经 CDP 测试钩子单测 **9/9 通过**（"1.2K"→1200、"3M"→3e6、""→null 等）。
- 引用内容：全文提取（不再截断 160 字符），含引用作者与引用图片。
- 图片 URL：保留原始查询参数（不再 strip `?` 后缀）。
- 富媒体焦点帖（视频/GIF/投票/卡片）：**原生焦点格保持可见**，由右栏原生区域完整承载，面板显示说明条——左栏不再假装承接它拿不到的内容。实测视频帖（richNote 出现，原生格未隐藏）。
- 互动镜像：面板操作条（回复/转推/点赞/收藏/复制链接）镜像原生状态（testid like/unlike 等翻转检测，likeActive=false 实测）并**委托给原生按钮**（isTrusted=false 的第 3 类自动化，任务书 8.3 口径）；本轮验证全程未执行任何写入，写入 NOT_TESTED。

### P0-1 双栏 UI 与主题

- 评审指出的参照容器错位已修：左栏 `52vw`，评论格 `margin-left:52vw; width:48vw`——同一参照系；阅读态隐藏 X 右侧推荐栏（`sidebarColumn` display:none）与左侧主导航。
- 登录态实测：paneW **560px / vw 1077（=52.0%）**，cellW 517（≈48%+边框），railHidden=true，focalHidden=true，paneCount=1。截图 `evidence/r2-loggedin-layout.png`。
- 主题：面板读取 X 当前主题计算色板（浅色实测 #ffffff 生效）；暗色路径同一代码，**未实测**（不改动用户账号主题设置），标 NOT_MEASURED。
- React 重渲染抹掉焦点格标记的问题：路由轮询内 re-tag 自愈（T2 不一致现象已解释并修复）。
- 同环境截图对照：`evidence/r2-loggedin-layout.png`（PoC，登录态）vs `evidence/r2-loggedin-original-peek.png`（原版，同会话同视口）vs `docs/peek-preview.png`（官方基线）。

### 问题 A（能否保留不跳转的独立浮层）：**不能——体验不等价，实锤**

- 证据：登录会话从时间线 SPA 进入详情后，**其他时间线帖子不在 DOM 中**（`otherTimelinePostStillInDom: false`）——X 原生导航是页面级替换，时间线被卸载，不是"背景保留 + 浮层覆盖"。
- 对照：同一点击，原版 Peek 停留在 `/home`（浮层覆盖，`r2-loggedin-original-peek.png`）；R1 路线 URL 变为 `/status/...`。
- 结论：R1 的"关闭返回"恢复是像素级的，但交互模型与原版"不跳走"不等价。按评审要求**明确判定不等价**，不降低验收标准。架构取舍移交用户（见 architecture-decision.md 修订版）。

### P1 性能与接口调用对照（小样本原始数据；非 p95；同会话同视口）

| 条件 | 点击→首段正文 | 点击→回复可读 | 窗口内 GraphQL 请求数 | 其中扩展自构造 | 关闭残留 |
| --- | --- | --- | --- | --- | --- |
| 原生 X 详情（SPA） | 856ms | 856ms | 12 | 0 | — |
| 原版 Peek 0.8.10（CDP harness 注入） | 98ms（覆盖层+DOM 回退首显） | 覆盖层标记 98ms（回复经 GraphQL 后到） | 1 | **1**（READ_THREAD） | 无（Esc 后无覆盖层节点，停留 /home） |
| PoC v2（隔离世界注入） | 390ms（面板） | 1835ms（原生评论格） | 12 | **0** | 无（面板移除，返回 /home） |

- 说明：GraphQL 计数为窗口期内 `/i/api/graphql/` 请求总数（CDP Network 元数据，未存头/体）；PoC 条件的 12 个全部来自 X 自己的 SPA 详情加载，PoC 自身零内部请求。原版首显 98ms 依赖点击瞬间 DOM 快照回退，完整数据仍等 GraphQL。
- 内存：条件间 heap 差值受执行顺序污染，不可归因，**NOT_MEASURED**（记录：native 125MB / peek 159MB / poc 173MB 原始值，仅小样本顺序执行快照）。
- 各条件样本数 1（视口内样本池限制）；第三轮时间线抖动同首轮，如实记录。

### P0-4 登录态 MV3 集成：仍为用户操作项（材料已备齐）

- Chrome 155 已移除 `--load-extension`；ego-browser CDP `Extensions.loadUnpacked` 返回 Method not available（已留档尝试）。
- 已产出 `exploration-poc/MV3-LOGIN-VERIFY.md`：用户在自有 Chrome **隔离 profile** 中自行登录并加载 PoC 的 10 项检查单（不迁移 Cookie、不触碰凭据、不装进日常配置）。未完成前，登录态 MV3 验证状态保持 **NOT_MEASURED**。

__zcode_status=$?
if [ "$__zcode_status" -eq 0 ]; then pwd -P > '/var/folders/9x/r55tny7s47b2wbnkfy0msfb80000gn/T/zcode-d00b5063-5a23-4b2b-84d2-bb9cf0051425-cwd'; fi
exit "$__zcode_status"