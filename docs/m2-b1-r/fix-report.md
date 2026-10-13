# M2-B1-R 缺陷修复报告

分支 `fix/peek-native-m2b1-r`（基于 M2-B1 验收提交 `5d43830`）。本轮定位：**小范围工程修复与准入验收**——只修 ChatGPT 独立验收指出的 P0×2 + P1×4，不动已验证稳定的布局适配架构。配套文档：[message-lifecycle.md](message-lifecycle.md)、[rollback-and-residue.md](rollback-and-residue.md)、[performance-report.md](performance-report.md)、[mv3-acceptance.md](mv3-acceptance.md)、[architecture-gate.md](architecture-gate.md)。

## 第一部分：直接回答验收问题

1. **P0 消息同步问题是否真正修复？** 是。自主通知独立成 `HEALTH_*` 类型族，携带 `{gen, reqNonce, focusUrlId}` 关联三元组；控制器按类型分诊，不再用请求 nonce 过滤自主事件。27 个新测试 + 实机结构失配回退共同验证。
2. **MAIN world 健康退出后，双栏 CSS 是否立即清理？** 是。`HEALTH_ERROR` 到达的同一消息处理内执行 `removeLayout()`（样式移除、`data-peek-lad` 摘除、`failed` 标记）；测试 A2 断言同一交付窗口内四项全部完成，实机 mismatch 测试（`mv3r-checks.json`）在删除包装方法后 ≤2 个健康拍内观测到完全回退且原生单栏可读。
3. **恢复失败会不会再次错误安装？** 不会。恢复失败进入 `RESIDUE_LOCKED`：诊断引用保留至页面销毁，`install()` 在入口拒绝一切新安装（测试 B2），残留状态下包装器直通保证 X 正常渲染（B3），卸载请求不清锁（B4）。
4. **同 cell 的 article 水合是否安全？** 是。cell 级 MutationObserver（120ms 去抖）+ 健康拍双通道重验；标记只重绑到经时间戳链接证明仍属焦点的 article；无法证明即安全退出；视频节点零接触（测试 C1–C6）。
5. **主题观察是否存在反馈循环？** 不存在。自写回声丢弃 + 相同值跳写双层守卫；测试 D3 断言挂载后空闲期回调数为 0、总量有界；清理恢复适配前内联变量的值与优先级（D5）。计数器 `themeDiagnostics()` 可复算。
6. **M2-B1 真实 T1/T2/T4 与 M1-R 相比如何？** 见 [performance-report.md](performance-report.md)。统一点击时间轴后 T1 中位进入 ~1s 量级（旧采集器的 ~1580ms 系点击后固定 sleep 1500ms 的测量伪影）；lab vs m1r 同口径中位差在门槛内，详见报告（含配对差、最慢样本、缺失样本）。
7. **左视频深滚持续播放优势是否保留？** 保留。4 轮 lab 视频样本深滚 5000px 后 `sameElement=true、playableNow=true` 全部成立；`videoInFocal=true`、focalCount 恒为 1。
8. **Native 是否仍保持零主动私有 API 请求？** 是。本轮改动只涉及消息路由、状态机、观察器与采集器；无 fetch/XHR 桥、无凭据读取、无 Webpack 探测、无隐藏标签页；构建期禁标扫描与测试套件继续把守（native 165 / 主 119 / r3-r 75 全绿）。
9. **真实 MV3 完成了哪些验收？** 见 [mv3-acceptance.md](mv3-acceptance.md)：扩展卡片、真实分栏、视频播放/暂停/进度/全屏进入、灯箱开合+Esc、快速切帖、前进后退、结构失配实机回退（新增）、深滚视频存活。物理 Esc 退出全屏仍属 CDP 无法合成浏览器级快捷键的已披露边界（用户检查单保留）。
10. **是否可以正式进入 M2-B2 产品化？** 见 [architecture-gate.md](architecture-gate.md) 独立 Reviewer 结论。
11. **还剩哪些具体功能和体验缺口？** 见下文"遗留缺口"。

## P0-A：MAIN 与 ISOLATED 自主通知丢失

**缺陷**：`handleMainMessage()` 用 `m.nonce !== s.nonce` 过滤一切消息；健康检查自主退出发出的 ERROR nonce 为 null，永远被丢弃——控制器滞留 ACTIVE，双栏 CSS 残留（跨 world 状态不一致）。

**修复**（`constants.js` / `main-world-entry.js` / `adapter-core.js` / `controller.js`）：

- 消息分两类：请求响应（INSTALL/UNINSTALL/QUERY → ACTIVE/UNSUPPORTED/ERROR/UNINSTALLED/STATE，nonce 关联）与自主通知（HEALTH_ERROR/HEALTH_UNINSTALLED/HEALTH_ACTIVE，gen+focus 关联）；
- 会话代次 `gen`（单调递增）随 ACTIVE 下发，控制器记录；自主通知按 `{gen, focusUrlId}` 验证归属；
- ACTIVE 完整性校验：控制器确认焦点标记真实存在才挂载 CSS（同时防御伪造与标记失败错位）；
- UNINSTALL 命令携带焦点，MAIN 拒绝释放不匹配焦点——旧会话迟到事件不可能误杀新会话；
- 12 项双 world 集成测试（测试 A1–A9）+ G1–G3 对应审查项。

**合同文档**：[message-lifecycle.md](message-lifecycle.md)。

## P0-B：性能测量方法失真

**缺陷**：`s5-perf.mjs` 在鼠标点击后固定 `sleep(1500)` 才开始 T1 轮询；T2/T2b/T3 串行接力，时间原点各不相同。报告中的 ~1580ms T1 实为"sleep 之后仍不可读的时间"，不是原帖首次可读时间。

**修复**（`docs/m2-b1-r/evidence/perf.mjs`，替代 `docs/m2-b1/evidence/s5-perf.mjs`，旧文件保留作历史）：

- 点击前完成全部武装：目标帖 ID 绑定、单 rAF 条件环、性能时间戳初始化、长任务观察器；
- `t0` = 捕获期监听器记录的用户对目标帖时间戳链接的真实点击时刻；此后**零固定 sleep**，harness 只轮询读取已记录的戳；
- T1 含身份防伪（正确 status id + 自有时间戳链接 + 非空正文）；
- T2a/T2b 独立上报且明确降级口径：当前 X 的回复单元不含 socialContext（实机核实），DOM 无法证明评论父子关系——两指标一律标注"原生评论候选"，三模式同口径，不伪称已验证回复；
- T2b 为真实几何相交（右栏/阅读面板之外 ≥100px 可见宽），非 DOM 存在性；
- T4 要求：离开详情 + ≥3 cell 重建 + 原锚点恢复 + 两次相隔 ≥500ms 的 scrollHeight 稳定探针；首 cell 出现不算完成；
- 视频指标：首节点/首帧可播/深滚后同一元素（按打标追踪，非 DOM 首个）/播放连续/等待（重缓冲）计数；
- 视频样本实机确认真实可播视频节点（readyState 4、时间推进）后才计入；
- 三模式同脚本、同浏览器、同账号、同样本（含新增置顶高评论样本）、固定顺序、低频 4 轮，JSON 留存脱敏相对时钟。

## P1 系列

- **P1-A 残留锁定**：见 [rollback-and-residue.md](rollback-and-residue.md)。`RESIDUE_LOCKED` 状态、lastError 不可覆盖（含 route-moved 分支如实上报修复）、拒绝重装、引用保留、诚实降级。
- **P1-B article 替换**：同上文档。观察器 + 健康拍双通道，确认归属才重绑，不可证即退出。
- **P1-C 主题循环**：`applyAdapterTheme()` 自写回声在观察器回调中丢弃（`themeSelfWrite` 标记）；`writeRootVar()` 值相同即跳写（不产生自激变更）；`captureInlineVars()/restoreInlineVars()` 在挂载前捕获三个 `--peek-lad-*` 变量的值与优先级、拆卸时精确还原；`themeDiagnostics()` 暴露 callbacks/writes/skippedWrites/selfEchoDrops 供测试复算。测试 D1–D6。
- **P1-D 真实 MV3 补证**：见 [mv3-acceptance.md](mv3-acceptance.md)。

## 验证与回归

```
npm run build:native ✓   npm run build:native:lab ✓
npm run test:native      165/165（138 既有 + 27 新增，既有断言仅随协议重命名 HEALTH_*）
npm test                 119/119
npm run test:r3-r        75/75
```

新增 27 个针对性测试全部针对**真实打包产物**（`dist-extension-native-lab` 的 MAIN + ISOLATED 同窗共载，与真实双 content script 同构）。既有测试零删除；C1–C7 的 6 处断言从自主事件旧类型名（ERROR/UNINSTALLED/ACTIVE）更新为新协议名（HEALTH_*），语义覆盖不变。

## 遗留缺口（如实）

1. **物理键盘 Esc 退出全屏**：CDP 无法合成浏览器级快捷键；`document.exitFullscreen()` 路径 S4 已验证，全屏**进入**本轮实机验证成功。保留用户检查单。
2. **X Article / GIF / 投票实机样本**：本轮时间线扫查未命中活跃样本；S4 证据 + 单元覆盖仍在，如实标 NOT_TESTED（本轮重测）。适配器对内容类型无感知，风险面未变。
3. **同 cell article 替换的实机自然发生**：机制经 fixture 全覆盖；真实页面无法按需诱发（本轮观测期未出现）。
4. **主题切换实机**：X 主题为账号级设置，自动切换构成账号写入；循环自由度以单元计数器证明，实机保留人工检查。
5. **T2 的"已验证回复"口径**：X 当前 DOM 不含 socialContext，三模式统一以"原生评论候选"上报，不伪称已验证（候选口径下 lab vs m1r 差值仍在门槛内）。
