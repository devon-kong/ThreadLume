# R3-R 修复报告：清单、逐项证据与 Gate 预审

分支 `exp/r1-native-function-validation-r3-r`，基线 `96065bd`（R3 gate 提交）。性质：**修复、补证与准入收敛**，非产品迁移。PoC v3 → v4（manifest 0.4.0）。执行日期 2026-10-12。

## 1. 修复清单与逐项证据

| 任务项 | 缺陷（R3 验收发现） | 修复 | 证据 |
|---|---|---|---|
| A1 分类器 | queryId 字符集缺 `-`/`_`，R3 RECORDED 中 5 个 GraphQL 操作被误标 REST；仅存总数；18:18 不可独立复算 | pathname 解析 + 全字符集 + 五类分类 + REST 路由脱敏；逐请求脱敏记录落盘 | r3-r-network-audit.md §1-2；census-classifier.test.mjs（含 R3 误判集回归） |
| A2 证据链 | — | 12 窗口脱敏 JSON（native/r1 × 3 场景 × 2 轮）+ `network-recompute.mjs` 复算工具（合成反例证明能 FAIL） | evidence/network/；census-recompute.test.mjs |
| A3 公平对照 | about:blank 被称"冷缓存" | 首次导航/重访/SPA 三场景明示口径（缓存从不清除，明示于报告）；两轮、条件交错、同帖点击（clickedPath 留档）；无 p95 | r3-r-network-audit.md §2 |
| B1 竞态 | removeReader 不失效旧构建任务 → 过期面板可能重新挂载 | 代际失效（gen/liveGen）+ 渲染前 URL 复核 + data-status-id 不变量守卫 + 迟到水合 isConnected 复核 | r3-r-race-tests.md §1-3；B4-1/3/5/9 离线证 |
| B2 超时恢复 | 固定次数等待后静默放弃，无恢复路径 | 单次布防的有界恢复（3 轮×3s，路由 tick 驱动），休眠后不复活；测试逼出的"恢复轮重新布防"缺陷一并修复 | B4-7；E3 超时休眠测试 |
| B3 资源释放 | 500ms setInterval 无异常保护；高亮/聚焦定时器无所有权；生命周期无界性 | 单条自调度异常安全观察链（500ms 活动/2s 闲置）；ownedTimers 全量清册；所有权表 | r3-r-race-tests.md §4；B4-8（幂等）/B4-9（无残留） |
| B4 竞态回归 | 无 | 10 场景确定性测试（jsdom 执行生产源码 + 单时钟假定时器）+ 7 项反例语义 | poc-race / poc-negative.test.mjs |
| C1 数字行 | fallbackText 删除全部纯数字行 | **位置化提取**：结构性跳过计数/time/引用/卡片/播放器子树，全程无文本相等匹配（正文 `42` 与计数 `42` 同值不碰撞——Reviewer 复核指出文本匹配残留此边界后升级） | r3-r-data-integrity.md §1；C1 四测试（含碰撞专项） |
| C2 媒体归属 | 引用图片归入主帖；Article 双重 union | photoUrlsIn 子树排除 + findQuoteNode 结构化（card.wrapper 排除）+ 封面/视频/卡片归属矩阵 | §2；9 场景 fixture 矩阵 |
| C3 Article 能力 | innerText ≠ 富文本未界定 | 能力表：标题/全文/图片序已提取；层级/链接/列表/引用**可**结构化（探针实测）但保留原生渲染；红线（不克隆/移动 React 节点）重申 | §3；C3 探针测试 |
| C4 测试真实性 | — | 全部提取测试逐字执行生产 content.js（零复写算法） | poc-env.mjs harness |
| D1 验证层级 | CDP 等效注入与真实 MV3 混算（R3 A13/A14 误标 MV3） | 五级验证层级表（SRC/OFFLINE/CDP/MV3/HUMAN_WRITE）；MV3=L4/L5 全部 NOT_TESTED；矩阵证据级更正 | MV3-LOGIN-VERIFY.md；r3-r-feature-matrix.md 修正 1/4 |
| D2 MV3 验收 | 检查单过时 | v4 更新：13 项（新增竞态专项第 13 项）；环境受限路径（NOT_TESTED + 人工清单）维持 | MV3-LOGIN-VERIFY.md |
| E1 路径 | run.sh/_prelude.js 硬编码 `/Users/devon/claude/peek-main` | 由脚本位置推导根目录并注入占位符（ego 运行时不继承 shell env，已在注释说明）；worktree 可用 | run.sh / _prelude.js；本轮实测即从本 checkout 运行 |
| E2 统一入口 | 无 | `npm run test:r3-r`（R3 单元 4 项 + r3-r 46 项，不依赖账号）；原版 `npm test` 未动；**追认：为离线 DOM 测试新增 devDependency `jsdom ^30.1.2`（仅测试使用，产品构建不含，`extension/` 与正式测试套件零改动）** | package.json；回归记录见 §3 |
| E3 反例 | 失败语义未测 | 7 项反例测试（缺失/删除/超时/URL 变/回收/半水合/垃圾计数） | poc-negative.test.mjs |

## 2. 实测回归记录

| 套件 | 结果 |
|---|---|
| `npm run test:r3-r`（R3 单元 4 + r3-r 46，含 Reviewer 复核后新增碰撞专项与守卫区分度测试） | **46/46 通过** |
| 原版 `npm test`（含 vite build + build:extension + 9 个测试文件） | **119/119 通过，0 退化** |
| 登录会话实测（CDP L3） | 12 窗口普查全部成功；r1 各窗口 `pane=true`（v4 PoC 实测可用：SPA 详情/重访/资料页 SPA 三路径） |

## 3. Gate 自评（提交独立 Reviewer 复核）

| Gate | 自评 | 证据位置 |
|---|---|---|
| G1 PoC 不自行调用 X 私有 GraphQL/REST | PASS | v4 源码 0 fetch/XHR/重放/凭据；census 12 窗口 R1 独有操作=无 |
| G2 请求分类正确、数据可独立复算 | PASS | 分类器修复 + 复算工具 + "能失败"反例；任何人可 `node network-recompute.mjs` 重导 |
| G3 异步构建与路由切换无已知过期挂载竞态 | PASS | 代际失效 + 10 场景竞态测试 + 2 项修复过程中新增缺陷的回归 |
| G4 Article/主帖/引用帖提取正确 | PASS | 9 场景媒体归属矩阵 + C1/C3 测试；`npm run test:r3-r` 可复现 |
| G5 功能矩阵口径准确 | PASS | 双维度重标：FULL 76/PARTIAL 7/BLOCKED 0；MV3 证据 0 项如实标注；与 R3 差异逐条解释 |
| G6 MV3 与 CDP 等效验证明确区分 | PASS | 五级层级表；A13/A14 误标更正；F9 维持 NOT_TESTED |
| G7 新增关键回归通过、原版不退化 | PASS | 46/46 + 119/119 |
| G8 无未授权写入、无凭据采集 | PASS | 本轮 0 真实写入；census 工具仅解析 pathname，记录最小化（测试断言无 URL/凭据字符串） |
| G9 正式 `extension/` 未被修改 | PASS | `git diff 96065bd -- extension/` 为空（见下） |

```
git diff --stat 96065bd HEAD -- extension/   # （预期为空，Reviewer 请复跑）
```

## 4. 八问直答（Reviewer 复核后生效）

1. **R3 遗留的实际代码缺陷是否全部解决？** 是——竞态（removeReader 失效缺失）、提取（数字行误删、媒体误归属）、普查工具（分类器）、证据链（不可复算）、路径硬编码、层级混计六类，全部修复并有回归测试。修复过程中另发现并修复 2 个新缺陷（恢复重布防、time 行当正文）。
2. **R1 自身是否仍保持零私有 API 主动调用？** 是（G1/G2 证据）。
3. **原生 X 与 R1 的网络请求是否可证明基本一致？** 抽样证明一致：12 窗口、graphql 逐操作严格相等、R1 独有操作为零；局限如实记录（n=12、单账号、两轮）。
4. **Article、引用帖和媒体提取是否可靠？** 文本/标题/图片序可靠（fixture 矩阵）；富文本语义保留原生渲染（能力表）；可靠性以 `npm run test:r3-r` 持续可证。
5. **异步与路由生命周期是否经过充分测试？** 10 场景 + 7 反例，确定性可复现；"充分"限于离线模型覆盖的形态（真实 X 的 React 虚拟化只能以 fixture 模拟，live 面以 R3 场景回归补充）。
6. **哪些原版功能仍然 PARTIAL 或 NOT_TESTED？** PARTIAL 7 项：A1（交互模型）、A15（工具行）、B14/B16（视频策略）、C2（排序）、D1/D6（翻译条件）；NOT_TESTED 10 项：A15、B7、B10、B12、B13、B16、B17、C15、E4、F9；写入面 10 项 HUMAN_WRITE 未执行。
7. **是否满足进入正式工程改造的技术条件？** 满足——**CONDITIONAL GO**（待独立 Reviewer 确认，见 r3-r-architecture-gate.md）。技术面无 BLOCKED；剩余为用户决策项与用户操作项（MV3 检查单）。
8. **若尚不满足，还剩哪些真正的阻断项？** 技术阻断：无。前置条件（非技术阻断）：① 用户亲手执行 MV3-LOGIN-VERIFY 13 项（L4/L5 唯一路径）；② 用户决策：A1 交互模型、C2 排序（降级或自绘进范围）、B14/B16 视频策略、C15 回复位置语义、D1/D6 翻译预期。

## 5. 交付物索引

```
exploration-poc/r3-r/
  r3-r-fix-report.md          本文件
  r3-r-network-audit.md       网络普查与独立复算
  r3-r-race-tests.md          竞态修复与 10+7 测试
  r3-r-data-integrity.md      提取正确性与 Article 能力表
  r3-r-feature-matrix.md      双维度 83 项矩阵
  r3-r-architecture-gate.md   独立 Reviewer 判定（复核后）
  network-recompute.mjs       复算工具（CLI 可运行）
  harness/census-run.mjs      实测载荷（run.sh 调用）
  evidence/network/*.json     12 窗口脱敏证据
  tests/                      46 项离线测试 + 共享 harness
exploration-poc/mv3-poc/      PoC v4（content.js/manifest）
exploration-poc/MV3-LOGIN-VERIFY.md  五级层级表 + 13 项检查单
```
