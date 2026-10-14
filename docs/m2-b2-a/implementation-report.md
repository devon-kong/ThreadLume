# M2-B2-A 实现报告：即时预览与原生接管

基线：`fix/peek-native-m2b1-r` @ `9dd18a8`（M2-B1-R Reviewer GO）。
本轮分支：`feat/peek-native-m2b2a-fast-reading`。

## 1. 本轮改了什么（全部差异清单）

| 文件 | 变更 | 面积 |
|---|---|---|
| `native-extension/src/preview-layer.js` | **新增**。即时阅读预览层（ISOLATED world，仅 lab 构建激活） | 新模块 ~260 行 |
| `native-extension/src/route-observer.js` | 捕获期点击 → `captureClickForPreview`；路由变化 → `previewOnRouteChange` | +2 个调用点、+4 行 import |
| `native-extension/src/layout-adapter/controller.js` | ACTIVE verified 后 `previewAdapterHandoff`；fail/dormant 后 `previewAdapterStopped`；**S6：删除 gen 收养分支**（严格 gen 相等） | +2 个调用点、−6 行收养逻辑、+注释 |
| `native-extension/src/layout-adapter/constants.js` | `LAD_INSTALL_RETRY_MS` 250→60、`LAD_INSTALL_MAX_ATTEMPTS` 12→50（预算不变 3s） | 2 个常量 |
| `native-extension/src/main.js` | 测试钩子暴露 `preview.*` | +10 行 |
| `tests/native/native-lab-preview.test.mjs` | **新增** 16 个生命周期/不变量测试 | |
| `tests/native/native-lab-protocol.test.mjs` | **新增** 6 个协议对抗测试 | |
| `tests/native/native-labr-fix.test.mjs` | A11 语义改写（收养 → 不收养） | |
| `tests/native/native-lab-controller.test.mjs` | E5 重试预算数字更新 | |
| `docs/m2-b2-a/*`、`docs/m2-b2-a/evidence/*` | 本轮报告与 harness | |

**未触碰**：reader-view / reader-lifecycle / focal-extractor / anchor-restore / navigation-session /
adapter-core / manifest / Legacy 构建链路。M2-B1-R 的全部工程底座（唯一原生焦点帖、
`_getFinalRenderedItems` 包装、Residue Lock、article 重绑、主题无环）零修改。

## 2. S1：即时预览的设计

### 2.1 机制

S0 的归因（first-paint-analysis.md §1）：M1-R 的 19–20ms 快路径是"路由变化后提取仍能
找到时间线 cell"的 25% 竞态。预览层把提取从**路由变化后**提前到**点击捕获期**：

1. X 的 handler 尚未运行 → 被点 cell 保证挂载、内容保证是用户此刻看到的；
2. `onCaptureClick`（既有捕获监听器）同步调用 `captureClickForPreview(event)`：
   资格判定 + `extractFromArticle`（复用 M1-R 的纯 DOM 提取器）+ 同步挂载预览浮层；
3. X 正常导航（我们零拦截、零 preventDefault）；
4. 适配器照常 INSTALL→重试→ACTIVE→verified→挂分栏 CSS；
5. 控制器在**同一个任务里**（mountLayout 之后）调用 `previewAdapterHandoff(focusUrlId)`
   → 预览浮层同步移除。首个显示"钉住的 native 焦点帖"的帧就是首个没有预览的帧——
   不存在中间空白帧或双原帖帧。

### 2.2 资格判定（fail-open）

预览只在**全部**条件成立时出现，任一不成立即静默放弃（X 照常导航）：

- 当前 URL 是列表（详情页绝不预览——原生阅读器拥有详情页，M1 边界不变）；
- 视口 ≥980px（与 LAYOUT_CSS 的分栏激活条件一致）；
- 点击目标是 `/status/<id>` 链接；
- 所在 `cellInnerDiv` 的**自有**时间戳链接（不在 `div[role="link"]` 引用卡内）解析到同一 id
  ——引用卡链接、跨帖链接一律不预览；
- cell 内有 article，`extractFromArticle` 成功且 statusId 一致。

### 2.3 预览内容（S1-B 范围）

只使用被点 cell 里用户已经可见的 DOM 数据（与 M1-R 快路径第一帧同源）：
作者行、可见正文（长帖为折叠态，如实呈现）、已显示图片 URL、引用帖摘要、计数、
视频/GIF 的**海报帧 + 明确标注**（"静态预览，原生播放器接管后播放"）。
**从不**：补全请求、React 内部数据、未显示的评论、克隆媒体节点、第二播放器、伪全文。

### 2.4 非互动与无障碍（S1-C）

- `pointer-events: none`——预览在几何上覆盖左栏但**永远不拦截任何输入**，用户对 X 的
  一切操作不受影响（S1-C 第 5 条由构造保证）；
- `aria-hidden="true"` + `role="presentation"` + 零可聚焦元素——屏幕阅读器不会重复朗读，
  焦点序不被打乱（第 10 条）；
- 布局与最终左栏一致：fixed、left 0、top=横幅实测高（54px 回退）、宽 52vw、密度
  15px/20px、主题色与 X 当时所绘一致——接管换的是内容不是布局（S1-C 优先项）。

### 2.5 状态机与身份

`IDLE → PREVIEW_READY → NATIVE_WAITING → (HANDOFF) → IDLE`，全部退化为 CLEANUP → IDLE。
每个预览绑定 `{ statusId, gen }`；gen 单调递增，替换点击使旧 gen 的异步回调全部失效。
无外部状态依赖、无观察器、唯一一个 setTimeout——退出路径见 handoff-lifecycle.md。

### 2.6 重试节奏收紧（250ms → 60ms）

M2-B1-R 的分栏 CSS 只能在适配器 ACTIVE（焦点 cell 出现 + verified）后挂载，重试节奏
决定了"X 以全宽渲染出焦点帖 → 吸附到左栏"这个横向跳动的可见窗口（≤250ms）。预览层
已把左栏遮住，此处进一步把窗口压到 ≤60ms（约 3 帧）。总预算不变（60ms × 50 = 3s），
fail-closed 语义不变。这是本轮唯一的既有常量变更，理由如上，交 Reviewer 复核。

## 3. S6：协议收敛（采纳分支移除）

M2-B1-R Reviewer 非阻塞备注指出：`HEALTH_ACTIVE` 的"任意更高 gen 收养"路径存在页面级
伪造面——同源脚本可伪造 `HEALTH_ACTIVE{gen: s.gen+N}` 使控制器收养 N，随后真实会话的
`HEALTH_ERROR{gen: s.gen}` 被当异代次丢弃，分栏 CSS 泄漏到下次路由变化。

本轮判定**可以取消收养**，依据：

1. M2-B1-R 整改后，MAIN 侧内部重装**延续同一 gen**（`adapter-core.js continuesSession`），
   合法的延续会话通知本来就携带相同 gen，命中严格相等分支——收养从未被正常路径需要；
2. 更高 gen 按定义不是本会话（每会话一个 gen，gen 单调）；若未来出现 gen 漂移，那是
   MAIN 侧缺陷，应当暴露（CSS 在下次路由变化前保留是 fail-visible 的错误状态，且
   health tick 仍会继续上报）而不是靠收养掩盖；
3. 收养的收益（对未知漂移的容错）小于代价（伪造面），且 A10/A11 端到端测试证明
   gen 连续性在真实重装流中成立。

新语义：自主通知必须 `{focusUrlId 相同 ∧ gen 严格相等}` 才被采信；非本会话事件在
active 会话存在时**绝不**触发释放命令（防伪造释放），在非活跃态维持原 stale-release
路径（focus 必须为非空字符串，A12 不变量保留）。

## 4. 验证证据（离线）

全部对**真实构建产物**（dist-extension-native / dist-extension-native-lab）运行：

| 套件 | 结果 | 新增覆盖 |
|---|---|---|
| `tests/native/*.test.mjs` | **190/190**（168 → +16 预览 +6 协议） | 预览全生命周期、不变量、对抗 |
| `npm run test:r3-r` | 75/75 | —（无回归） |
| `npm run test`（主构建） | 119/119 | —（Legacy 隔离无回归） |

16 个预览测试（P1–P15+P9b）覆盖：身份准确、单实例、非互动构造、
READY/WAITING/HANDOFF 三态、路由不匹配清除、路由离开清除、超时清除且不复活、
A→B 替换（gen 递增）、引用卡 fail-open、详情页绝不预览、MAIN 缺失失败即退出、
视频海报不克隆节点、默认构建零预览、停止钩子清理、handoff 身份校验、交接后虚拟
列表分页不变、预览期 X 原生节点零改动。

6 个协议测试（Q1–Q6）：同 gen 重装连续性（正常链路）、伪造更高 gen 不收养且其后续
退出不生效、真实 gen 退出可靠、旧 gen 事件不释放 active 会话、非活跃 stale-release
保持、无焦点伪造不产生无限定释放。

## 5. 诚实边界

1. **预览排版与原生焦点帖的字号差**：预览用时间线密度（15px/20px）；X 详情焦点帖对
   短帖可能渲染更大字号。接管瞬间是"内容升级"而非布局跳动（位置/宽度不变），但字号
   变化可见。按 S1 约束未建排版引擎去模拟 X 的字号启发式——如需消除需扩大对 X 内部
   渲染规则的依赖，交 Reviewer/用户权衡。
2. **点击→X 提交之间的同帧重叠**：预览在捕获期挂载，时间线 cell 在 X 提交后才消失，
   存在毫秒级的"预览 + 列表内原帖"同帧。这是转换过程本身；持续的"双原帖"由 T1c 的
   dupFrames 帧采样在实测中验证为 0（见 performance-comparison.md；无扩展实测数据时
   如实标注）。
3. **离线 jsdom 无布局引擎**：几何类断言是结构性的（marker/样式文本/计数）；真视口
   行为（闪烁、吸附、深滚视频）依赖 MV3 实测——本轮执行环境无法自主加载未打包扩展
   （CDP 域受限、WebUI loadUnpacked 需原生文件对话框），相关列已标注 PENDING-OPERATOR，
   未伪造。
4. 重试节奏常量变更（§2.6）改变了 M2-B1-R Reviewer GO 时记录的时序参数；功能语义
   （有界、fail-closed）不变，测试 E5 已同步。
