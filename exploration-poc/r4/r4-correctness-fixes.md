# R4 G0 正确性修复记录：关闭导航 / 路由检测 / 网络判定器

日期：2026-10-12。基线：R3-R 验收提交 `801842d`。分支 `exp/r1-performance-experience-gate`。
PoC 版本：`exploration-poc/mv3-poc/` 0.4.0 → **0.5.0**。

## G0-A：关闭按钮的历史导航

### 缺陷

v4 的关闭决策是一个**会话级布尔**（`sessionNavigated`：本文档见过任意一次路由变更即永久为 true）。
它无法回答"当前阅读视图的上一条历史是不是 X 页面"：

- 外部链 → A → 引用帖 B → 浏览器后退回 A → 关闭：布尔仍为 true → `history.back()` → **跳出站外**。
- 刷新后关闭：布尔归 false → 行为保守但口径错误（联合历史其实仍可用）。

### 修复（content.js v5）

`closeReader()` 改为查询 `safeBackTarget()`，两级判定：

1. **主路径（精确）**：Navigation API `navigation.entries()` + `currentEntry.index`（已在
   Chrome 152 主世界与 isolated world 双双实测可用）。`entries[idx-1].url` 为同站
   x.com/twitter.com（跨域条目由浏览器自动脱敏为空串，判定天然可信）→ 才允许
   `history.back()`。idx=0（无前条）或前条非 X → 原地拆除面板。
2. **回退路径（保守）**：isolated world 不可用 `entries()` 时，用**文档内导航轨迹**
   （install 时记录初始 href；push/traverse/reload 由 navigate 事件或 popstate+轮询推断）。
   轨迹位置 > 0 意味着当前条目由文档内导航到达——从文档访问过的条目后退必停留在本文档
   （X 页面）；轨迹初始条目的前驱未知（可能是站外）→ 不后退。

### 行为矩阵（六个规定场景，16 项离线测试全绿）

| 场景 | 行为 |
|---|---|
| 1. `/home` → A，关闭 | `history.back()` → 返回 `/home` |
| 2. 外部直达 A，关闭 | 原地拆除，留在 X（不后退） |
| 3. 外部 → A → 引用帖 B → 后退回 A，关闭 | **留在 A**（前条为站外，绝不后退出站） |
| 4. 通知列表 → 帖子，关闭 | 后退 → 通知列表 |
| 5. A → B → C 逐级关闭 | 逐级后退 C→B→A→列表 |
| 6. 页面刷新后关闭 | entries() 主路径：返回真实前条（如时间线）；轨迹回退路径：保守留在 X。两种路径都不会跳站外 |

附注：刷新后 entries() 主路径能返回时间线（联合会话历史对同源条目保留 URL），
是精确行为；轨迹回退保守留在 X 也满足"不得错误后退到站外页面"。

### 回归

- 新增 `exploration-poc/r3-r/tests/poc-g0.test.mjs`：6 场景 × 轨迹路径 + 5 项 Navigation
  API 假体测试（含 entries() 抛异常回退）+ Esc 语义 1 项 = 16 项。
- 原 `npm run test:r3-r` 46 项 + 新 16 项 = **68 项全绿**；原版套件 119 项全绿。
- 测试环境修正：`poc-env.mjs` 的假 `location` 现同步维护 `href` 与 `pathname`，并新增
  `pushNavigate`（无 popstate 的 pushState 模拟）与 `clickLink`（捕获级联点击）。

## G0-B：SPA 路由检测延迟

### 缺陷

v4 的事件监听只有 popstate/hashchange/Navigation API（且 navigate 事件此前未验证在
isolated world 可用）+ 500ms/2000ms 轮询。X 的 SPA 推进用 pushState（无 popstate），
若 Navigation API 不可用，首次从信息流打开详情要等最多 2000ms 轮询——这是 R3-R 时代
"点击→面板 896ms"的重要组成部分。

### 修复

v5 分层事件驱动（`content.js` v5）：

1. **Navigation API `navigate` 事件**（主路径）：同文档导航（含 pushState、键盘、其它
   world 发起）即时触发，并同时以精确类型（push/replace/traverse/reload）喂给 G0-A 轨迹。
   Chrome 152 isolated world 实测可用。
2. **回退层**（Navigation API 不可用时）：
   - 捕获阶段**点击级联**：同源链接点击后立即 + 60/150/350ms 复查路由（观察点击，
     不拦截、不 preventDefault——X 路由器仍拥有导航）；
   - **`<title>` MutationObserver**：X 每次路由改写标题，覆盖键盘等无点击路径。
3. **轮询降级为纯兜底**（500ms 活动 / 2000ms 闲置）。

### 测量（G1 基准内置，统一起点=真实可信点击）

点击→路由被识别（v5，Navigation API 主路径，`data-peek-poc-route-change-at` DOM 镜像探针）：

- 首轮基准 8 个有效窗口：**中位 1ms，最慢 1ms**（事件即时）。
- 结论：路由检测不再贡献可感知延迟；无需引入任何 fetch/XHR 包装或 Webpack 探测。

（技术备注：isolated world 的 `Runtime.evaluate` 按名取 world 与注入 world 不互通，
探针经共享 DOM 属性 `data-peek-poc-route-change-at` 镜像，仅在测试钩子布防时写入。）

## G0-C：网络审计判断器

### 缺陷

R3-R 的 `network-recompute.mjs` verdict 只检查 **R1 独有的操作名**（native=0 且 r1>0）。
放过了四类差异：同操作次数增加（TweetDetail 1→2）、方法不同（GET→POST）、同窗口重复
调用被跨轮聚合掩盖、以及不分场景的总体聚合。

### 修复（严格判定器）

`recompute()` 重写，聚合键升级为 `cat:op:method`，分场景判定：

- **V1 new-api-op**：graphql/rest 操作在原生全窗口缺失而 R1 出现 → 违规。
- **V2 api-count-above-max**：API 操作在任一 R1 窗口的次数 > 原生任一窗口的最大次数
  → 违规（反例 TweetDetail 1→2 必然命中；原生自身出现过的次数视为自然波动）。
- **V3 method-mismatch**：同操作的 HTTP 方法集合不一致 → 违规。
- **F1 non-api-extra**：非 API（media/x-page/third-party）超出原生轮次上限 → **说明项**
  而非违规（阅读面板加载帖子图片、原生格可能走缓存，属预期差异，如实列出）。
- R1 更少的请求永远不是违规（R1 不发请求）。
- 总判定 = 各场景无 V 类违规；保留 legacy 键（noExtensionApiCalls/r1OnlyApiOps/
  apiTotalDelta）以接续旧报告口径。

### 反例测试（全部内建于 `census-recompute.test.mjs`）

1. 原生 TweetDetail=1、R1=2 → **FAIL**（V2）——规定反例。
2. 同操作 GET → POST → FAIL（V1+V3）。
3. 单窗口重复（原生 [1,1]、R1 [2,1]，聚合相等 3=3）→ FAIL（V2 逐轮上限）。
4. 原生自身波动 [1,2] vs R1 [2,1] → PASS（自然波动容忍）。
5. 媒体类多加载 → 说明项，不违规。
6. 分场景独立：spa 违规 → 整体 FAIL，first-nav 仍 PASS。

### 严格判定器对历史证据的回溯发现

用新判定器复算 R3-R 的 12 窗口证据：**spa 场景 FAIL** —— R1 窗口的
`rest:/i/api/1.1/flow/timeline.json:POST` 单窗口最高 4 次，原生最高 2 次（V2）。旧判定器
因"操作名非 R1 独有"放过。该差异无法在旧证据上归因（窗口未与点击对齐，X 的后台时间线
分页可能混入）——这正是 R4 网络普查改为**点击对齐窗口**（先找帖、排空至安静、再可信
点击）的直接动因；复算结果见 `r4-performance-comparison.md` 的网络一节。

### 回归

`census-recompute.test.mjs` 4 项原有 + 6 项新增 = 10 项；`npm run test:r3-r` 68 项全绿。

### 附注（独立 Reviewer P3-4，留档）

Esc 捕获先于 X 快捷键管理层的前提是"X 当前把全局快捷键监听放在 document 级"这一经验
事实（2026-10-12 实测）。若 X 未来改为 window 捕获级先注册，捕获监听将失效——与 PoC
整体同样属于对 X 当前实现的依赖；MV3 人工检查单第 6/7 项可在验收时发现此类变化。
