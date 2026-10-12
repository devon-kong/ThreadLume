# R3 网络与性能审计：私有接口依赖、请求来源及性能对照

日期：2026-10-12。条件：同一登录会话（ego-browser CDP）、同一样本（gefei55/2109304575786393643）、同一视口、冷启动导航。方法：CDP Network 域 `requestWillBeSent` 事件普查（仅记录 URL 元数据与操作名——**不采集请求头、响应体或任何凭据**；Performance API 因 X 自身清空 resource timing 缓冲不可用，已换用协议层事件）。原版 Peek 对照数据沿用第二轮同会话同方法实测（exploration-report.md P1 表），本轮未重复注入原版产品。

## 1. 三条件对照（冷载同一详情 URL）

**条件 N（原生 X，无扩展）**——窗口期内 `/i/api/` 请求 **18** 个：

| 类别 | 操作 | 次数 |
|---|---|---|
| graphql | TweetDetail | 1 |
| graphql | TweetResultByRestId | 1 |
| graphql | CreatorStudioTabBarItem… | 1 |
| graphql | ViewerBadgeCounts | 1 |
| graphql | ExploreSidebar | 1 |
| graphql | DataSaverMode / getAltTextPromptPreference | 1+1 |
| rest | viewer_context.json | 4 |
| rest | flow/timeline.json | 2 |
| rest | fleets/v1/fleetline、avatar_content | 2+2 |
| rest | hashflags.json | 1 |

**条件 R1（PoC v3 注入，面板已构建）**——`/i/api/` 请求 **18** 个，**操作分布与条件 N 完全一致**（逐操作相同，仅映射序不同）。

**条件 P（原版 Peek 0.8.10，第二轮同会话实测）**——原生时间线自身请求 + **扩展自构造 1 个**（READ_THREAD 读）；每开一帖 1 次读 + 互动时写操作。

## 2. 两个结论

**A. 扩展对 X 私有接口的直接依赖降低了多少？**

降到 **0**。证据链：

1. 请求普查：R1 条件与原生条件的 `/i/api/` 请求**逐操作一致**（18:18）——扩展注入前后页面请求面没有引入任何新调用。
2. 源码层面：PoC v3 `content.js` **0 个 fetch/XHR 调用**（grep 认证），无 MAIN world 注入、无 Webpack 探测、无凭据捕获、无请求重放。
3. 对比原版：读路径（READ_THREAD/TweetResultByRestId 动态发现）与写路径（FavoriteTweet/CreateTweet/TOGGLE_FOLLOW/bookmarkTweetToFolder 等桥接）整体消失；R1 下扩展自身构造的私有 API 调用恒为 0。

注意口径：**R1 的总网络请求并不比原版少**——R1 由 X 自己做整页详情加载（原生 React 数据获取），请求量≈原生详情页基线；原版是时间线上的浮层（无整页导航，但扩展自构造 1 读 N 写）。"扩展自身请求少"与"总请求少"是两个指标，此处如实分开。

**B. 为实现同一阅读任务，总网络请求与实际性能是否出现不可接受的退化？**

没有出现不可接受的退化，但有明确的代价结构：

| 指标 | 原生 X（SPA 详情） | 原版 Peek（R2 同会话） | R1 PoC（R3 实测） |
|---|---|---|---|
| 点击→面板/首屏可读 | —（原生即详情页） | 98ms（DOM 快照回退首显） | **896ms**（URL 变更与面板同刻；含整页导航） |
| 点击→首批回复可读 | ~0.9–1.4s（R1） | GraphQL 后到（覆盖层先行） | 与原生一致（回复可见性不再被隐藏焦点格阻挡，v3 复测 replyVisibleWithoutScroll=true） |
| 关闭→回信息流 | — | 坐标恢复 | **190ms**，滚动偏差 1px、锚点帖一致 |
| 扩展自构造请求/阅读一帖 | 0 | 1 读 | **0** |
| 窗口期 /i/api/ 总数（含 X 自身） | 18 | 原生时间线 + 1 | 18 |

- R1 的 896ms 首屏是**整页详情导航**的代价（原版浮层首显 98ms 是 DOM 快照回退的观感优势，其完整数据同样等 GraphQL）。评论可读时间两者均受网络支配，R1 无额外劣势。
- 页面导航本身带来的请求（fleetline/viewer_context 等页面 chrome）是 X 原生行为，不是扩展成本；也不应据此判定"账号风险更高"——账号风控只能做基于具体行为与平台规则的定性评估，本报告不给任何概率。
- 外部翻译/AI 服务请求：本轮 **0**（未接入 DBC/模型服务）。

## 3. 数据来源分类（任务书 S4 五类）

| 类别 | R1 现状 |
|---|---|
| 1. X 官方网页自行发送的 GraphQL | 全部（18 个窗口期请求，见 §1） |
| 2. Peek 主动构造的私有 API 请求 | **0**（读路径零；写路径零——写入全部委托原生控件） |
| 3. 扩展引入的额外网络请求 | 0（无远程脚本、无图标 CDN、无翻译外呼） |
| 4. 页面导航引起的正常资源加载 | 由 X 自身管理（本审计未计入 /i/api/ 之外的静态资源） |
| 5. 外部翻译/AI 服务请求 | 0（本轮未接入） |

## 4. 残余说明

- 请求数为单样本小 n（同 URL 冷载 2 次）；X 自身请求量随会话状态波动（viewer_context ×4 属页面级调用），逐操作一致性比绝对数更有意义。
- 原版 Peek 条件未在本轮重测，沿用第二轮数据（同会话、同方法、同样本池）；两轮环境差异仅隔数日，X 侧无明显接口变更。
- CDP Network 事件仅保留在 ego-browser 调用进程内存中，未落盘原始事件；本报告仅记录操作名与计数。
