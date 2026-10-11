# Peek 架构决策（第一轮探索结论）

日期：2026-10-12。依据：exploration-report.md + feature-matrix.md + exploration-poc/。

## 1. 推荐

**路线 R1：原生详情页承载 + Peek 增强（"原生详情即阅读器"）**，保留单一 MV3 扩展：

- 用户在时间线/通知页点击帖子 → X 原生 SPA 导航到详情页（不拦截）。
- Peek 在 `/status/` 页注入增强层：
  - **左栏（Peek 自绘，52%，独立滚动）**：从原生详情 DOM 提取的焦点帖（作者/正文/媒体/引用/计数），承担原版"左侧原帖"阅读体验与后续翻译、AI 草稿等增强；
  - **右列（原生评论流，48%）**：原生分页、祖先链、子回复展开、原生互动按钮，全部归 X 自己管理；
  - **关闭/Esc = `history.back()`**：信息流位置由原生 SPA 恢复（实测像素级）。
- **移除 page-bridge.js 全链**（MAIN world 注入、fetch/XHR 包装、Webpack 探测、凭据捕获、GraphQL 读写）。读路径 100% DOM；写路径 100% 原生控件（用户本人点击）。
- 翻译：TranslationScheduler（已合成验证）为骨架，后端按用户决策接入（原生"显示翻译"引导 / DBC / 暂缓）。

推荐理由（对照任务书九.3）：

1. 用户四项核心体验里三项（阅读位置连续、祖先上下文、讨论完整性）实测原生即达且优于原版坐标恢复法；
2. 内部接口/认证桥接/运行时探测依赖降到**零**（读路径），恰为本次探索的首要目标；
3. 维护面收缩：删除自研 HLS 播放器、GraphQL 解析器、写操作状态机三大高风险维护块；
4. MV3 边界最干净：零 permissions 已验证可运行，商店审查面最小。

## 2. 否决

| 路线 | 结论 | 依据 |
| --- | --- | --- |
| R2 同源 iframe 内嵌原生详情 | **当前阻断，否决** | 详情文档 `X-Frame-Options: DENY`（实测响应头 + iframe 14s 不初始化）；不改头/不代理属硬约束，无合规解 |
| R3 纯 CSS 双栏（原生格 sticky 左栏） | **否决为承载形态** | X 虚拟化器 ~5000px 后回收焦点格（实测 translateY=4519 漂移），长阅读必失效；且两栏共享虚拟列表无法真独立滚动 |
| R4 保留原版"浮层+GraphQL 桥"为主架构 | **本轮不变更，但不再扩展** | 与"减少内部接口依赖"目标相悖；作为已上线稳定形态保留至 R1 完成有限范围实现并验收后再切换 |

## 3. 待定（下一轮补证后决策）

1. **本地评论排序**（相关/最新/最多喜欢）：R1 无原生对应。选项：a) 放弃（接受体验差异）；b) Peek 对已加载评论 DOM 重排（有虚拟化冲突风险，需专门验证）。倾向 a，待用户定。
2. **翻译后端**：原生"显示翻译"引导（零依赖、非自动）vs DBC（自动+默认译文，协议待提供）vs X 端点经调度器（自动但保留内部端点依赖）。接口已就绪，后端选择不影响架构。
3. **登录态 MV3 集成验收通道**：Chrome 155 已移除 `--load-extension`。选项：a) 用户日常 Chrome 隔离 profile 手动加载（真人协助一次）；b) Edge/Chromium 测试态；c) Chrome for Testing 下载。需用户选。
4. **X Article**：补样本验证原生详情渲染后，决定左栏是否需要 Article 专项增强。

## 4. 下一阶段（正式改造）文件范围与验收

范围（R1 有限实现，不动 AGENTS.md 旧断言直至切换完成）：

0. **基线缺陷必须随迁移修复**（Reviewer 确认的 mv3-poc/content.js 已知缺口，不得静默带入产品）：
   - 回复详情页焦点提取：焦点格必须按 URL status id 定位（PoC 已修），不得用"第一个 article"（那是祖先根帖）；
   - Esc 守卫：需让位于 X 原生 Esc 消费场景（灯箱/对话框/输入框），检查 defaultPrevented（PoC 已修）；
   - history 包装幂等：扩展 reload 后不得双重包装 pushState/replaceState（PoC 已加守卫；正式实现需覆盖 reload 后旧闭包清理语义）。
1. `extension/manifest.json`：移除 MAIN world page-bridge 注入；保留 content_scripts（ISOLATED）。
2. `extension/page-bridge.js`：删除（连同其测试）。
3. `extension/content.js`：
   - 移除 requestPage/GraphQL 数据路径；新增详情页增强层（mv3-poc/content.js 为基线：路由监听、提取、左栏、Esc/关闭、清理）；
   - 移除自研视频播放器（hls.js 依赖与 vendor 同步移除）；
   - 保留/迁移：翻译调度器（接 exploration-poc/translation-provider/）、设置存储、主题变量。
4. `extension/core.js` / `content.css`：缩减为详情页增强所需部分。
5. `extension/popup/`：开关语义更新。
6. `scripts/build-extension.mjs`：移除 hls vendor 步骤。
7. `tests/`：删除 bridge/写操作专项断言；新增 DOM 提取（固定样本 HTML fixture）、路由清理、TranslationScheduler 测试。

验收（每项独立，不合并 PASS）：

- 离线：`npm test` 全绿（新口径）。
- 集成（登录态，隔离 profile 手动加载）：时间线点击→详情增强层出现；左栏/右列独立滚动；Esc 关闭→信息流位置一致；引用卡/祖先链/子回复/视频/图片/长文各一样本目验；翻译开关行为；关闭后无 Peek 残留节点。
- 真人写入验收（独立于开发）：原生按钮点赞/收藏/回复各一次，与 X 页面状态一致。
- 商店预检：权限清单、数据披露文案（本地 DOM 读取如实声明）、MIT 与第三方 notices 保留。

## 5. 平台与产品提示（不影响本轮架构选择）

- MIT 许可与 THIRD_PARTY_NOTICES 保留不变；"Peek"与 X 商标关系表述维持现状。
- 自动互动/自动回复不在本路线内；AI 草稿仅到"可编辑文本+人工发送"为止（接口护栏已固定）。
- "是否有人需要/愿意持续使用"未被本轮 PoC 证明，需小范围用户体验后再投入完整产品化。
