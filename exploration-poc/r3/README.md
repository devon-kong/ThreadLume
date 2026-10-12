# Peek R3 探索目录 — 原生 React 承载的功能完整性与低风险验证

第三轮（R3）探索产物索引。分支 `exp/r1-native-function-validation-r3`，基线 `7c29352a`，原版对照 `c93066f9`。执行日期 2026-10-12。

## 报告

| 文件 | 内容 |
|---|---|
| [r3-exploration-report.md](r3-exploration-report.md) | **主报告**：S0–S6 全程、八问直答、v2→v3 缺陷修复表、诚实边界 |
| [r3-feature-parity.md](r3-feature-parity.md) | 83 项逐能力验收矩阵（PASS 63 / PARTIAL 10 / BLOCKED 0 / NOT_TESTED 10，Reviewer 复核口径） |
| [r3-native-actions.md](r3-native-actions.md) | 三类交互判定（A/B/C）、10 项互动 A 类路径实测、合成事件移除依据、剩余风险 |
| [r3-network-audit.md](r3-network-audit.md) | 原生 vs R1 冷载请求普查（18:18 逐操作一致）、性能对照、五类请求来源 |
| [r3-reading-experience.md](r3-reading-experience.md) | 十场景连续阅读实测、对比指标（口径分开）、PARTIAL 结论 |
| [r3-architecture-gate.md](r3-architecture-gate.md) | S6 独立 Reviewer G1–G9 判定（原文引用）、G9 处置记录、conditional GO |

## 代码与测试

| 文件 | 内容 |
|---|---|
| [../mv3-poc/](../mv3-poc/) | PoC v3（0.3.0）：零 permissions、零 fetch/XHR、原生焦点格保持可见设计 |
| [r3-poc-units.test.mjs](r3-poc-units.test.mjs) | 离线单元测试 4/4（parseCount/fallbackText 真实源码执行） |
| [network-census.mjs](network-census.mjs) | 网络普查可复现载荷（CDP Network 事件法 + 记录结果） |
| [run.sh](run.sh) + [_prelude.js](_prelude.js) | CDP 只读试验 harness（隔离世界注册 + 探针；无 fetch 包装、无凭据采集） |
| [../MV3-LOGIN-VERIFY.md](../MV3-LOGIN-VERIFY.md) | v3 用户检查单（12 项，含第 11 项唯一真实写入，由用户亲手执行） |

## 证据截图

`evidence/`：19 张公开区域截图（无账号菜单/凭据/私信）。关键链：
- 内容类型：s1a-longpost-pane → s1a-article-native（真实 X Article）→ s1a-card-pane → s1c-video-native-cell
- 评论系统：s1b-subreply-expanded（子回复原地展开）→ s1b-ancestor-chain（三层祖先）→ s1b-pagination-end（终止形态）
- 互动路径：s2-hover-card → s2-caret-menu → s2-reply-composer → s2-share-sheet
- 阅读体验：s3-open-from-timeline → s3-reload-state
- v3 效果：s5-v3-video-visible（焦点格可见+视频在播+无空白）→ s5-v3-article（Article 干净提取）
