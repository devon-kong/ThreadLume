# R3-R 网络审计：普查工具修复、可复算证据与公平对照

日期：2026-10-12。条件：同一登录会话（ego-browser，已授权只读验证）、同一公开样本池、两条件各自独立新页面（native 无 PoC 注册 / r1 隔离世界注册 PoC v4）。**本轮 0 次真实账号写入、0 次私有接口重放、0 凭据采集**（工具链仅解析 URL pathname 并立刻丢弃原串）。

## 1. R3 普查工具的缺陷与本轮修复（P0-A1）

R3 的 `classify()` 用正则 `/graphql\/([a-zA-Z0-9]+)\/([A-Za-z]+)/` 提取操作名，queryId 字符集不含 `-` 和 `_`。X 的 queryId 恰恰普遍含这两个字符，因此 **R3 RECORDED 数据里 5 个 GraphQL 操作被误标为 REST**（`rest:/i/api/graphql/…/TweetDetail`、`…/TweetResultByRestId`、`…/CreatorStudioTabBarIte`、`…/ViewerBadgeCounts`、`…/ExploreSidebar`）。R3 报告正文的人工表格分类是对的，但工具产生的记录与"18:18 逐操作一致"无法从仓库工件独立复算。

修复（`exploration-poc/r3/network-census.mjs`）：

1. **pathname 解析**：`/i/api/graphql/<queryId>/<Op>` 按 URL 路径段解析，queryId 字符集 `[A-Za-z0-9_-]` 全集；不依赖任何固定 queryId 清单。
2. **五类分类**：`graphql:<Op>` ／ `rest:<脱敏路由>` ／ `media`（twimg 静态与媒体）／ `x-page`（页面文档与同源非 /i/api/ 请求）／ `third-party` ＋ `other`（blob:/data:/wss: 等非 http(s) 协议，只记协议名）。
3. **REST 路由脱敏**：路径段中长数字→`:id`、长十六进制→`:hash`，查询串不记录。
4. **完整逐请求记录**：每条只含 `{cat, op, method, rel(ms)}`，无 URL、无头、无体、无凭据——任何总数都能从记录重导。

## 2. 证据与复算（P0-A2）

证据：`exploration-poc/r3-r/evidence/network/`，12 个窗口 JSON（native/r1 × first-nav/revisit/spa × 2 轮），每文件含 meta + summary + 逐请求记录。复算工具：`exploration-poc/r3-r/network-recompute.mjs`（`node exploration-poc/r3-r/network-recompute.mjs` 可直接运行）。离线测试证明该工具**能失败**：合成证据中含 R1 独有操作时 verdict 判 FAIL（census-recompute.test.mjs）。

### 公平对照设计（P0-A3）

| 场景 | 操作 | 口径说明 |
|---|---|---|
| first-nav | `about:blank` → 样本详情 URL，等 7s | 新文档导航。**明示：HTTP 缓存从未清除**，about:blank 往返不是冷缓存（A3 原文警告） |
| revisit | 样本详情 URL 再次导航，等 7s | 暖缓存重访 |
| spa | 作者资料页 → 排水事件 → 点击时间线状态链接 → 等 7s | 同文档 SPA 导航；两条件点击同一置顶帖 `1760839985715204230`（meta.clickedPath 留档） |

条件交错执行（每场景 native→r1 相邻数秒），两轮。样本量 n=12 窗口，**不计算 p95**。

### 复算结果

**graphql 逐操作两条件完全一致**（6 窗口合计）：

| 操作 | 原生 | R1 |
|---|---|---|
| TweetDetail | 6 | 6 |
| getAltTextPromptPreference | 6 | 6 |
| TweetResultByRestId | 4 | 4 |
| CreatorStudioTabBarItemQuery | 4 | 4 |
| DataSaverMode | 4 | 4 |
| ExploreSidebar | 4 | 4 |
| ViewerBadgeCounts | 4 | 4 |

**总计**（6 窗口合计）：原生 /i/api/ 104（gql 32 + rest 72）；R1 99（gql 32 + rest 67）。media 554/566、x-page 42/43、other 24/24、third-party 0/0。

**全部逐操作差异**（无 graphql 行——graphql 零差异）：

| 场景 | 操作 | 原生 | R1 | Δ | 归因 |
|---|---|---|---|---|---|
| first-nav | rest:flow/timeline.json | 8 | 6 | −2 | X 页面级轮询波动 |
| first-nav | rest:viewer_context.json | 9 | 8 | −1 | X 会话状态波动 |
| revisit | rest:flow/timeline.json | 14 | 10 | −4 | 同上 |
| spa | rest:flow/timeline.json | 4 | 7 | +3 | 同上 |
| spa | rest:fleets/v1/avatar_content | 3 | 2 | −1 | X 侧波动 |
| spa | x-page:/1.1/live_pipeline/update_subscriptions | 5 | 6 | +1 | X websocket 订阅回退 |
| 各场景 | media:profile_images | 56 | 66 | +10 | **可解释**：面板 52vw 布局使视口内原生格集合不同，加载的头像集合随之不同（布局位移的次级效应，非 API 调用） |
| 各场景 | media:hashflags | 4 | 6 | +2 | X 静态资源时序波动 |

**verdict（由记录重导，非预设）**：R1 独有的 /i/api/ 操作 = **无**；R1 独有的非 API 请求 = **无**；/i/api/ 总数差（R1−原生）= **−5**。

## 3. A4 五问直答

1. **R1 是否存在扩展主动构造的私有 API 请求？** 无。12 窗口中 R1 条件未出现任何原生条件没有的操作；结合源码（0 fetch/XHR、无重放、无凭据），R1 自身私有 API 调用恒为 0。
2. **与原生 X 相比，R1 是否增加了请求？** /i/api/ 总数未增加（−5，X 自身波动区间内）；graphql 逐操作严格一致。
3. **额外请求属于哪类？** 不存在"额外"类别。差异全部落在 X 自身波动类：flow/timeline.json（页面级轮询）、viewer_context、fleets 头像、live_pipeline 订阅、静态媒体时序。唯一系统性偏移是 media:profile_images +10，归因于增强布局（52vw）改变视口内格子集合的次级效应——是"看的头像不同"，不是"多发请求"。
4. **对性能与资源加载有什么影响？** 请求面无实质影响；静态媒体总量差 +12/1120（约 1%），主体是头像 URL 集合不同。布局位移本身（52vw）是 R3 已记录的既有设计代价，非本轮引入。
5. **哪些结论因样本不足仍不能证明？** n=12 窗口、单账号、单会话、两轮：不能证明（a）任意帖子/任意会话状态下逐操作都一致——本证据支持的是"抽样窗口内未观察到 R1 引入任何新操作"；（b）长时间会话（如分钟级停留、多次互动）下 X 自身轮询节奏不因增强而漂移；（c）media:profile_images 偏移的完全归因（需逐字节视口对照，超出本轮范围）。这些留待正式工程期的复测，不作为阻断。

## 4. 残余说明

- 普查覆盖页面目标（page target）的网络事件；扩展自身进程（service worker 等）的请求不在 page CDP 事件内——R1 PoC 无 background、无 fetch（源码可证），故该盲区对本结论无影响，正式工程期若引入 background 需重审。
- 本审计不声明"账号不会受平台限制"——只读对照的低风险不等于零风险（任务书口径）。
- R3 的 "18:18" 结论在修正后的分类器下不再有对应数字：修正前该数本身建立在对 5 个 GraphQL 操作的误分类上。本轮以可复算证据替代。
