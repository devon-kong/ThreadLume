# R3-R 架构决策 Gate：独立 Reviewer 判定与处置

日期：2026-10-12。审查人：独立 Reviewer（全新上下文实例，只读审查，与执行方隔离）。审查方式：直接通读 PoC v4 源码（566 行逐行）、全部新增测试、12 窗口脱敏证据、新旧两份 83 项矩阵、MV3 验证文档；并**亲自复跑**全部可复现验证（测试套件、复算工具、12 份证据的独立 python 复算、分类器抽查、git diff 边界核查）。未依赖执行方总结。

## 1. Reviewer 逐 Gate 判定（原文摘录）

- **G1: PASS** — grep `fetch|XMLHttpRequest|WebSocket|sendBeacon|EventSource` 与 `graphql|queryId|authorization|csrf|webpack` 对 `exploration-poc/mv3-poc/` 均无匹配；manifest 零 permissions、无 background。唯一合成点击是"显示更多"显示展开（非 API 调用）。
- **G2: PASS** — 分类器 pathname 正则含 `-_`；REST 脱敏；12 份证据 requests 字段恒为 `{cat,op,method,rel}`、无 URL；**Reviewer 用 python 独立复算全部 12 文件：聚合与 summary 完全一致**；`node network-recompute.mjs` verdict：`r1OnlyApiOps:{}`、`apiTotalDelta:-5`。
- **G3: PASS** — removeReader `++gen` 即失效在途构建；恢复单次布防有界；ownedTimers 清册；单条自调度观察链。测试经 `new Function` 执行生产源码（非复写），19/19 race + 7/7 negative 通过。
- **G4: PASS** — C1/C2/C3 断言真实约束生产行为，17/17 提取测试通过。
- **G5: PASS（附一处统计表缺陷）** — python 逐行解析矩阵：83 行、FULL 76 / PARTIAL 7（集合与声明逐项一致）、NOT_TESTED 恰 10、全矩阵无 MV3 证据级；R3 误标（A13/A14）更正属实；未发现"以原生推定记实测 PASS"。
- **G6: PASS** — 五级层级表清晰；"L3 注入……不能证明扩展装载链路正确。两者不可互替"；L4/L5 如实 NOT_TESTED。
- **G7: PASS** — `npm run test:r3-r` 45/45；sites-worker 4/4；原版 `npm test` log 119/119、exit 0。
- **G8: PASS** — 六个脚本 grep 无凭据/写入/重放痕迹；census 页面操作仅只读导航与只读点击。
- **G9: PASS** — `git diff --stat 96065bd -- extension/ tests/ …` 仅 package.json（+test:r3-r、+jsdom devDependency）；`extension/` 与 `tests/` diff 为空。
- **G9.1: PASS** — innerText polyfill 仅作用于测试内新建的 jsdom window；R3 单元测试的行为变更注明与新口径一致。

## 2. Reviewer 发现的缺陷与执行方处置

| # | 严重度 | 缺陷（Reviewer 原述） | 处置 | 状态 |
|---|---|---|---|---|
| 1 | P1 | 新矩阵"实际验证"统计分层表内部失真：BROWSER_RO 实为 59（表称 55）、SRC 实为 12（表称 9，含 D7 归类错误并漏 F2/F3/F7/F10），四档相加 76≠83 | 统计表重算重写：59 + 12 + 2 + 10 = 83（明细逐段列出），主口径数字（83/FULL 76/PARTIAL 7/NOT_TESTED 10/MV3 0）复核无误保留 | ✅ 已修复 |
| 2 | P2 | manifest.json 实为 0.3.0，但三份文档声称 0.4.0 | manifest 升至 **0.4.0**（与 v4 代码一致），文档不再失实 | ✅ 已修复 |
| 3 | P2 | package.json 新增 jsdom devDependency 超出本轮授权字面 | fix-report E2 行显式追认（dev-only、产品不包含、离线测试必需、`extension/` 与正式套件零改动） | ✅ 已追认 |
| 4 | P2 | fallbackText 文本相等匹配存在碰撞边界（正文数字行恰与计数文本同值时被误删） | **算法升级**：fallbackText 重写为纯位置化遍历（结构性跳过计数/time/引用/卡片/播放器子树，无任何文本匹配），新增碰撞专项测试（正文 `42` vs 喜欢数 `42` 同值，正文行存活） | ✅ 已修复 |
| 5 | P2 | "URL 已改变"反例测试传固定 myGen=0，null 归因区分度弱 | 测试重写：URL 守卫与代际守卫分别断言（+ 正常代际的阳性对照）；测试钩子补 `currentGen()` 只读访问器 | ✅ 已修复 |
| 观察项 | — | x-page op 保留公开样帖路径（未如 rest 般脱敏） | Reviewer 判定不构成泄露（公开样帖且 meta 自我披露），维持现状并留档 | 📋 留档 |

处置后回归：`npm run test:r3-r` **46/46**（新增碰撞专项、守卫区分度 2 项）；Reviewer 确认的全部其他结论不受影响。

## 3. Reviewer 总体结论（原文）

> **CONDITIONAL GO。** 全部技术 Gate（G1-G4、G6-G9、G9.1）以我亲跑的命令与逐行读码证实：PoC 零私有 API 调用、网络证据可独立复算且 R1 侧零新增 API 请求、竞态修复经真实源码离线套件验证、提取修复有真实约束断言、正式产品未动。阻碍无条件 GO 的只有两处文档失真（P1 统计表、P2 版本号）——已在本轮处置修复。用户决策点确认：A1 交互模型、C2 排序（降级或自绘进范围）、B14/B16 视频策略差异、C15 回复位置语义、D1/D6 翻译预期保持开放未自动通过；L4/L5 真实扩展验收（13 项检查单，第 11 项唯一写入）仍 NOT_TESTED，须用户亲手执行。

（注：结论引文中 "45/45" 为 Reviewer 复核时点数字，处置后为 46/46；其余原样保留。）

## 4. 最终准入结论

**CONDITIONAL GO**（执行方与独立 Reviewer 一致）。

- **工程技术条件满足**：G1-G9 全 PASS，无 BLOCKED，无未解决的 P0/P1 缺陷；P1/P2 缺陷已全部处置并回归。
- **未完成验证（明示，不构成技术阻断）**：L4/L5 真实 MV3 扩展验收（`exploration-poc/MV3-LOGIN-VERIFY.md` 13 项，第 11 项为唯一真实写入，由用户决定是否执行）；写入面 10 项 HUMAN_WRITE 全部 NOT_TESTED。
- **用户产品决策点（不因技术 GO 自动通过，正式迁移前须单独确认）**：
  1. A1：接受"原生 SPA 导航替代不跳走浮层"的交互模型差异；
  2. C2：接受评论排序降级，或将"自绘已加载评论排序视图"列入工程范围；
  3. B14/B16：知悉原版视频 HD-first/预热/单视频协调策略不被 R1 承载（原生策略替代）；
  4. C15：知悉回复成功后展示位置遵循原生行为（原版"本地置顶"语义差异）；
  5. D1/D6：知悉自动翻译"默认开"依赖 X 账号语言设置，开关位于 X 设置。
