# M2-B2-A 交接生命周期：状态机、竞态与清理

实现：`native-extension/src/preview-layer.js`（状态持有者）+
`route-observer.js`（捕获/路由事件源）+ `layout-adapter/controller.js`（handoff/stop 事件源）。

## 1. 状态机

```
                 点击（捕获期，资格判定通过）
   IDLE ────────────────────────────────────────▶ PREVIEW_READY
                                                    │  唯一计时器：1200ms 路由超时
                              URL 变为目标详情       │
   PREVIEW_READY ───────────────────────────────▶ NATIVE_WAITING
                                                    │  适配器 60ms 重试（≤3s 预算）
                              ACTIVE verified       │  （同一任务：mountLayout → 清预览）
   NATIVE_WAITING ──────────────────────────────▶ [HANDOFF] → IDLE（原生接管）

   任意状态 ──▶ CLEANUP（同步移除 overlay + style + 计时器）──▶ IDLE
```

NATIVE_ACTIVE 不是预览层的状态——原生接管完成后预览层回到 IDLE，阅读由
M2-B1-R 适配器会话（session/phase/gen）承载，预览层与其零耦合（仅消费两个钩子事件）。

## 2. 身份与代次规则

- 每个预览绑定 `{ statusId, gen }`；`genSeq` 模块级单调递增；
- 路由确认（`previewOnRouteChange(id)`）要求 `id === P.statusId`；
- handoff（`previewAdapterHandoff(focusUrlId)`）要求 `P.statusId === focusUrlId`，
  不匹配 → 立即清除（宁误杀不误留）；
- 计时器回调核对 `P.gen === 挂载时 gen`（替换后旧回调失效）；
- 预览数据本身在**捕获期一次性提取**，无任何异步补全路径——不存在"预览内容属于
  另一帖"的竞态窗口；唯一身份风险（点击到挂载之间 DOM 变化）由资格判定在同一个
  同步调用内完成而消除。

## 3. 事件 → 行为对照（全部退出路径）

| 事件 | 来源 | READY | WAITING |
|---|---|---|---|
| 路由 → 目标详情 | checkRoute | → WAITING（计时器解除） | 幂等保持 |
| 路由 → 其他详情 | checkRoute | 清除 route-mismatch | 清除 route-mismatch |
| 路由 → 离开详情（含返回/前进） | checkRoute | 保持（仍可能在途）| 清除 route-left |
| 列表页路由 tick | checkRoute | 保持（超时器负责） | 不适用 |
| 1200ms 无导航 | 计时器 | 清除 route-timeout | 不会 armed |
| 无关点击（非状态链接） | onCaptureClick | 清除 click-elsewhere | 清除 click-elsewhere |
| 另一资格点击 | onCaptureClick | 替换（gen+1，单实例） | 不会发生（详情页不预览） |
| 适配器 ACTIVE verified | controller | 清除 handoff（同任务） | 清除 handoff（同任务） |
| 适配器失败（ack 超时/ERROR/HEALTH_ERROR/Residue Lock 拒绝） | failSession | 清除 adapter-* | 清除 adapter-* |
| 适配器休眠（MAIN 自检退出） | dormantSession | 清除 adapter-* | 清除 adapter-* |
| 会话被新路由取代 | teardownSession | 由路由事件处置 | 由路由事件处置 |
| 页面刷新/扩展重载 | — | 整页重建，无残留 | 整页重建，无残留 |

关键顺序保证：**handoff 清除与 mountLayout 在同一个同步任务里**（controller.js
`handleResponse(ACTIVE)`：核验标记 → mountLayout → previewAdapterHandoff）。
浏览器在该任务结束后才产生下一帧——不存在"分栏已挂、预览还在"或"预览已走、
分栏未挂"的中间帧。

## 4. 竞态分析

1. **点击 vs 导航**：预览挂载在捕获期（X handler 之前）。X 提交导航不依赖预览；
   预览也不等待 X——两侧独立，唯一交汇点是 checkRoute 的身份核对。
2. **双击/快速 A→B**：第二次资格点击在同步调用里替换预览（gen+1）；旧预览的计时器
   被清除，不存在旧回调复活。若旧预览已 WAITING（URL=A）而用户在 A 的详情页点击 B：
   详情页不预览（fail-open），旧预览由 route-mismatch/路由事件清除。
3. **handoff vs 失败**：ACTIVE 与 HEALTH_ERROR 都由消息驱动，同一微任务队列串行处理；
   先到先决：handoff 清预览、failSession 清预览——终态一致（无预览），差异仅在分栏
   CSS 是否挂载（M2-B1-R 既有语义）。
4. **Residue Lock**：MAIN 拒绝新 INSTALL → 控制器 failSession → 预览退出；预览层
   不做任何重试，不与 Residue Lock 交互（"Residue Lock 时不反复尝试接管"由预览层
   无重试 + 适配器既有拒绝逻辑共同保证）。
5. **返回/前进（traverse）**：popstate → checkRoute → id=null（或另一帖）→
   route-left/route-mismatch 清除。预览从不持有路由/历史状态。

## 5. 清理完备性

预览层拥有的全部资源：1 个 overlay 节点、1 个 style 节点、1 个 setTimeout。
任何清除路径三者同拍回收（`clearPreview`）。**没有**：window/document 监听器、
MutationObserver、interval、对 X 节点的任何写入（预览只读 X DOM，自身节点独立挂载
在 `document.body`）。测试 P1–P15 逐路径断言 overlay/-style/`snapshot().timerArmed`
归零；P6 额外断言超时后推进 3s 无复活。

## 6. S2 十五场景 → 验证映射

| # | 场景 | 离线测试 | 真实 MV3 |
|---|---|---|---|
| 1 | 点击普通短帖 | P1/P3 | LIVE-PENDING |
| 2 | 点击长帖 | （同提取路径，折叠态如实） | LIVE-PENDING |
| 3 | 点击多图片帖 | P1（photos 断言） | LIVE-PENDING |
| 4 | 点击视频帖 | P11 | LIVE-PENDING |
| 5 | 点击引用帖 | P8（fail-open） | LIVE-PENDING |
| 6 | 回复进入上下文详情 | 不预览（详情页边界）——P9 | LIVE-PENDING |
| 7 | 连续 A→B→C | P7（A→B 替换）；B→C 为详情→详情，适配器会话链由既有 E3 覆盖 | LIVE-PENDING |
| 8 | 浏览器前进/后退 | P5（popstate traverse 清除） | LIVE-PENDING |
| 9 | 打开后立即关闭 | P5/P9b + route-left 清除 | LIVE-PENDING |
| 10 | 原生详情加载失败 | P10（ack 超时 → fail-closed + 预览退出） | LIVE-PENDING |
| 11 | 焦点 article 延迟水合 | 既有 A/C 系列（P1-B 重绑）；预览只等待 handoff | LIVE-PENDING |
| 12 | X React 替换焦点 article | 既有 C1–C6 | LIVE-PENDING |
| 13 | MAIN 适配器安装失败 | P10 + 既有 E4/E6 | LIVE-PENDING |
| 14 | 健康检查触发 ERROR | Q3 + 既有 A 系列 | LIVE-PENDING |
| 15 | 页面刷新/扩展重载 | P12（默认构建隔离）+ 安装幂等守卫 | LIVE-PENDING |

核心不变量（任务原文）→ 测试：

| 不变量 | 测试 |
|---|---|
| 预览 ID 始终等于目标 ID | P1/P2/P3/P7（data-status-id + snapshot().statusId） |
| 原生接管后预览数为 0 | P3（overlayCount=0 + style=null + snapshot inactive） |
| 原生焦点 article 数为 1 | P3/P9/P14（markedArticles=1） |
| 原生焦点视频实例数不增加 | P11（video 计数=1，仅 X 自己的）+ 既有 G9 深滚存活 |
| 不出现两个阅读视图争夺滚动 | 预览 pointer-events:none + 零滚动 API 调用（构造保证）；P15 |
| 预览不影响评论分页 | P14（wrap 注入 + 回复序列不变） |
| 预览退出无监听器/计时器残留 | §5 资源清单 + P6 不复活 |
| 错误不破坏 M2-B1-R 安全退出 | P10/Q3（fail-closed 路径全部保留） |

LIVE-PENDING：执行环境的浏览器无法由 Agent 自主加载未打包扩展（CDP Extensions 域
不可用、WebUI loadUnpacked 需原生文件对话框），真实 MV3 验证清单待操作员按
`docs/m2-b2-a/evidence/OPERATOR.md` 逐模式加载后由同一 harness 执行；全部条目如实在
experience-qa.md / architecture-gate.md 标注，未伪造。
