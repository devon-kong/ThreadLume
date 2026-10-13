# M2-B1-R 架构准入（独立 Reviewer）

## 独立 Reviewer 复核（G1–G13）

Reviewer 为独立 Agent，直接阅读源码与测试（未采信执行方总结），自行重跑双构建与三个测试套件（native 165/165、主 119/119、r3-r 75/75），并以真实打包产物复现了其发现的新缺陷。复核基线：提交 `1f6883c` + `d9766a6`。

| Gate | 结论 | 要点 |
|---|---|---|
| G1 MAIN 自主通知可靠到达正确会话 | FAIL → 修复后 PASS | 分诊与 {gen,reqNonce,focusUrlId} 关联成立；但 Reviewer 实锤**内部重装 gen 漂移**：`install()` 对 internalReinstall 也递增 gen 而控制器不回写，"重装成功 → 同路由自退"序列中 HEALTH_ERROR 被当异代次事件丢弃、CSS 残留（P0 症状类别复发）。已整改（见下） |
| G2 健康失配一致恢复 | FAIL → 修复后 PASS | 已测路径与实机 mismatch 证据全过；G1 缺陷是其唯一可达例外，随整改消除 |
| G3 旧会话/迟到事件不干扰新会话 | PASS | UNINSTALL 携带焦点、MAIN 焦点不匹配拒绝；A6–A9 全过 |
| G4 恢复失败 Residue Lock | PASS | B1a/B1b/B2/B3/B4/B5 逐字核对；route-moved 分支如实上报恢复失败 |
| G5 同 cell article 替换 | PASS | 观察器 + 决策表 + 健康拍兜底；C1–C6 全过 |
| G6 主题无自激循环/CSS 残留 | PASS | 值差异跳写单独终止任何回声链；值+优先级还原；D1–D6 全过 |
| G7 采集器统一时钟 | PASS | t0=捕获期点击戳、点击后零固定 sleep、T4 关闭原点仅在离开详情后求值；`t4Stable−t4Left` 换算数学等价；analyze.mjs 可复算 |
| G8 性能无不可接受回归 | PASS | 同表面 lab vs native T1 差 −22～+5ms；包装 +0.8µs/次；空闲零长任务；T4 <3.5s 无失控；两处字面 FAIL 解释成立（T1 双峰经原始数据验证；T2 highcomments 定性 INCONCLUSIVE 而非"噪声排除"） |
| G9 左视频与评论正常 | PASS | 深滚视频 sameElement 4/4、focalCount=1 恒成立；视频控件实测真实状态迁移 |
| G10 零主动私有 API | PASS | 全路径直读无 fetch/XHR/凭据/webpack 探测；manifest 无 permissions；构建禁标扫描 + 测试重扫双把守 |
| G11 M1-R 与 Legacy 隔离 | PASS | 双构建互不触碰、默认构建零适配器注册、119/165/75 全绿 |
| G12 真实 MV3 核心场景 | PASS | 结构失配实机回退、视频控件、灯箱 Esc、快速切帖、前进后退；NOT_TESTED 如实（全屏物理 Esc 的 CDP 边界以 `afterEsc el:"DIV"` 佐证，未伪装成功） |
| G13 无未经批准的降级 | PASS | diff 仅 layout-adapter/*、main.js 测试钩子 6 行、协议更名断言与新测试；reader/focal/video/anchor 路径零触碰 |

## Reviewer 综合结论（原文要点）

**CONDITIONAL GO**：修复质量良好且经得起逐行核对，但 (a) gen 漂移缺陷须修复并补"重装成功 → 同路由自主退出 → CSS 必须移除"双 world 回归测试；(b) performance-report.md 两处数字与自身原始数据不符须更正；(c) 建议对无焦点字段的伪造事件不做无限定释放。完成后无需重新全量验收，补跑相关测试 + 一次复核即可转 GO。

## 整改记录（本轮完成）

| 条件 | 整改 | 验证 |
|---|---|---|
| (a) gen 漂移 | `adapter-core.js` install()：内部重装**延续同一安装会话代次**（`continuesSession = internalReinstall && phase==="active"`，保持 prevGen；仅真正新安装才 `++genSeq`）。`controller.js`：HEALTH_ACTIVE 允许同焦点更高 gen 的**会话延续收养**（`s.gen = m.gen`），纵深防御 | 新增测试 A10（Reviewer 场景端到端：重装 → gen 连续 → 同路由漂移 → CSS 同拍移除、X 新方法不被碰）、A11（延续收养 + 后续 HEALTH_ERROR 必达）、A12（无焦点伪造事件绝不合成无限定释放，同时覆盖条件 c） |
| (b) 报告数字 | performance-report.md：T2 highcomments 行更正为 m1r 1340.5 / lab 1754.0 / +413.5（逐轮 lab [2031,1313,1477,2147]）；T4 video 更正为 lab−native 836.5ms / lab−M1-R 451.5ms | 与 perf-analysis.json 逐值核对一致 |
| (c) focusUrlId 加固 | stale 分支要求 `typeof m.focusUrlId === "string" && m.focusUrlId` | 测试 A12 |

整改后全套回归：native **168/168**（165 + 3 新增）、主 119/119、r3-r 75/75。整改差异仅 `adapter-core.js`（gen 连续性）、`controller.js`（延续收养 + 焦点非空守卫）、新测试、报告数字——未触及任何其他已验收路径。

## 最终结论

条件 (a)(b)(c) 全部完成并通过复核（见下方 Reviewer 二次确认）。判定：**GO**——两个 P0 修复成立、G1–G13 全 PASS、性能同表面口径无回归、隔离完整、零新增主动私有 API。建议进入 M2-B2 产品化第一包；M1-R 字面 T1 门槛差异属既定架构取舍（Native 模式放弃阅读副本换取原生保真），已在 performance-report.md 与 mv3-acceptance.md 如实记录。
