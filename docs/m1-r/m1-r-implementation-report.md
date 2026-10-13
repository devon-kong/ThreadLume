# M1-R 实施报告 — 架构准入收口（A1 路由边界 + A2 锚点所有权）

分支：`fix/peek-native-m1-r`（基于 `76568a3`）
状态：代码与自动化 Gate 完成；L4 真实 MV3 验收待用户执行（检查单见 `m1-r-mv3-l4-checklist.md`）。

## 修改清单

| 文件 | 变更 |
|---|---|
| `native-extension/src/route-observer.js` | A1：title watcher 升级为全配置共主信号；支持 `<title>` 元素整体替换自愈重绑；title 变更触发与点击相同的 0/60/150/350ms 有界级联；checkRoute 中的导航轨迹同步（syncTrailFromLocation）改为全配置执行 |
| `native-extension/src/anchor-restore.js` | A2：`capturePreOpen` 拒绝详情页上下文的捕获（detail-context refusal）；捕获携带 `source` 来源标记（click-precommit / navigate-precommit / route-check）；恢复武装时对锚点做快照；恢复终态（adjusted / within-threshold / window-expired / user-input）消费锚点 |
| `tests/native/native-route.test.mjs` | 新增：A1 的 12 项测试（执行真实构建产物） |
| `tests/native/native-anchor-ownership.test.mjs` | 新增：A2 的 7 项测试 |
| `tests/native/native-env.mjs` | 测试环境增强：Navigation API 模拟（absent / silent / live）、`programmaticNavigate`（键盘/程序化导航）、title 元素注入；`pushNavigate` 支持 `advanceMs` |
| `docs/m1-r/evidence/anchor-overwrite-repro.mjs` | A2 复现实验（可运行） |
| `docs/m1-r/evidence/chrome-isolated-world-navapi-probe.mjs` | A1 平台行为实测探针（可运行，已执行） |
| `docs/m1-r/evidence/chrome-real-content-script-navapi-probe.mjs` | A1 真实扩展世界探针（本执行环境受限，见下） |

## A1 — SPA 路由观察的真实运行边界

### 问题

Chromium isolated world 可以成功注册 Navigation API `navigate` 监听，但事件不一定送达（M1 实测：真实加载的扩展从未收到事件）。旧代码在 NAV_API 存在时**不启用** title watcher，导致键盘/程序化 SPA 导航（无点击、无 popstate、事件不达）只能等待 2000ms 闲置轮询。

同一根因还有第二处：NAV_API 存在但事件不达时，`checkRoute` 的轨迹同步被 `if (!NAV_API)` 短路，关闭决策的后备轨迹永久冻结在初始条目。

### 修复

1. title watcher 在**所有配置**下启用（与 navigate 监听并行，事件到达时 checkRoute 幂等去重）。
2. watcher 绑定到当前 `<title>` 元素；head childList 变化（X 整体替换 title 元素）时自动重绑新元素。
3. title 变化同时触发与点击路径相同的 0/60/150/350ms 有界级联（覆盖“先改标题后提交 pushState”的乱序）。
4. 轨迹同步在所有配置执行：与 `recordNav` 按轨迹顶去重，二者互不双记；事件不达的世界由它保持轨迹存活。
5. 轮询保留为诚实兜底，不再伪装即时感知。

### 平台行为实测（A1 任务 1 项）

- **探针 1**（`chrome-isolated-world-navapi-probe.mjs`，已执行）：本机 Chrome 155（headless）+ CDP `Page.createIsolatedWorld` 的世界中，Navigation API 对象存在、监听可注册、**且 navigate/popstate 事件均送达**。
- **M1 实测**（上一轮，真实加载扩展、有头 Chrome）：扩展 content script 世界监听注册成功但事件**从不送达**。
- 结论：两种 isolated world（CDP 创建 vs 扩展系统创建）行为不同，且事件送达性随版本/上下文变化。**修复的正确性不依赖哪一种成立**：事件到达 → navigate 驱动一切（title 路径幂等去重）；事件不到 → title 路径独立兜住。两类世界均由测试覆盖（native-route.test.mjs 的 silent / live 两模式）。
- 真实扩展世界在**当前** Chrome 版本的事件送达性 → 列入 L4 检查单第 10 步（一次性只读探针）。
- 探针 2（真实扩展世界）在本执行环境无法完成：沙箱限制 `--remote-debugging-pipe` fd 握手与 CfT 的端口绑定，脚本保留待有头环境运行。

### 残余边界（诚实记录）

无点击、无 popstate、title 不变、事件不达的导航（例如某些纯程序化 replace 且标题恰好相同）只能由轮询发现：详情页激活时 500ms，闲置页面 2000ms 上限。测试 `标题不变的程序化导航` 断言了这一有界上界而非伪造通过。

## A2 — 信息流锚点捕获的所有权

### 复现实验结论

**能复现。** 机制：`capturePreOpen` 旧实现无条件存储任何匹配 cell；只要存在“路由检查发生在 URL 已提交到详情页之后”的路径，读到的就是详情页自身的焦点 cell。可达路径：`列表 → A → /search → B`（任何非 status 中转：搜索/设置/浏览页）。`docs/m1-r/evidence/anchor-overwrite-repro.mjs` 用真实构建产物 + 同一夹具对比演示：旧语义会存入 `{statusId: B, top: 99}`（详情页位置），返回 /search 时产生无依据滚动校正；修复后捕获被拒绝、零滚动。

### 所有权规则（实施）

1. **来源**：捕获携带 `source`；只有列表上下文（URL 无 `/status/`）的捕获有效。
2. **拒 绝**：详情页上下文的捕获直接拒绝——不覆盖已有锚点、也不凭详情位置新造锚点。三个调用点（点击预提交 / navigate 预提交 / 路由检查）统一经由该闸门；路由检查调用因此退化为“取消被取代的恢复”（键盘开启路径的取消语义保留）。
3. **替换**：只有新的合法列表会话（新的列表上下文捕获）替换旧锚点；detail→detail 保留最初列表来源（原有测试继续通过）。
4. **消费**：恢复终态（已校正 / 阈值内 / 窗口过期 / 用户输入）消费锚点——过期位置不得泄入后续打开。键盘重开同帖因此不再复用旧位置做猜测性滚动（宁可原生行为）。
5. **快照**：恢复武装时持有锚点快照，窗口期间的任何捕获/遗忘不影响进行中的恢复。

### 恢复行为边界（不变量保持）

一次性有界校正、用户输入即取消、无 cell/未稳定/无锚点则零干预、≤60px 终态目标（M1 实测约 2px 的单次校正机制未改动）。

## 测试与验证

- Native：**92 通过 / 0 失败**（73 原有 + 12 A1 + 7 A2），全部执行 `dist-extension-native/content.js` 真实构建产物。
- Legacy：**119 通过**（`npm test`，构建未触碰 `dist-extension/`）。
- Exploration：**75 通过**（`npm run test:r3-r`）。
- 构建期隔离闸门：产物 0 个禁止标记（fetch/XHR/webpack/queryId/CSRF/cookie 等）。
- A1 关键断言：键盘导航 + Navigation API 静默 → 时钟零推进即检测（不再等 2000ms）；title 不变 → 2000ms 有界兜底（诚实上界）；连续 5 回合导航后监听器唯一。
- A2 关键断言：/search 中转后 B 的详情位置绝不入库；恢复终态消费；键盘重开无锚点零滚动。

## CI

见 `m1-r-ci.md`（分支推送与 Draft PR 记录）。
