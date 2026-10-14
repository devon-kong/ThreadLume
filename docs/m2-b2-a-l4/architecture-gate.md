# M2-B2-A-L4 — 独立 Reviewer 最终结论（architecture-gate）

Reviewer：独立 general-purpose agent（agent_ea6bc77f），与执行方隔离；2026-10-14 完成审查。
审查方式：原始 JSON 逐项重算（非 md 转述）、测量器/场景脚本本体审读、磁盘产物与测试浏览器 Profile（Secure Preferences 扩展路径）独立核验、`node --test tests/native/*.test.mjs` 复跑、`git diff 92e0207..HEAD` 全量阅读。未修改任何文件。

## Gate 表（Reviewer 判定）

| Gate | 判定 | 证据 |
|---|---|---|
| G1 构建身份可靠 | PASS | prologue 语义 P1–P8 钉住；实盘核验 lab 含标记、default/Legacy 无标记、b1r 基线未打标；冲突数组拒绝采样；12 轮身份记录含负对照正确拒绝 |
| G2 真实 L4 安装运行 | PASS | 独立读取 Profile Secure Preferences 确认 unpacked 安装指向本仓库产物；V2/V3 刷新与 Reload 保持；manifest 显示名交叉核对 |
| G3 普通有效点击即时预览 | PASS | perf 16/16 t1a 非空；fourposts 4/4 真实指针；coverage timestamp PASS；正文/空白卡为如实记录的 COVERAGE GAP（fail-open） |
| G4 预览 ID 与内容正确 | PASS | 全部记录 pv.id === 目标且内容非骨架；image/rapid 场景 id 正确 |
| G5 接管无重复无明显闪烁 | PASS | dupFrames 合计 4（消息间隙 DOM 共存；z 序 58<59 视觉被覆盖）；blankLeft=0、leftover=0；textJump ≤1 行；截图无双帖 |
| G6 T1a 达标 | PASS | 重算中位 34.0ms ≤100ms；50ms 延迟构建证明测量含处理器内开销（extractMs 51ms） |
| G7 T1b 无明显回归 | PASS | 375.5 vs 371.0 = +4.5ms ≤ max(50, 37.1) |
| G8 T2 不退化 | PASS | T2a/T2b 均快于 b1r；m1r/native 的 12s 为口径差异非回归 |
| G9 T4 不退化 | PASS | T4a 63.25 vs 63.45；T4 stable 快 403ms；video 样本分布重叠 |
| G10 视频深滚存活 | PASS | perf 4/4 sameElement；experience 真实指针暂停/恢复/全屏/深滚 5000px 全过 |
| G11 零主动私有 API | PASS | crossOrigin m2a/b1r/native 全 0（m1r 1 次为页面自载资源、已披露）；构建期隔离扫描 + isolation 测试；manifest 零权限零 background |
| G12 未扩大内部结构依赖 | PASS | 本轮 diff 对 X 内部结构依赖零新增；诊断戳为编译期消除、默认产物核实无残留 |
| G13 回退完整 | PASS | extension//src//worker/ diff 为空；Legacy/M1-R/B1-R 三产物独立可装 |
| G14 异常状态安全清理 | PASS | mount-failure M1–M4；loops 5/5 无残留；1200ms 兜底；pointer-events:none + aria-hidden 核实 |
| G15 感知体验达到产品化门槛 | PASS | 34ms 预览覆盖整个详情加载窗口；接管 +4.5ms；关闭返回更快；无重复/白屏/残留 |

回归复核：tests/native 213/0；npm test 119 pass；test:sites 4 pass；perf-summary 与 Reviewer 重算一致。

## Reviewer 发现的问题与处置

P1（Review 时指出，已全部处置）：
1. 主题场景过度声明（当时证据仍为浅色）→ **已修复脚本并重测**：真实指针点击主题色块（当前 X 色块无 aria-checked，需按位置选择），深色主题实测走通（rgb(255,255,255)→rgb(0,0,0)，焦点帖背景跟随，截图为深色），随后恢复浅色。experience-results.json 已更新（runLog: xt2）。
2. reload 场景在 chrome:// 页读标记（内容脚本不注入该页）→ **已修复**：标记改在重载后的 x.com 文档读取，实测 mode m2a（runLog: xt）。
3. click-coverage 视频播放表述与最终记录不符 → **文档已对齐证据**（该场景验证安全属性；播放行为由 experience video 场景真实指针验证）。

P2（记录/精度，均已落入文档）：
- identity run1 V4 假阴性已注明（早期脚本缺陷，修复后全过）；
- ctrl+click 的 macOS 平台行为已注明（ctrl 分支空转，语义由离线测试覆盖）；
- bodytext/quotecard 的导航行为表述已对齐最终记录（安全属性以记录为准）；
- 体验观察器环形缓冲口径已注明（性能口径不受影响）；
- t2net/gqlDetail 分桶正则与当前 X 会话操作名不匹配 → 已如实修正表述，分桶修正列为下轮事项；
- delay50 实为 4 轮 14 有效样本 → 已修正表述。

执行方结论被独立确认：**无测量器或脚本层面的作弊**（t0 严格先于扩展处理器、采样只读、skip 不凑数、runLog 取首过运行且失败运行公开汇总、扩展侧无任何为测量提速的代码路径）。

## 最终判定：**GO**

真实 L4 核心流程通过，预览足够快（34ms 中位），原生接管稳定（+4.5ms），视频、评论、关闭返回正常且不劣于 M2-B1-R 基线，零私有 API、零凭据、回退完整、异常可安全清理。P1 三项已在同一分支内处置完毕（复验证据入库）。**允许进入 M2-B2-B 成型 UI 开发。**

L5（用户人工验收）仍应在 Draft PR 上进行，作为最终确认而非门槛。
