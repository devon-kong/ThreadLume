# R3-R 路由与异步生命周期：竞态修复与确定性回归

## 1. R3 遗留缺陷确认（P0-B1）

R3 v3 的 `removeReader()` 不递增 `buildToken`，导致：

- 用户打开 A → `buildReader()` 进入 30×500ms 的 DOM 等待循环；
- 用户返回信息流或关闭阅读器 → `removeReader()` 只拆 UI，**旧循环仍在轮询**；
- 若 A 的 DOM 此后水合（或极端情况下轮询期间路径重新命中），旧任务通过 `token === buildToken` 检查并**重新挂载已关闭的面板**。

同族问题：切换帖子依赖下一次 `buildReader()` 递增 token，但"离开详情页"路径没有任何失效机制；`pulse()` 高亮恢复与回复聚焦的 `setTimeout` 无所有权跟踪；`setInterval(checkRoute, 500)` 无异常保护（一次抛错静默杀死整个链）。

## 2. v4 修复设计

| 机制 | 实现 |
|---|---|
| 代际失效 | `gen` 代际计数：`buildReader()` 进入时 `++gen`，`removeReader()` 亦 `++gen`。所有异步任务持有 `myGen`，每个 `await` 之后核对 `myGen === gen`，不等即死。离开详情页/切帖/关闭后，旧任务在**当前等待解除后的第一步**退出，不可能再挂载面板 |
| 渲染前复核 | 挂载前 `statusIdFromPath() === focalId` 复核；面板带 `data-status-id`；`checkRoute` 维护分支发现不一致即拆除重建（不变量："左栏显示的永远是 URL 的帖子"） |
| 迟到水合防误判 | `extractFocal()` 在"显示更多"700ms 等待之后复核：代际、URL、`cell.isConnected`、`art.isConnected`——虚拟化回收的格不产生过期提取 |
| 有界恢复（B2） | 构建满轮失败（30×500ms）后**单次布防** `armRecovery()`：至多 3 轮恢复、间隔 3s、由既有路由 tick 驱动；恢复轮再失败**不重新布防**，路由进入休眠直至下次导航。无无界后台循环 |
| 计时器所有权 | 高亮恢复、回复聚焦等"事后触碰 DOM"的定时器登记于 `ownedTimers`，`removeReader()` 统一清除；异步等待（sleep）自完成、被代际守卫，故意不入册（避免悬挂 Promise） |
| 路由观察有界化（B3） | 固定 `setInterval` 改为**单条自调度链**：活动态（详情页/面板存在）500ms、闲置态 2000ms，`try/catch` 保证异常后链不断；SPA 感知仍由 popstate + Navigation API 即时覆盖（X 走 pushState 不触发 popstate，轮询是安全网）。内容脚本生命周期内该链常驻（其宿主即文档生命周期，这是所有权而不是泄漏） |
| 幂等 | `__peekPocInstalled` 守卫（重复注入/扩展重载） |

## 3. 确定性回归测试（P0-B4）

执行环境：jsdom 30 + 生产源码逐字执行（`new Function` 注入受控 DOM/定时器/时钟——**测试的就是 `exploration-poc/mv3-poc/content.js` 本体**，非复写算法）。假定时器单时钟推进，`advance(ms)` 按到期顺序触发并冲刷微任务，全部场景确定性、无真实网络。测试文件：`exploration-poc/r3-r/tests/poc-race.test.mjs`（12 测试）+ `poc-negative.test.mjs`（7 测试）。

| # | 场景（任务书 B4 清单） | 断言要点 | 结果 |
|---|---|---|---|
| 1 | 进入 A 后立即返回首页 | 拆除后推进 80000ms 假时间：0 面板、0 样式残留、无 data 属性；继续推进仍 0（旧任务若有生命周期即在此现形） | ✅ |
| 2 | A 的 DOM 延迟出现 | 轮询 3s 无面板 → 挂 DOM → 面板建立且 `data-status-id` 正确、仅 1 个 | ✅ |
| 3 | A 未构建完切 B | B 挂载正确；A 的 DOM 迟到 60s 后面板仍是 B、无 A 内容 | ✅ |
| 4 | 展开全文未完成就关闭 | "显示更多"点击 1 次后拆除 → 推进 60s：无过期挂载、**点击不重复** | ✅ |
| 5 | 连续快速 A、B、C | 最终仅 C 挂载，数据正确 | ✅ |
| 6 | 后退、前进、再次进入 | 面板随路由出现/消失，恒 1 个 | ✅ |
| 7 | DOM 等待超时后水合恢复 | 首轮超时（15s）→ 无面板 → 挂 DOM → 恢复轮（≥3s）重建且唯一；再推进 120s 不叠加 | ✅ |
| 8 | 扩展重复注入 | 二次 boot 不新增观察链（pending 计数不变）、面板唯一 | ✅ |
| 9 | 卸载后无旧计时任务重新挂载 | 推进 180000ms：0 面板、仅剩路由观察链 | ✅ |
| 10 | 焦点 ID 与左栏一致 | 挂载后 `data-status-id === URL id`；人为污染 dataset → 维护 tick 强制重建回正确值 | ✅ |
| 附 | 关闭语义 | 会话内关闭→`history.back` 1 次；直达进入→0 次且停留 X | ✅ |
| 附 | 互动定位 | 原生控件 scrollIntoView + 高亮 1.6s 后由在册定时器恢复；原生按钮 0 次合成点击 | ✅ |

**反例语义（E3）**：`poc-negative.test.mjs`——缺失字段渲染"未知/正文未识别"不编造 0；删除帖占位如实渲染、计数全未知；DOM 永不到达/超时/离线 → 4 轮（1+3 恢复）后有界休眠，**预算耗尽后迟到的 DOM 也不再触发死循环**；URL 变更过期提取即弃；虚拟化回收格的等待中移除 → 结果作废、有界重试；半水合空 src 不渲染破图；垃圾计数（"赞"/"12.3.4"/"—"）显示未知。

**修复过程中被测试逼出的两个额外真实缺陷**（均已修复并有回归测试）：
1. 恢复轮失败会重新布防 `recoveryLeft=3` → 永不止休。改为单次布防（`recoveryArmed`），B4-9/E3 超时场景验证休眠。
2. fallback 路径把 `<time>` 时间行当正文。改为结构化剔除 time 元素（E3 缺失字段场景验证）。

## 4. 监听器与资源释放核查（P0-B3）

| 资源 | 所有权 | 释放路径 |
|---|---|---|
| 路由观察链 | 单一 `routeTimer` 句柄，自调度 | 常驻（生命周期=文档）；异常安全；幂等守卫防双链 |
| popstate/hashchange/navigate 监听 | 文档级，注册一次 | 随文档销毁；幂等守卫 |
| 主题 MutationObserver | `themeObserver` 单例 | `removeReader()` disconnect + 置空 |
| 高亮恢复/回复聚焦定时器 | `ownedTimers` 集合 | `removeReader()` 全量 clear；恢复回调核对 `isConnected` |
| 展开全文等待 | 普通定时器（自完成） | 代际守卫在唤醒后终止任务链 |
| 面板/样式节点与 data 属性 | id 固定单实例 | `removeReader()` 移除 |
| 闲置态开销 | 路由 tick 500ms→2000ms（闲置），每次 tick 仅一次 `location.pathname` 正则 + 分支判断 | — |

运行 `npm run test:r3-r` 复现全部结果（46/46，含 R3 既有 4 项移植后的单元测试与 Reviewer 复核后新增测试）。
