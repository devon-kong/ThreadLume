# M2-B2-C1：性能与网络回归

## 配对协议

在同一 Ego TaskSpace 24、同一已登录浏览器/账号、1329×736 视口、浅色主题、相同四个公开帖（video/photos/text/highcomments）与同一 B2-B 测量器上，先测已验收 B2-B 构建（内容 hash `3abb7ea0aa`），再测 C1 受测构建（内容 hash `cec9a4db35`），各 2 轮×4 帖。`evidence/prepare-perf-run.mjs` 从 B2-B 脚本产生两份相同协议，只改变 TaskSpace、输出路径和轮数，并删去不必要的 React 私有方法计时探针；`perf-baseline.json`、`perf-c1-final.json` 和 `analyze-perf.mjs` 可重算。另存 `perf-c1.json` 是修正投票选择器前的中间构建，不用于 Gate，不隐去该尝试。独立审查后的引用归属修正改变了最终构建内容；该小变更未经同环境重新配对，以下 Gate 仅证明受测构建表现，当前产物性能仍为 **PARTIAL**。

两版各 8/8 成功进入目标帖子；C1 八条 `labIntegrity` 全部 `state=active`、焦点数 1、皮肤挂载、无预览残留、无横向溢出。早前历史中位数 29.5/396.5/1215/70.7/732.6ms 只作背景，不混入本次配对 Gate。

| 指标 | B2-B 中位 / n | C1 中位 / n | 差值 | 最大有效逐对增量 | Gate |
|---|---:|---:|---:|---:|---|
| T1a 即时预览 | 28 / 8 | 26 / 8 | −2 | +13 | **PASS**：≤100ms 且额外≤30ms |
| T1b 原生接管 | 398 / 8 | 395 / 8 | −3 | +13 | **PASS**：阈值 50ms |
| T2a 原生候选入 DOM | 1458 / 3 | 1410.5 / 2 | −47.5* | +203（仅 1 对） | **PARTIAL** |
| T2b 原生候选可读 | 1463 / 3 | 1416.5 / 2 | −46.5* | +202（仅 1 对） | **PARTIAL**：有效配对不足，且唯一有效对超过 146.3ms 预算 |
| T4a 返回可交互 | 81.55 / 8 | 83.95 / 8 | +2.4 | +25.7 | **PASS**（记录指标，无单列阈值） |
| T4b 返回稳定 | 749.6 / 8 | 744.4 / 8 | −5.2 | +35.6 | **PASS**：阈值 150ms |

\* T2 中位数两侧来自不同有效样本集合，不能当严格配对差；逐轮原值和缺失值见 `evidence/perf-analysis.json`。T2b 的唯一有效对是一个 +202ms 异常，现有 1/8 配对无法证明“持续回归”或“无回归”。因此整项不打 PASS，不选择较快轮次替代。

视频首次可播 B2-B 为 700.8/705.0ms、C1 为 688.3/719.5ms；两版深滚视频均 2/2 同一实例。第二轮两版 X 都在深滚处暂停（`playableNow=false`），不能写作“每轮持续播放”；第一轮均仍可播。右栏深滚长任务计数两版 8/8 均为 0。深滚后 DOM 节点数中位 947→945；JS 堆 before/after 中位 185/186.5→139/139.5MiB，但 GC 与页面时序波动明显，不把堆差当优化收益。

T1c：两版 8/8 `blankLeftFrames=0`、`leftoverPreviewFrames=0`。C1 一次 highcomments 的原生 article 内部几何探针记录 `dx=-292,dy=25`、`dupFrames=0`，其余 7 次 `dx=dy=0`；该探针采的是被预览遮住的原生 article，不能直接等同用户可见跳动，但异常如实保留。受测构建只改投票预览识别、未改布局；视觉 Gate 仍按 **PARTIAL** 记录这一单次异常，而非删掉该轮。

## 请求分类与零主动私有 API

旧 `PerformanceResourceTiming` 分桶只按 `TweetDetail|Conversation` 等正则命中；本次配对的 `gqlOther` 计数 B2-B=5、C1=2，**不能**据此推论扩展 API 请求增减。另对 C1 实机受测高评论样本做了脱敏 CDP `Network.requestWillBeSent` 观察：右栏三个滚动窗口新增可识别原生列表 ID 分别 17/17/14；后两窗各见 1 个 `GraphQL:TweetDetail`，还有 1 个 `GraphQL:getAltTextPromptPreference`。所有观察到的 X API 脚本发起来源为 `https://abs.twimg.com`；记录仅保留操作名、请求大类、发起源与计数，不保留 queryId、完整 URL、headers、响应或凭据（`evidence/network-observation-c1.json`）。新 ID 只证明原生条目进入 DOM，不证明均为直接回复。

源码和最终实际构建共同核验：Native `content.js`/`layout-adapter-main.js` 无主动 `fetch(`、`XMLHttpRequest`、`queryId`、`Authorization`、CSRF/Cookie 读取和 Legacy `page-bridge`；构建脚本的隔离禁止模式及 `tests/native/native-isolation.test.mjs` 通过。Native manifest 无 background、`permissions` 或 `host_permissions`，仅 `x.com`/`twitter.com` 的内容脚本匹配。`crossOriginRequests=0` 单独没有证明力；零主动私有 API 结论取源码、最终产物扫描和受测构建的受控发起来源交集。最终构建没有再次进行网络动态观测，故动态证据限于受测构建与观测窗口。
