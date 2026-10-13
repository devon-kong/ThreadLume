# M2-A 实施报告 — 双栏阅读体验第一包

分支：`feat/peek-native-m2a-reading`（基于 M1-R `dfb94f7`）
配套文档：`m2-a-design-decision.md`（B0/B1 方案对照）、`m2-a-performance-report.md`（B5/B4）。

## 修改清单

| 文件 | 变更 |
|---|---|
| `native-extension/src/comments-first.js` | 新增：评论优先定位模块（方案 C）。门控（rich 标记）、有界等待（6s）、滚动时权威媒体复查、一次滚动、迟到媒体回看（15s）、用户输入/已滚动/路由存活守卫、决策审计（diagnostics + 测试钩子 DOM 镜像） |
| `native-extension/src/reader-lifecycle.js` | 接线：首显后 `armCommentsFirst(focalId, data.rich, liveness)`；`removeReader` 拆除 arming |
| `native-extension/src/diagnostics.js` | `commentsFirst` 记录位（路由变更时重置） |
| `native-extension/src/main.js` | 测试钩子导出 `armCommentsFirst / cancelCommentsFirst / commentsFirstArmed` |
| `tests/native/native-comments-first.test.mjs` | 新增 12 项离线测试（执行真实构建产物） |
| `tests/native/native-env.mjs` | harness：`innerHeight` 模拟（viewportHeight 可配） |
| `exploration-poc/m1/harness/perf-run-m2a.mjs` | M2-A 性能 harness（同 M1-D 方法副本 + cf 决策字段） |
| `docs/m2-a/*` | 设计决策、性能报告 |

## 行为语义（用户可见变化）

- **简单帖**（文本/图片/引用，焦点格 ≥60% 视口高）：阅读器打开后，右栏自动从评论开始——一次有界滚动把第一条回复带到顶部。评论可见份额实测 **25% → 93%**（1440×900，纯文本帖）。原生焦点格不移动、不隐藏、不变异；一次上滚或任意"定位"按钮回到互动区。
- **短焦点帖**（<60% 视口高）：保持原生布局（重复感轻微，不滚动）。
- **富媒体帖**（视频/投票/网站卡片/X Article）：与 M1 行为完全一致（原生焦点格在视野内）。
- **迟到媒体防御**（live 验证发现的缺陷修复）：全量加载时视频帖先以海报渲染、播放器迟水合——滚动时每 tick 权威复查（`rich-native-kept-late`）；滚动应用后 15s 内媒体迟水合且用户未动 → 一次回滚把原生格带回视野（`late-media-return`）。
- **用户优先不变量**：武装窗口内任何 wheel/keydown/pointerdown/touchmove 取消；用户已滚动（scrollY > 40px）绝不竞争；路由离开即拆除。无持续滚动、无与虚拟列表争夺。

## 测试

- Native：**105 通过 / 0 失败**（93 继承 + 12 新增），全部执行真实构建产物。新增覆盖：一次滚动与只滚一次、四种富媒体门控、四种用户输入取消、已滚动不竞争、短焦点自适应、路由中途离开、有界放弃、拆除时序、buildReader 全链路（视频帖不滚/文本帖滚动）、迟到媒体三态（滚动前取消/滚动后回看/用户已动不回看）。
- Legacy 119 / Exploration 75：全绿。
- CI：`feat/peek-native-m2a-reading` 三 job 全绿（run 38332871112，Draft PR #2）。

## Live 验证（真实 X，L3 等效注入）

| 场景 | 结果 |
|---|---|
| 文本帖打开 | cf applied（target 538），replyTop 53，评论可见 93%，焦点格保留在 DOM |
| 视频帖打开 | rich-native-kept-late（迟水合播放器被滚动时复查捕获），焦点格 95% 可见 |
| 图片帖 @1280 | cf applied，左栏 52%（666px）完整渲染图片，右栏评论贴顶 |
| 图片帖 @1024（中途缩放） | 面板保持，X 自行重排，无布局破坏 |

## 诚实边界

- T2 为 DOM 存在口径，机制上不变；"评论更早可读"以可见份额口径证明（25%→93%）。
- 简单帖的互动路径 +1 次上滚（或定位按钮）——方案 C 的明确代价，换取评论首屏。
- 简单帖判定阈值（60% 焦点格 / 50% 回复份额 / 53px 吸顶高度）为当前 X 布局常量，X 改版可能需要重新校准；全部为有界行为，失效模式是"多滚或少滚一次"，不会破坏布局。
- X Article 迟水合不在回看检查内（左栏已完整渲染文章文本；与 syncRichNote 既有口径一致）。
- 性能两轮为不同会话，判定基于容差与退化模式而非绝对值（详见性能报告）。
