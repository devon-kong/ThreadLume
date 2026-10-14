# M2-B2-A-L4 — 测量修复（measurement-fixes）

本轮修复了三类测量与身份识别缺陷，全部先在离线测试中钉住，再在真实浏览器中验证。

## 1. 构建身份识别（S1，P0）

### 缺陷

旧测量器用 `window.__peekNativeTest` 判断产物身份。两个问题：

1. 该对象只在 `__PEEK_NATIVE_TEST__` define 为真时暴露——真实扩展构建从不启用；
2. 它位于 ISOLATED world，`page.evaluate()`（MAIN world）永远读不到。

因此真实扩展必然被误判，L4 身份守卫形同虚设。

### 修复

- `scripts/artifact-prologue.mjs`：构建期生成 **Build ID**（`<mode>-<YYYYMMDDHHMM>-<sha256前10位>`）与模式标签，把一段非敏感、只读的身份标记 prologue 注入 `content.js` 顶部。content script 求值时把 `{build, mode}` 写入共享 DOM：`<html data-peek-artifact='{"build":…,"mode":…}'>`。
- **双实现冲突检测**：第二个 Peek 构建注入同一文档时，标记变为数组——测量器读到大数组即拒绝采样（离线测试 P2 钉住语义；实机只装了一个 Peek，数组形态未出现）。
- **仅测试构建携带**：lab 构建始终注入；默认构建仅在 `PEEK_BUILD_DIAG=1` 显式构建测量副本时注入；pristine 默认产物无任何标记（测试 P7 钉住）。冻结的 b1r 基线用 `scripts/stamp-artifact.mjs` 对暂存副本补标，基线目录本体未动。
- **非敏感**：只有构建哈希与模式标签；不含凭据、URL、页面内容。**明确不作为安全边界**——同源页面脚本可改写它，任何安全相关逻辑不得依赖（与 M2-B1-R「correlation is not authentication」同一原则）。
- 测量器 `artifactOk()` 改读共享 DOM 标记：m2a/b1r/m1r 要求单对象且 mode 相符；native 要求标记**不存在**。

### 实机验证（identity-check.mjs，7 项）

> 注：identity-results.json 中 run1（m2a）的 V4 显示 pass:false——那是 V4 脚本一个已修复的实现缺陷（`harnessVerdict` 忽略参数、误用闭包期望值）产生的假阴性，修复后 run2 起全部通过；run1 的其余五项检查不受影响，保留在文件中作为修复过程记录。

| 检查 | m2a | b1r | m1r | native |
|---|---|---|---|---|
| V1 标记存在且模式正确（native：不存在） | PASS | PASS | PASS | PASS |
| V2 页面刷新后仍正确 | PASS | PASS | PASS | PASS |
| V3 扩展 Reload + 刷新后仍正确 | PASS | PASS | PASS | PASS |
| V4 错误模式采样被拒绝 | PASS | PASS | PASS | PASS |
| V5 单实现运行（无冲突标记、无重复根） | PASS | PASS | PASS | PASS |
| Build ID（与 chrome://extensions 显示名交叉核对） | `m2a-…-29fc210ac2` | `b1r-…-3a3017ded3` | `m1r-…-58889092e7` | — |

负对照也留了实机记录：加载 m2a 产物时按 b1r/native 期望运行检查，全部正确地拒绝（identity-results.json 前几条 run）。

chrome://extensions 显示名交叉核对：m2a/b1r 阶段显示 "Peek Native (M2-B1 Lab) 0.10.0"，m1r 阶段显示 "Peek Native (M1) 0.9.0"——与各产物 manifest 一致。

## 2. 性能时间轴（S2-A）

### 缺陷 1：t0 晚于扩展的同步提取

旧测量器的点击监听注册在 **document 捕获**、且晚于扩展注册——同一节点同阶段按注册顺序触发，扩展的捕获处理器（同步提取+挂载）先跑完，t0 才被记录，扩展耗时被整体隐藏。

**修复**：t0 改记在 **window 捕获**——传播路径上 window 严格先于 document，无论注册顺序。离线测试 `perf-clock.test.mjs`：document 级监听器复现「50ms 停滞被隐藏」（C1），window 捕获恢复完整包含（C2/C3）。

### 缺陷 2：rAF 采样链在空闲页面上冻结

实测（逐帧探针 + 100ms 轮询对照）：文本/图片类时间线上，合成器长时间不产帧，rAF 1.4 秒只触发 2 次——预览 3ms 挂载、365ms 才被首次观察到，t1a/t1b 被整体虚高、T1c 帧计数恒为 0（视频样本因播放持续产帧而正常）。

**修复**：采样链改为**有界 4ms 定时器链**（30s 上限，只采样不写页面）。修复后同页面同操作：t1a 稳定在 22–81ms。dupFrames 等帧计数语义变为「4ms 采样近似」（测量器 note 字段已声明，rAF 本就只是绘帧近似；视觉证据由截图与录屏承担）。

### 50ms 可控延迟验证（S2-A 要求）

构建 `PEEK_DIAG_DELAY_MS=50` 产物，实测 **4 轮（14 个有效样本，2 次 video 点击未命中如实 skip）**：

| | 无延迟（对照，1 轮冒烟） | 50ms 延迟构建（4 轮） |
|---|---|---|
| diag.extractMs（提取→挂载耗时） | 1.1–2.3ms | **51.0–51.4ms** |
| t1a 中位数 | 72.5ms | 117.5ms（+45ms ≈ 注入量） |

测量确实包含扩展处理器内的同步开销。副作用（如实记录）：捕获阶段 50ms 停滞同样推迟了 X 自身导航约 50ms（t1b 同步 +40~50ms）——符合预期，因为停滞在 X 的处理器之前。

### 诊断分解戳（diag 构建）

`data-peek-capture-at`（扩展捕获处理器入口）与 `data-peek-mount-at`（overlay 入 DOM）单写者属性，仅诊断构建注入。实测 **captureDeltaMs = 0.0–0.2ms**（window 捕获 t0 与扩展处理器入口零偏移），extractMs 1.2–2.3ms——t1a 分解为「捕获→提取→挂载」三段，扩展自身成本约 2ms。

## 3. 统一指标与资源归因（S2-B）

`docs/m2-b2-a-l4/evidence/perf.mjs` 相对上一轮的增量：

- **T1c 新增** textJumpPx（预览文本块 vs 原生焦点帖文本块的位移）与字体对照；
- **资源桶**（只记 host 家族 + 计数/字节数/缓存命中，**不记 URL、queryId、认证材料**）：`gqlDetail / gqlOther / rest11 / xOther / mediaImages（含缓存命中拆分）/ videoMedia / crossOrigin`；
- **crossOrigin 桶即“扩展主动私有 API 计数”**：扩展无法发起 fetch（构建期扫描禁止），任何跨源请求都归因于页面自身。四模式实测 m2a/b1r/native 均为 **0**；m1r 出现 1 次（页面自行加载的第三方资源，与扩展无关——m1r 同样被构建扫描禁止 fetch，但该桶按 host 无法进一步归因，测量局限已如实记录）;
- **native 模式 t4**：扩展关闭后关闭按钮为 X 原生返回，语义一致；
- 失败点击重试从 8s 空等缩至 2.5s（X SPA 提交在点击任务内）。

## 4. 扩展源码修复（S6，依据实机证据）

| 修复 | 级别 | 证据 |
|---|---|---|
| ctrl/meta/shift/alt 与非主键点击不再挂载预览 | P1 | 实测 shift+click 曾挂载 1.2s 超时才清理的预览；修复后实机复测无预览（coverage shiftclick/ctrlclick PASS），离线测试 6 项钉住 |
| mountPreview 挂载序列异常时彻底丢弃已武装状态（无孤儿 overlay、无未清理定时器） | P3（S3 特别检查） | `native-preview-mount-failure.test.mjs` M1–M4 |
| 构建身份标记 + 诊断戳（上述） | P0 | 本文 §1/§2 |

60ms 重试节奏判定：本轮**无证据触发回退**——T1b 无退化（见 performance-comparison.md）、无安装失败、MAIN/ISOLATED 消息异常未见增多、无布局抖动，维持 60ms × 50。

## 5. 回归

- `tests/native/*.test.mjs`：**213 通过 / 0 失败**（含 4 个新测试文件）；
- `npm test`（Legacy/demo 全量）：通过；`npm run test:sites`：通过；
- 测量结束已恢复 pristine 默认产物 + lab 官方产物（含标记，属 lab「实验构建」允许范围），扩展已重新启用并验证身份。
