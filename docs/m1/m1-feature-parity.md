# M1 功能矩阵（83 项合同状态增量）

日期：2026-10-13。基线：R4 双维度 83 项矩阵（`exploration-poc/r4/r4-feature-parity.md`，
FULL 80 / PARTIAL 7 / 新增 N1–N4）。本轮**不降低范围、不重排口径、行不减**：只记录
M1 工程化引起的状态变化与如实声明的新增缺口。证据层级：SRC（源码审读）/OFFLINE
（73 项离线测试，执行真实构建产物）/LIVE-L3（ego 会话 CDP 等效注入实测）/
MV3-L4（用户手载真实扩展，待用户）/HUMAN_WRITE（用户亲自写入）/NOT_TESTED。

## 变化行（M1 实测后更新）

| # | 能力 | R4 判定 | M1 判定 | 依据 |
|---|---|---|---|---|
| A8 | Esc/关闭关闭阅读视图 | FULL | FULL（OFFLINE+LIVE-L3） | 关闭语义/轨迹/Navigation API/Esc 三语义全部迁入并有测试；LIVE-L3 实测普通详情/编辑器/照片视图三场景 |
| A9 | 关闭后信息流位置恢复 | FULL（口径=裸 X，151-153px） | **FULL（增强：B3 ≤2px）** | M1 新增单次有界锚点微调，12/12 窗口终态 ≤2px（目标 ≤60px）；机制极限（单次/用户取消/窗口过期）有测试 |
| B3 | 普通长帖全文 | FULL | FULL（OFFLINE） | 折叠首显+展开原地升级迁入；P2-1 文本单调性守卫有回归测试 |
| F1 | 读路径零扩展自构造 GraphQL/REST | FULL | **FULL（OFFLINE 静态证明 + 判定器）** | 产物/源码双层禁用标记扫描（fetch/XHR/queryId/csrf/bearer/cookie=0）；24 窗口判定器 V1=0、V3=0；API 总量 M1 206 < 裸 X 212；唯一 V2 letter-FAIL 经发起者归因为 X 自身广告遥测波动 |
| F5 | SPA 路由观察 | FULL | FULL（OFFLINE+LIVE-L3） | 事件驱动+级联+title+轮询兜底迁入；实测点击→识别 1.1–2.2ms；**新发现**：Chromium 不向隔离世界投递 navigate 事件（见下"新发现"） |
| G9 类 | 双构建独立 | —（R4 单实验产物） | FULL | Legacy 源码零改动、119 测试全绿、活体冒烟通过；两产物路径互斥且有测试 |

## PARTIAL 维持（7 项，R4 清单不变，其中 2 项细化）

| # | 能力 | 状态 | M1 细化 |
|---|---|---|---|
| A1 | 时间线/通知点击进入阅读视图 | PARTIAL | 结构差异维持（原生导航替代浮层）；性能口径见性能报告（T1 75-78ms） |
| A15 | 通知页行为 | PARTIAL | 同 R4（通知列表进入实测正常，深层通知语义未扩展） |
| B14/B16 | 视频 HD-first/预热/单视频协调 | PARTIAL | **如实新增缺口**：R4 PoC 亦未含 hls.js 策略（由 X 原生承载替代）；Native M1 不打包 hls.js，视频由 X 原生播放器承载——与 R4 判定口径一致，非 M1 新降级 |
| C2 | 评论排序 | PARTIAL | 原生无排序 UI，维持用户决策项 |
| D1/D6 | 自动翻译 | PARTIAL | **如实声明**：R4 PoC 无翻译；Native M1 亦无（M2 范围）。翻译开关在 X 设置侧不受影响。Legacy 翻译功能完好 |
| B16 类 | popup/设置界面 | PARTIAL | **如实新增缺口**：Native M1 无 popup（M1 范围=阅读底座）；Legacy popup 完好 |

## 未与原版等价的功能清单（用户决策点，继承 R4 六项 + 新增声明两项）

1. 交互模型（导航替代浮层；关闭有一次信息流重挂，锚点已由 B3 收敛至 ≤2px）
2. T2 评论首读 +0.7–1.3s（X 原生渲染节奏，架构性取舍，用户决策项）
3. C2 评论排序降级
4. B14/B16 视频策略由 X 原生承载替代（实测起播不劣于裸 X）
5. C15 回复后展示位置遵循原生
6. D1/D6 自动翻译开关位于 X 设置（Native 翻译能力 M2 范围）
7. **（新增声明）Native 无 popup/设置 UI**（Legacy 有）——M1 范围决策，非静默降级
8. **（新增声明）Native 无 Legacy 的"不跳转浮层"交互**——与 1 同源，单列以便检索

## 83 项行不减声明

本矩阵只列变化行；未列出的 R4 矩阵行（83 项合同 + N1–N4）在 M1 中维持 R4 判定。
Legacy 承载全部 83 项且构建/测试/活体冒烟通过（G1/G10 证据见
`m1-build-isolation.md`）；Native 承载 R4 PoC 已验证的机制子集并完成工程化。

## M1 新发现（对后续轮次有价值的平台事实）

- **Chromium 不向隔离世界投递 Navigation API `navigate` 事件**（监听可注册、事件
  永不到达；`entries()` 读取不受影响）。R4 G0-B 的"事件驱动"实测延迟 1–2ms 实由
  点击级联承担。M1 已把锚点捕获迁到捕获阶段点击监听（不依赖该事件），并在
  `tests/native/native-anchor-live.test.mjs` 固化。**意义**：未来任何依赖 navigate
  事件的 isolated-world 设计都不可行，需以点击捕获/轮询兜底。
- X 详情页点照片当前进入 `/photo/1` 路由（aria-modal dialog），不再是
  `data-testid="lightbox"`——Esc 归属守卫同时覆盖 `lightbox` testid 与
  `[role="dialog"][aria-modal="true"]` 两种形态（P2-2 守卫实测有效）。
