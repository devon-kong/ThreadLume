# M1-R 独立 Gate 审查记录

- Reviewer：独立 agent（与执行方隔离），全部结论基于第一手验证（自读代码、自跑测试、自调 CI 记录）
- 审查对象：`fix/peek-native-m1-r` @ `2513450`（基线 `76568a3`，4 个提交）
- 结论：**CONDITIONAL GO** — G1–G9 九项全部 PASS，无 P0，无 P1，2 个 P2（已整改）

## Reviewer 报告（原文）

> （以下为独立 Reviewer 输出原文，未经执行方改写）

**前置核实**：`git log` 确认分支 `fix/peek-native-m1-r` 头为 `25134509f5c38bc865e731874ebea2b98f9a927a`，其上恰有 4 个提交（15a075d / b87d889 / 95e9a92 / 2513450），基线 `76568a3`。`git diff --stat 76568a3..2513450` 共 12 个文件，范围与任务描述一致。工作区仅有一个未跟踪文件 `docs/m1-r/m1-r-ci.md`（见 G8 发现）。

### G1 真实 SPA 路由监听覆盖 — PASS

(a) `native-extension/src/route-observer.js:157` — `watchTitle()` 在 `if (NAV_API)` 块**之前**无条件调用；旧代码的 `else { watchTitle(); }` 已删除（diff 证实）。

(b) title 元素替换重绑：观察者同时挂 `document.head` childList（行 199）与当前 title 元素（行 208）。head childList 变化触发回调（行 188-197），回调第一步即 `bindTitleElement()`（行 192）；`bindTitleElement`（行 202-211）在 `t !== titleElement` 时对新元素重新 `observe(t, { childList, characterData, subtree })`。

(c) title 变化 → `armClickCascade()`（行 196）：0/60/150/350ms 四个定时器，重臂前先全部 clearTimeout（行 181），有界且不叠加。

(d) `checkRoute` 行 63 无条件 `syncTrailFromLocation(consumePendingTraverse())`；我另读了 `navigation-session.js:57-68`，该函数本身无任何 NAV_API 判断。事件不达的世界轨迹仍存活——测试 `A1 Navigation API 静默时监听器已注册但事件从不到达` 断言 trail 记录了 URL 且 idx 前进。

(e) `tests/native/native-route.test.mjs` 恰好 **12 个 test()**，与要求的 10 类场景逐一对应：时间链接+正文卡片（双分支）、键盘/程序化导航（`programmaticNavigate` 无点击无 popstate）、X 内部 pushState 无 popstate、Navigation API 存在不派发（`navApi:"silent"`，断言 `navigateListenerCount()==1`）、前进/后退、快速 A→B→C、DOM 延迟水合、title 元素替换、连续导航不重复注册。**未发现遗漏场景**；另加测了"title 不变的 2000ms 有界兜底"（诚实上界）。备注：键盘导航以"URL+title 变化、无点击无 popstate"模拟——这是键盘路径的全部可观察信号，代码无独立键盘分支，故不构成缺口。

### G2 列表锚点不被错误覆盖 — PASS

(a) `anchor-restore.js:82`：`if (statusIdFromPath()) return preOpen ? { ...preOpen } : null;` 在 cell 查找**之前**返回——既不覆盖、也不新建。
(b) 行 86 `preOpen = { statusId, top, source }`；默认值 `"route-check"`（行 79）。
(c) `onReturnToList` 行 120 `const anchor = { ...preOpen }` 快照武装，行 137/145/156 均用快照。
(d) 四种终态消费：`endRestore`（行 154-161）在 adjusted / within-threshold（行 145）、window-expired（行 129）、user-input（行 123）置 `preOpen = null`（带身份比对）；superseded 取消保留锚点。
(e) 三调用点 source 皆正确：route-observer.js:143 `"click-precommit"`、:170 `"navigate-precommit"`、:82 `"route-check"`（后者因 URL 已提交必然被拒，仅保留取消语义——代码注释如实说明）。
(f) ownership 测试 7 项覆盖：detail 上下文直调拒绝保留列表锚点、/search 中转 B 详情位置不入库（含 top:99 诱饵断言）、前进进详情无锚点零滚动、adjusted 终态后键盘重开零滚动、三种其余终态消费、source 标记。注意："detail→detail 保留列表锚点"的端到端场景在既有 `native-anchor.test.mjs:194` 而非 ownership 文件——覆盖存在，仅文件归属与任务描述不同。

运行验证：`npm run build:native` 后执行 `node docs/m1-r/evidence/anchor-overwrite-repro.mjs`，输出与结论一致：旧语义会存入 `{statusId:…2, top: 99}` 并在返回 /search 时 `scrollBy(0, 221)`；修复后 `capture result: null → refused`，`scrollY … still 0 — native behavior untouched`。

### G3 信息流恢复无新回归 — PASS

`npm run test:native` 实测输出：`tests 92 / pass 92 / fail 0`。既有 12 项 B3 测试全部在内：一次性有界校正、用户滚动/按键触摸取消、无 cell 放弃、阈值内不动、只调一次、重开重捕获、detail→detail。各文件 test 数 3+7+12+19+14+9+16+12=92，账目吻合。

### G4 首显性能不回退 — PASS（独立判断）

- 首显新增同步工作：`startRouteObservation` 多一次 MutationObserver 实例化 + 一次 `querySelector("head > title")` + 两次 observe 注册。无布局读取，亚毫秒级。
- title 观察回调每次触发做：1 次 head 内 querySelector（仅元素换新时才重 observe）+ 1 个 queueMicrotask → `checkRoute`（稳态为一次 pathname 正则 + 比较）+ `armClickCascade`（4 clearTimeout/4 setTimeout）。阅读态额外走 `applyTheme()`（幂等）与 `syncRichNote()`（有 rich-note 即早退）。全部有界、幂等、无布局抖动。级联定时器最多 4 个存活，且 click 路径在基线已有同一机制。
- `capturePreOpen` 新增检查 = 一次 `statusIdFromPath()` 正则；快照 = 3 字段对象一次展开。均只在点击/路由事件路径上，非热路径。
- 无任何新启动定时器/interval。**判断：不存在可拖慢首显的新增同步工作或新常驻定时器。**

### G5 Native 私有接口隔离仍有效 — PASS

`npm run build:native` 构建成功；构建期 FORBIDDEN 闸门存在（含 fetch/XHR/webpackChunk/queryId/x-csrf-token/authorization/document.cookie/chrome.* 等）。对产物独立 grep：XMLHttpRequest=0、webpackChunk=0、queryId=0、x-csrf-token=0、document.cookie=0、`fetch(` 无命中。`manifest.json`：content_scripts 仅 `https://x.com/*` 与 `https://twitter.com/*`，仅注入 `vendor/brand/icon.js` + `content.js`（+css），**无 permissions 键**。`git diff` 全量扫描：无任何新增网络 API 引用。

### G6 Legacy 不受影响 — PASS

`git diff 76568a3..2513450` 的 name-only 中不含任何 `dist-extension/`、`extension/`、`src/`、`scripts/` 路径。`npm test` 实测：`tests 119 / pass 119 / fail 0`。

### G7 CI 三套测试通过 — PASS

`gh run view 38329050362` 返回：`conclusion: success`，`headSha: 25134509…`（等于本地 HEAD），jobs：Exploration success / Legacy success / Native success。

### G8 L3/L4 证据口径 — PASS（附 2 个 P2）

(a) 数量核对：报告称 92 = 73 原有 + 12 A1 + 7 A2，逐文件计数吻合；Legacy 119、Exploration 75 均本地复跑证实。
(b) 残余边界：报告明记 title 不变时 500ms/2000ms 轮询上界，且测试断言该上界而非伪造即时。
(c) L4 口径：报告"待用户执行"；检查单"除可选点赞外不要求任何账号写入"、未执行则保持 CONDITIONAL GO、第 10 步仅记录、第 11 步可选。口径保持。
(d) 平台探针矛盾如实呈现："CDP isolated world 送达 vs 真实扩展世界不送达"，结论"修复的正确性不依赖哪一种成立"，与代码事实相符。

**P2-1**：检查单第 10 步表格声称探针"输出 `navDelivered` 字段"，但所附脚本实际打印占位字符串并只对比路由时间戳前后值——只能证明"路由被快速观察"，无法区分 navigate 送达还是 title 路径生效。检查单的兜底判定已部分缓解，且第 10 步仅记录不阻断，故为 P2 文档口径问题。
**P2-2**：已提交报告引用 `docs/m1-r/m1-r-ci.md`，但该文件未跟踪——仓库/PR 内该引用悬空。CI 事实本身已用 gh 独立证实，仅提交完整性缺失。

### G9 账号写入保持人工控制 — PASS

diff 全量扫描无新增网络 API。`native-interaction.js` 抽查：文件头声明 locate-only；grep 仅命中注释；`pulse()` 仅 scrollIntoView + outline 高亮；FEEDBACK 文案明确"是否点赞由你亲自点击决定"。未发现任何代写路径。

### 总体结论：CONDITIONAL GO

- G1–G9 九项全部 PASS，无 P0、无 P1。
- CONDITIONAL 的唯一实质条件：L4 检查单尚未由用户在真实 MV3 环境执行——与工作包判定口径一致（自动化 Gate 已过、L4 未执行保持 CONDITIONAL GO），非代码缺陷。
- 两个 P2 均为文档口径问题，不阻断工程 Gate，建议在 L4 前顺手修复。

## 整改记录（执行方，Reviewer 发现后）

| 发现 | 整改 | 提交 |
|---|---|---|
| P2-2 `m1-r-ci.md` 未跟踪导致报告引用悬空 | 文件随本提交入库 | 本提交 |
| P2-1 检查单第 10 步无法归因事件送达性 | 第 10 步重写为诚实的"检测时延"口径：页面侧无法区分 navigate 送达与 title 路径（两者都表现为立即出现），验收对象改为用户可感知时延；归因实验脚本保留（`docs/m1-r/evidence/chrome-real-content-script-navapi-probe.mjs`，有头环境可选运行，仅记录不阻断） | 本提交 |

两个 P2 均不改变 G1–G9 结论与 CONDITIONAL GO 判定。

## M1-R Gate 结论

**CONDITIONAL GO**：代码正确性、CI、路由与锚点修复通过；真实 L4 验收待用户执行 `docs/m1-r/m1-r-mv3-l4-checklist.md`。按任务规则：M2-A 可以继续原型与开发，整体状态保持 CONDITIONAL GO，不升级为发布 GO。
