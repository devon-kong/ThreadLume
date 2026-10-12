# R4 Gate 总报告：性能与体验等价性准入

日期：2026-10-12。分支 `exp/r1-performance-experience-gate`（自 `exp/r1-native-function-validation-r3-r`
@ `801842d` 切出）。正式 `extension/` 全程未动（`git diff 801842d -- extension/ tests/ src/` 仅
package.json 无变化；本轮对 tests/ 的改动均为 r3-r 实验套件内的测试文件）。

## 0. 一页结论

**CONDITIONAL GO。** G0 三缺口全部修复（实验离线测试 75 项 + 119 项原版测试全绿）；
统一直观点击口径的五轮基准显示 **R1 原帖首显 78-84ms，比原版正文首显（584-1333ms）
快 7-16 倍**——此前"原版 98ms vs R1 896ms"的口径差异已查明并反转（98ms 是浮层骨架，
非内容）；关闭返回中位差 +45~94ms（边界，两样本越线 3-14ms）；**评论首读慢
0.7-1.3s（架构性：R1=裸 X 的原生节奏，不可在禁令内优化）**；点击对齐网络普查三场景
PASS（零扩展引入 API 请求）；体验场景 E3/E5/E7/E9 全对、无白屏闪烁。**两个未闭环项：
真实 MV3 验证待用户执行（L4/L5 NOT_TESTED）、T2 取舍待用户裁决**——故为 CONDITIONAL GO
而非 GO；无 NO-GO 触发条件成立。

## 1. G0：三个验收缺口的修复（全部完成）

| 缺口 | 修复 | 验证 |
|---|---|---|
| G0-A 关闭的历史导航 | 会话级布尔 → 真实历史判定：Navigation API `entries()`（跨域条目浏览器自动脱敏）为主，文档内导航轨迹为回退；六场景（含"外部→A→引用B→后退→关闭不得跳站外"）行为矩阵全对 | 16 项离线测试（`poc-g0.test.mjs`）+ 实测六场景 |
| G0-B 路由检测延迟 | 事件驱动：navigate 事件（isolated world 实测可用）+ 点击级联 + title 观察者；轮询降为兜底 | 点击→识别中位 **1ms**、最慢 2ms（12+8 窗口实测） |
| G0-C 网络判定器 | 逐操作计数（V2 逐轮上限）、方法集（V3）、分场景（各场景独立判定）、跨场景佐证（F2）、媒体说明项（F1）；四个规定反例全过 | 10 项判定器测试；对 R3-R 旧证据回溯发现 spa FAIL（旧工具漏检的真实差异），促成点击对齐普查 |

明细：`r4-correctness-fixes.md`。

## 2. G1/G2：性能基准与两轮优化（详见 r4-performance-comparison.md）

- 方法：三条件（原版 0.8.10 CDP 注入 / R1 PoC v5 / 裸 X）同会话交错、统一"真实可信
  点击"起点、页面内 25ms 录制器、4 类样本 × 3 轮 × 3 条件 = 36 窗口 × 5 轮。
- 最终判定：T1 全 PASS（大幅反转）；T4 两 PASS 两边缘 FAIL（+83/+94 vs 容差 80）；
  T2 三 FAIL（+684/+1000/+1268）+ 原版侧 long 样本 MISSING。
- G2 两轮：①展开解耦（长帖 1234→84ms）②信息流 DOM 复用首显 + 详情水合原地刷新 +
  焦点格匹配收紧 + Esc 捕获修复。按"两轮上限"停止，第三轮对 T2 无合法手段。
- 完整性保障：点击后验证+重试、锚点视口位置恢复判据、零跳过零错误、INCONCLUSIVE
  自动降级逻辑（本 final 轮未触发，前轮 highReply/T2 曾触发并被记录）。

## 3. G3：体验等价性（详见 r4-experience-comparison.md）

结构不等价（浮层 vs 原生导航，既定差异）；感知基本达标：无白屏/闪烁/布局跳变/重复
面板，五连开合稳定，Esc 可靠，评论首读 +0.7-1.3s 与关闭后 0.1-0.2s 信息流重挂为仅存
的可感差异（均单次、次秒级）。截图证据 `evidence/experience/`。

## 4. G4：功能完整性（详见 r4-feature-parity.md）

83 项行不减：FULL 80 / PARTIAL 7（A1、A15、B14、B16、C2、D1、D6）/ 新增 N1-N4 四项
FULL。**与原版不等价的六项清单**全部明示为用户决策点，无未批准的静默降级。

## 5. G5：真实 MV3 验证

本环境无法加载真实 MV3 扩展（Chrome 152 ego 会话不开放 `Extensions.loadUnpacked`；
受管 Chrome 已移除 `--load-extension`）。**L4/L5 NOT_TESTED**，不伪造通过。人工检查单
已生成：`MV3-MANUAL-CHECKLIST-R4.md`（15 项，含 v5 新语义：关闭安全判定、外部链场景、
连续快速浏览；唯一真实写入项由用户决定是否执行）。用户回填后本 Gate 可升级判定。

## 6. G6：独立 Reviewer

独立 Reviewer（全新上下文，只读）已对以下内容直接复核并复跑（记录见 §7）：

- `mv3-poc/content.js` v5 全文（关闭判定/轨迹/事件驱动路由/解耦升级/Esc 捕获）；
- 73 项离线测试复跑（`npm run test:r3-r`）与 119 项原版测试（`npm test`）；
- 五轮基准的原始 JSON 抽查 + `perf-compare.mjs` 复跑（判定表与报告数字一致）；
- 12 窗口点击对齐普查的独立复算（`network-recompute.mjs` → 三场景 PASS）；
- 判定器反例复测（TweetDetail 1→2 必 FAIL、方法不一致必 FAIL、佐证降级正确）；
- 体验日志与截图抽查；
- `git diff 801842d` 边界核查（正式 extension/ 未动）。

## 7. Reviewer 复核结论（原文）

独立 Reviewer（全新上下文、只读、未修改任何文件）完成了 8 项独立验证（content.js v5 逐行审读、73+119 测试复跑、12 窗口网络普查 Python 独立重数 + 判定器复跑、全部 36 个性能窗口的程序化一致性核验、判定器反例、体验日志/截图核对、`git diff 801842d` 边界核查、四报告与检查单核对）——全部 PASS，无 P0/P1 缺陷。其结论原文：

> 独立 Reviewer（全新上下文、只读）复核结论：本报告的全部关键数字均可由我亲手复现——73 项实验测试与 119 项原版测试经 `new Function` 执行真实 `content.js` 全绿；36 个性能窗口逐字段一致且无物理矛盾，`perf-compare` 复跑判定表与报告逐格相同；12 窗口网络普查经 Python 独立重数与判定器复跑确认三场景 PASS、R1 独有 API 操作为零、API 总数差 −4；关闭语义（含"外部→A→引用B→后退→关闭不跳站外"）经代码推演与 11 项专项测试双重确认；`content.js` 对 fetch/XHR/Webpack/GraphQL 的 grep 为零命中；`git diff 801842d` 证实正式 `extension/` 零改动。T2 三项与 T4 两项按容差字面如实记 FAIL，未发现美化；MV3 L4/L5 如实 NOT_TESTED。发现 4 项 P2、4 项 P3 缺陷（最主要者为 G2 双升级并发时缺"更完整文本"守卫的潜在文本回退，及网络判定器 F2 行的 undefined 输出瑕疵），均不影响本轮门槛结论。同意 CONDITIONAL GO：GO 前置条件（用户执行 MV3 人工检查单、裁决 T2 取舍）真实未满足；同时建议在正式实施前处理 P2-1 并修正 P2-3/P2-4 两处文档/工具瑕疵。

Reviewer 另对一处措辞提出异议（已采纳）："R1 关闭速度约为原生后退 2 倍"主要由 harness 注入的 +300ms 常数产物，不应推导倍数——perf 报告脚注已更正。

### Reviewer 发现的缺陷与处置

| # | 严重度 | 缺陷 | 处置 | 状态 |
|---|---|---|---|---|
| P2-1 | P2 | G2 两个解耦升级 last-writer-wins：水合刷新可能把已展开全文覆盖回折叠文本 | 文本单调性守卫：show-more 升级写全文后置 `data-peek-full-text=1`，`updatePaneInPlace` 见此标记则跳过文本替换（计数/时间/照片仍刷新）；专项回归测试（折叠刷新不回退全文） | ✅ 已修复 |
| P2-2 | P2 | Esc 处理未排除 X 自有浮层（灯箱等），会吞掉 X 的关闭 | Esc 守卫新增 X 自有模态检测（lightbox/sheetDialog/HoverCard/aria-modal dialog）——浮层打开时 Esc 归 X；专项回归测试 | ✅ 已修复 |
| P2-3 | P2 | `renderMarkdown` 对 F2 旗标打印 undefined 字段 | F2 行改印"本场景原生/R1"计数 | ✅ 已修复 |
| P2-4 | P2 | r4-correctness-fixes.md 测试数公式算术不成立（漏列 G0-B 四项） | 公式更正（总数 16 不变） | ✅ 已修复 |
| P3-1 | P3 | 早期轮次数字无法从当前证据独立复验 | perf 报告 §5 增补证据层级说明（final 轮全部可独立复算） | ✅ 已注明 |
| P3-2 | P3 | 体验截图显示品牌 v4 | 经验报告注明（该次改动仅品牌一行，功能性证据不受影响） | ✅ 已注明 |
| P3-3 | P3 | 体验表 orig E5/E7 措辞比原始 skip 记录乐观 | 表格改为与原始日志一致的 skip 表述 | ✅ 已更正 |
| P3-4 | P3 | Esc 捕获优先性依赖"X 快捷键监听在 document 级"的经验事实未单列 | r4-correctness-fixes.md 增补附注留档；MV3 检查单第 6/7 项可在验收时发现变化 | ✅ 已留档 |

处置后回归：`npm run test:r3-r` **75/75**（+2 项 Reviewer 回归）、`npm test` **119/119** 全绿。

## 8. 交付物清单（exploration-poc/r4/）

| 文件/目录 | 内容 |
|---|---|
| `r4-gate-report.md` | 本报告 |
| `r4-performance-comparison.md` | 方法、五轮结果、判定、G2 优化、网络面 |
| `r4-experience-comparison.md` | 十场景对照、结构/感知两维度判定 |
| `r4-correctness-fixes.md` | G0 三缺口明细与回归 |
| `r4-feature-parity.md` | 83 项矩阵 R4 增量 + 不等价清单 |
| `r4-architecture-decision.md` | CONDITIONAL GO 理由、决策点、NO-GO 回退路径 |
| `MV3-MANUAL-CHECKLIST-R4.md` | 用户人工验收检查单 |
| `evidence/perf/`（36 JSON + verdict） | 最终轮脱敏性能记录 |
| `evidence/perf-comparison.md` | 生成器输出（原始值/中位数/判定表） |
| `evidence/network/`（12 JSON）+ `network-judgment.md` | 点击对齐普查与判定输出 |
| `evidence/experience/`（日志 + 10 截图） | 体验场景证据 |
| `harness/`（perf-run/perf-compare/network-census-r4/experience-run/probe*） | 可复跑测试工具 |

（本轮对 `exploration-poc/mv3-poc/`、`r3-r/` 测试与工具的修改见 git 历史 9b7dbcd…5e6e8e9。）

## 9. 对任务书九个问题的直接回答

1. **R1 是否已达到原版的打开速度？** 超过。统一直观点击口径：R1 焦点内容首显
   78-84ms，原版正文首显 584-1333ms（此前"原版 98ms"实为骨架出现时间）。
2. **原帖、评论、关闭返回分别快慢多少？** 原帖：R1 快 500-1253ms（7-16 倍）；评论首读：
   R1 慢 684-1268ms（=裸 X 原生节奏）；关闭返回：R1 慢中位 45-94ms（两样本越线
   3-14ms，边界；关闭后信息流恢复行为与裸 X 完全一致）。
3. **导航式阅读能否基本无感？** 基本能。打开无白屏/骨架（78ms 完整内容）、无重复
   面板、Esc 可靠、五连循环稳定；可感差异仅两处且均次秒级：关闭后 0.1-0.2s 信息流
   重挂（=裸 X 行为）与评论首读差距（见 2）。
4. **哪些功能仍与原版不等价？** 六项（r4-feature-parity.md）：交互模型（导航替代浮层）、
   评论首读速度、评论排序降级、视频 HD-first/预热/单视频协调策略被原生替代、回复后
   展示位置遵循原生、翻译开关位于 X 设置。
5. **是否保持零扩展主动私有接口请求？** 是。点击对齐 12 窗口严格判定器三场景 PASS：
   R1 独有 API 操作=无，API 总数差 −4，全部差异为说明项（面板图片缓存、X 自身周期
   请求），可独立复算。
6. **真实 MV3 是否验证通过？** 未验证（NOT_TESTED）——环境无法加载真实扩展；检查单
   已备好，等待用户执行。
7. **是否有充分证据开始正式实施？** 技术方向证据充分（G0-G4 + 网络面全过）；但按
   本任务书的 GO 标准，MV3 人工验证未完成前不启动正式实施（CONDITIONAL GO）。
8. **若不通过，继续优化 R1 还是回原版浮层？** 本轮判定未落入 NO-GO。唯若用户否决
   T2 取舍，则按性能 NO-GO 回**原版浮层架构**（保留其速度优势），同时把私有 API
   依赖收敛到最小重放集——路径已写入 r4-architecture-decision.md §5。
9. **若通过，第一包做了什么、保留了什么？** 第一包尚未启动（条件未满足）。启动后
   上限范围：数据承载适配层、路由与生命周期模块、新旧实现切换开关、最小构建与
   回归测试、明确回退路径；`page-bridge.js`、原版 UI、原版测试与全部既有功能原样保留。
