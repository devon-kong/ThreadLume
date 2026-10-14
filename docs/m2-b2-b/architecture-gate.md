# M2-B2-B — 独立 Reviewer 最终结论（architecture-gate）

Reviewer：独立 agent（与执行方隔离，未参与本轮实现）；2026-10-14。
审查对象：`da0428d`（L4 稳定点）→ `196509f`（首轮交付）→ `52c239e`（S3/S4 修复轮），分支 `feat/peek-native-m2b2b-ui`。本文件包含**两轮独立复核**：首轮（196509f）与修复轮（52c239e）。

审查方式（全部为 Reviewer 自行重算/实测，不接受 md 转述）：

1. `git diff` 全量阅读（源码 + 测试 + 文档）；`git status` 干净；`adapter-core.js` 取各 commit 的 sha256 对比；
2. 自行重建并复跑：`npm run build:native:lab && npm run build:native && node --test tests/native/*.test.mjs`；
3. 把 L4 源码用 `git archive da0428d` 落到 `/tmp/l4check` 独立重建（未触碰仓库工作区），用于哈希/包体对照；
4. 原始 JSON 用自写脚本重算（中位数、逐样本、逐目标、handoff、labIntegrity、resources、diag、wrapper/idle）；
5. 真实浏览器独立验证（ego-browser TaskSpace 22 / page p1，真实已装载产物，CDP 真实指针事件，截图自存 `/tmp`，像素用 sharp 抽样）；
6. 截图抽看（本轮 shots + L4 shots 对照）。

未修改仓库内任何文件；仅创建/更新本文件。按任务书要求重建了 `dist-extension-native{,-lab}`（生成物、gitignore）；两轮重建的 lab 产物 content hash 均与执行方测量产物逐字节一致。

## Gate 表（15 项，含修复轮修订）

「首轮」= 196509f 判定；「修复轮」= 52c239e 复核后判定（**加粗**为相对首轮有变动）。

| Gate | 首轮 | 修复轮 | 独立证据（修复轮为准） |
|---|---|---|---|
| G1 L4 核心架构未被破坏 | PASS | PASS | 修复轮 diff 仅 2 个源文件（`controller.js` 1 行、`reader-skin.js` 77 行）且全为着色/层叠；实盘双栏、独立滚动、关闭路径全部通过；`adapter-core.js` sha256 三轮相同 |
| G2 左栏唯一完整原生焦点帖 | PASS | PASS | 实盘 `focalCount=1`；四帖样本 `focalCount=1`；修复轮四个 fourposts 记录含 `preview.id` 与目标一致 |
| G3 右栏原生评论与分页正常 | PASS | PASS | 首轮实测 cells 23→31 / 右栏 article 11→15；修复轮未触碰 cell 几何（`skinCss` 几何块逐字未变） |
| G4 原生视频深滚仍保持挂载 | PASS | PASS | retention 代码字节相同（`adapter-core.js`）；修复轮最终场次 `videoIdentityAfterDeepScroll.sameElement` 4/4 true；视频场景深滚 687ms 后 `stillConnected/inFocal/timeAdvanced/playingAfter` 全 true |
| G5 预览与原生接管视觉连续 | PASS | PASS（口径需修正） | Reviewer 实盘 4ms 采样：预览卡 `16,68,659×652`（首 tick 52.3ms、末 tick 412ms）与 pinned 卡 `16,68,659×652` 完全一致 → dx/dy/dw=0/0/0；**settled 文字位移 = 0**（预览 `.ppl-text` y=135 vs pinned `tweetText` y=135）。原始 JSON 的 `textJumpPx=-26`、`dupFrames=1` 是采样窗口口径（见 §7.4），文档表述与原始文件不符 → P2 |
| G6 无新增私有 API 主动调用 | PASS | PASS | 修复轮零 JS 网络/接口改动（仅 CSS 文本与一个变量名）；隔离扫描 P3 复跑通过；manifest 零权限零 background |
| G7 未扩大 React 内部包装范围 | PASS | PASS | `adapter-core.js` sha256 `4e350eb7…6c0f3` 在 da0428d/196509f/52c239e 完全相同；`wrapper.wrappedOwnProperty=true`；`perCallUs` 0.43/0.47/0.73（同字节代码，差异为测量噪声） |
| G8 UI 视觉质量明显改善 | PASS | PASS | 像素抽样（Reviewer 自截图，sharp）：浅色卡片/右栏 `255,255,255`、缝隙 `228–234`（含卡片阴影）、顶栏条带 `238,241,244`（=画布 #edf1f4）；深色卡片 `0,0,0`、缝隙/顶栏 `≈#0b0e11`。首轮"整屏被压暗到 238"的问题已消失（卡片恢复纯白） |
| G9 不使用原版 Peek 兔子 Logo | PASS | PASS | 修复轮未触碰品牌路径；顶栏仍为 `Peek` 文字 + 2 个细线图标（0 img）；实盘 `#peek-native-pane` 为 null；`brandFree=true` 四样本 |
| G10 浅色和深色主题正常 | PASS | **FAIL（P1）** | 挂载路径正确（深色实测：`html/body/column=11,14,17`、卡片 `0,0,0`、顶栏=画布、radius 16px；浅色恢复），**但"阅读器打开期间主题就地变化"不再跟随**：皮肤的画布规则 `reader-skin.js:123-126` 以 `!important` 覆盖了 `theme-adapter.js:6 readTheme()` 所读的 `body` 计算背景（X 用**内联样式**设置该背景，实测 `body.style=background-color: rgb(255,255,255|0,0,0)`），因此调色板被冻结在挂载时的主题。实测：内联改黑后 `--peek-lad-bg` 仍为 `#ffffff`（首轮同法可翻转 7 个变量）；卸载重挂后正确跟随。离线 K2/D4 之所以仍通过，是因为 jsdom 不实现样式表层叠（jsdom 探针：内联值胜出 → 读出 `rgb(0,0,0)` → 判定 dark），真实浏览器中 `!important` 胜出 → 读到画布色 |
| G11 图片、视频、菜单、弹层、Esc 正常 | PASS | PASS | 修复轮灯箱实测：顶栏 `display:none`（`:has([data-testid="swipe-to-dismiss"])` 生效，命中节点数 2）；X 原生关闭键 `(12,12)-(48,48)` → 中心 `(30,30)` `elementFromPoint` 命中其自身 `path`、不在顶栏内；真实指针点击后灯箱关闭、顶栏自动恢复 `flex`、阅读器仍 `active`；重开后 Esc 只关灯箱、顶栏同样恢复；无灯箱时（含视频页）该 testid 命中数 0、顶栏 `flex`（无假阳性）。菜单/HoverCard 不侵入顶栏条带（几何 + 层叠关系分析），未受影响 |
| G12 性能满足 L4 非退化标准（配对口径） | PASS | PASS | Reviewer 重算最终配对（16/16 vs 16/16）：T1a 28.0 vs 27.5（+0.5）、T1b 415.0 vs 405.5（+9.5 ≤50）、T2b 1249.5 vs 1216（+33.5 ≤160）、T4a 78.85 vs 69.1（+9.75）、T4b 767.65 vs 817.8（−50.2）；T1a 28.0 ≤100ms 且优于历史 34.0。同一 L4 bundle（`29fc210ac2`）在 21:32 场 78ms、22:21 场 27.5ms → 漂移归因成立（见 §7.5） |
| G13 关闭和异常恢复正常 | PASS | PASS | 实盘两条关闭路径零残留（见 §7.3）；loops 5/5（每轮 `pvLeftover=false`、`focalLeftover=0`、`chromeLeftover=false`、geom 0/0/0）；关闭后 `body` 背景回到 X 自身 `255,255,255`、`--peek-lad-page` 清空（画布无残留） |
| G14 Legacy/M1-R/L4 回退完整 | PASS | PASS | 修复轮 `extension/ worker/ src/ scripts/ tests/sites-worker.test.mjs native-extension/manifest.json` diff 为空；稳定标签 `stable/peek-native-m2b2a-l4-20261014` → 97c70ea；默认 M1 carrier 产物重建可用 |
| G15 真实 MV3 核心验收通过 | PASS | PASS | 实盘产物 `m2a-202610141355-67400c3215`（Reviewer 重建 `…1425-67400c3215`，content hash 一致）；完整生命周期（列表点击→预览→接管→返回/原生视图）实盘走通；零权限、无 background、无残留 |

## 1. 源码与 diff 核验（两轮）

- 首轮（`da0428d..196509f`）：新增 `reader-skin.js`，`controller.js` 挂载接线 + 主题变量扩展，`preview-layer.js` 几何/配色同源；**`adapter-core.js` 零改动**（sha256 相同）。
- 修复轮（`196509f..52c239e`）：`controller.js` 仅 `--peek-lad-backdrop` → `--peek-lad-page` 一行；`reader-skin.js` 移除覆盖层节点、画布规则、顶栏 `z-index:60→1` 且底色改为画布色（并去掉 hairline）、新增纯 CSS `:has([data-testid="swipe-to-dismiss"])` 让位规则、`SKIN_THEME_VARS` 由 `backdrop` 改为 `page`、`SKIN_BACKDROP_ID` 及其节点创建/清理全部删除。**布局尺寸、几何变量、JS 路径（除一行变量名）未改**；`:has()` 选择器定位 X 图片灯箱的 `swipe-to-dismiss` 容器，仅在灯箱存在期间隐藏顶栏，语义合理且无 JS 监听器。
- 两轮均无 DOM 移动/克隆、无 iframe/隐藏标签页、无 `body/html` overflow 写入、无凭据/网络代码；皮肤挂载仍在 `try/catch` 内，失败即回退 L4 基线；`removeLayout()` 无条件先清皮肤与 chrome。
- 遗留的注释不一致（P3，不影响运行）：`reader-skin.js:22` 注释写"top bar sits at z-index 0"而 CSS 为 `z-index: 1`；`evidence/experience-checks.mjs:327-329` 仍描述"skin chrome stays at z 50/51, below X's layers"，与当前 `z-index:1 + :has 让位` 机制不符。

## 2. 离线测试（Reviewer 重建复跑）

| 命令 | 结果 |
|---|---|
| `npm run build:native:lab`（52c239e） | 成功；`Artifact identity: build m2a-202610141425-67400c3215`，**content hash `67400c3215` 与执行方最终产物一致** |
| `npm run build:native` | 成功（M1 carrier，无 MAIN world 文件） |
| `node --test tests/native/*.test.mjs` | **222 pass / 0 fail**（首轮同为 222/0） |

- K1/K2/K4 已按画布方案改写（无覆盖层节点、画布规则存在、`:has` 规则存在、`z-index: 1`、`--peek-lad-page` 变量）；K9 几何单源断言不变。D4 的 `writes = before + 7` 仍成立（`skinPalette` 8 键中 7 键深浅有别，`accent` 不写；`--peek-lad-top` 不变被跳过）。
- **测试能力缺口（与 P1 同因）**：K2/D4 依赖"改 body 背景 → 调色板翻转"，而 jsdom 不实现样式表层叠——Reviewer 用 jsdom 探针复现：注入 `body { background-color: #edf1f4 !important }` + 内联 `rgb(0,0,0)` 时，jsdom 的 `getComputedStyle(body)` 返回内联值（`rgb(0,0,0)` → 判 dark），真实浏览器返回画布色。因此该断言在真实浏览器中已不再代表实际行为。

## 3. 产物身份与隔离（修复轮）

- 实盘 `<html data-peek-artifact>` = `m2a-202610141355-67400c3215`；lab `content.js` 含皮肤与 `:has` 规则；`layout-adapter-main.js` 不含皮肤字样；默认 carrier 产物仍含 adapter/皮肤字符串（L4 同类既有现象，编译期常量门 + P4 行为测试保证零注册；本轮未变，登记为下轮事项）。
- manifest 未改：零 `permissions`、零 `host_permissions`、零 `background`；lab 独有 MAIN world 入口。

## 4. 体验原始记录（修复轮）核验

- `experience-results.json` 新格式 `{generatedAt, buildId, history, records}`：`buildId=m2a-202610141355-67400c3215`，15 条 records 全 `pass=true`（含 `fourposts` 四个样本 **首次真正走通预览路径**：`onFrames` 63/62/63/57、`preview.id` 与目标一致、geom 0/0/0）。
- `history` 6 条如实记录，且**标注了失败性质**："harness assertion mismatch (superseded expectations: topbar z / theme body-bg vs canvas) — corrected in the same round; the product state in that run was already correct"。即失败来自 harness 断言未同步（非产品缺陷），并说明同轮已修正断言——如实，但意味着 harness 在本轮被修改过（见 P3-e）。
- 场景细节复核：loops 5/5（零残留、geom 0）；lightbox `closeProbe{found,clickable:true,coveredByTopbar:false}` + `closeClicked:true` + `afterEsc{dialogGone,onDetail,focal:1,state:active}`；四个 fourposts `pageCanvas.dimmed=true / topbarZ="1" / overlayNodeAbsent=true / brandFree=true / hOverflow=false`；viewports 800px → `split=false, topbar=none, pos=relative`；narrow `onFrames=0, focalCount=0, state=idle`；topbarback/nativeview/reload 与文档一致。
- 截图抽看：`lightbox-3-zfix.png` 确认灯箱期间**顶部 52px 条带不再有 Peek 顶栏**、X 原生关闭键位于最上层；`theme-2-native.png`、`viewport-*`、`fourposts-*-2-native.png` 确认画布/卡片分离与几何真实。

## 5. Reviewer 的验证与修复轮结论（逐项）

| 修复项 | Reviewer 判定 | 实测证据 |
|---|---|---|
| 1. 暗化改为页面画布（删除覆盖层） | **有效** | 浅色 `html/body/primaryColumn = rgb(237,241,244)`、卡片与右栏 cell `rgb(255,255,255)`、顶栏=画布；`#peek-reader-backdrop` 不存在；像素抽样卡片 255（此前整屏 238）；深色同理（`#0b0e11` / `#000`）；关闭后画布无残留 |
| 2. 顶栏 `z-index:1` + `:has` 灯箱让位 | **有效** | 见 G11；灯箱开启 `bar display:none`、原生关闭键 `elementFromPoint` 命中且真击可关、关闭后自动恢复、Esc 路径一致；无灯箱时无假阳性 |
| 3. P2-1 样本数表述修正 | **已修正** | 文档改为"两场各 16/16"，Reviewer 重算确认最终两场各 16/16、零 skip（首轮曾为 15+1） |
| 4. P3-2/P3-4 措辞、T4b 措辞、`#layers` 层叠表述 | **基本已修正，但仍有两处与原始 JSON 不符** | `#layers=z-index:1` 已写入文档；T4b 已下调；样本数已改。**未修正**：`dupFrames`（原始 JSON 新 UI 16/16 为 1）、`textJumpPx`（原始 JSON 16/16 为 −26）——文档仍写 "0/0/0"、"文字 dy 0（全部）"（详见 §7 的 P2-1/P2-2） |

## 6. 性能独立重算（最终配对，Reviewer 数值）

| 指标 | L4 历史 17:06 | L4 配对 22:21 | M2-B2-B 最终 22:16 | 配对差 |
|---|---:|---:|---:|---:|
| T1a | 34.0 | 27.5 | 28.0 | +0.5 |
| T1b | 375.5 | 405.5 | 415.0 | +9.5 |
| T2b | 1599 | 1216 | 1249.5 | +33.5 |
| T4a | 63.25 | 69.1 | 78.85 | +9.75 |
| T4b（stable） | 1369.8 | 817.8 | 767.65 | −50.2 |

- 与 `performance-comparison.md` 的五个核心数字**逐格一致**；逐目标 T1a 中位数（新 UI video 35.5 / photos 26.5 / text 26.5 / highcomments 28 vs L4 30.5 / 26 / 26.5 / 28.5）亦一致，无样本被遗漏。
- **漂移归因（Reviewer 独立加证）**：历史场与配对场跑的是**同一份 L4 bundle**（逐样本身份 `29fc210ac2`，Reviewer 用 `/tmp/l4check` 重建再次复现该 hash）；同一 bundle 在 21:32 场 T1a 中位 78ms、22:21 场 27.5ms，故 34→27.5 的差异是环境而非代码。扩展内部 `extract→mount` 中位：前置场 1.0ms、最终新 UI 1.35ms、最终 L4 1.75ms（新 UI 不快于不慢于同窗基线，均 ≪ 43ms 缺口）。
- T4b：逐目标中位（新 UI vs L4）video 636/636、photos 837/823、text 868/818、highcomments 671/837 —— 两慢两快、整体中位偏向新 UI 50ms；单场离散由前置场的 ~2.0s 收窄到本场 ~0.27s，故"无退化"结论稳固，但"快 50ms"仍在残余噪声量级，宜表述为"无退化（差异在噪声内）"。
- handoff（Reviewer 重算）：`blankLeftFrames=0`、`leftoverPreviewFrames=0` 两场全 0；`dupFrames` 新 UI 16/16=1、L4 配对 14/16=1（r3 photos/text 为 0）；`articleJumpPx` 新 UI 全 `{0,0}`、L4 配对 14/16=`{0,0}`；`textJumpPx` 新 UI 全 −26、L4 配对 {−11,−1,0}。这些字段的口径问题见 §7.4，**不代表可见缺陷**（Reviewer 实盘 settled 文字位移 = 0、卡片刻度 dx/dy/dw = 0）。
- 其余：`hOverflow` 两场全 false；idle 长任务 0；深滚长任务 0；`videoSame` 4/4；`resources` 桶内 `mediaImages` 全为缓存命中 0 字节（新 UI 计数 1–17），`videoMedia/rest11/xOther` 为 X 自身请求，无扩展发起桶（源码零 fetch/XHR、manifest 零权限）；`wrapper.perCallUs` 0.73（新 UI）/0.47（L4 配对）；堆与 DOM 同量级。

## 7. 修复轮独立发现的问题与处置建议（分级）

**P0：无。**

**P1（1 项，功能回归，建议本轮修复预算内解决）**

1. **画布规则遮蔽了主题信号：阅读器打开期间主题就地变化不再跟随（G10 FAIL）。**
   - 来源与证据：`reader-skin.js:123-126`（`html`/`body`/`primaryColumn` 的 `background-color: var(--peek-lad-page) !important`）+ `theme-adapter.js:6`（`readTheme()` 读 `getComputedStyle(document.body).backgroundColor`）+ `controller.js:455` 附近（属性观察者触发 `applyAdapterTheme`）。实盘：阅读器 active 时把 body 内联背景改黑 → `--peek-lad-bg` 仍 `#ffffff`、`--peek-lad-page` 仍 `#edf1f4`（首轮构建同法可翻转 7 个变量，已验证对比）；`html` 上 `color-scheme`/`data-theme` 变更同样无效；`原生视图` 释放后重挂载则正确跟随（`#000`/`#0b0e11`）。X 的机制已实测：`body` 内联 `background-color: rgb(255,255,255)`（浅）/ `rgb(0,0,0)`（深），`html` 内联 `color-scheme: light`。
   - 可达性（如实）：X 自身的显示设置是独立路由（`/settings/display`），进入即触发 `offRoute` 卸载阅读器，因此**常见设置路径不受影响**；跨标签页同步在本构建实测未传播；受影响的是任何"阅读器保持挂载时的就地主题变更"（系统/自动主题、X 未来版本的就地更新）。因此影响面窄，但它是真实回归且使 L4 已验证的"主题镜像"能力在真实浏览器中失效。
   - 测试缺口：K2/D4 在 jsdom 下仍通过（jsdom 不实现层叠），已在 §2 复现证明；**必须补一条真实浏览器断言**（就地改 body 背景或带阅读器切换主题后 `--peek-lad-bg` 翻转）。
   - 建议修法（任一，均小改）：① `readTheme()` 优先读 X 自己的、皮肤不拥有的信号——`document.body.style.backgroundColor`（本构建为内联）或 `document.documentElement.style.colorScheme`，再回退到计算值；② 画布规则不再写 `body`（改为 `html` + `body{background:transparent}` 并依赖 ①的信号）；③ 主题观察者回调时临时禁用画布规则再读一次计算值（较 hacky，不推荐）。

**P2（2 项，文档与原始数据矛盾，须修正）**

1. **`performance-comparison.md:32` "dupFrames / blankLeftFrames / leftoverPreviewFrames = 0 / 0 / 0"** 与原始 JSON 不符：最终新 UI 16/16 样本 `dupFrames=1`（L4 配对 14/16=1）；`blankLeftFrames`/`leftoverPreviewFrames` 确为 0。第 47 行"视觉交接零重复帧"同此。
2. **`performance-comparison.md:33` "文字块位移 dy = 0（全部）"** 与原始 JSON 不符：最终新 UI 16/16 样本 `textJumpPx.dy = −26`（L4 配对 −11/−1/0）。Reviewer 实测的**可见**位移为 0（预览文字 y=135 == pinned 原生文字 y=135），但文档必须按原始字段表述并说明口径（见 §7.4），否则与它引用的证据文件直接冲突——这正是首轮 P2-1 的同类问题。

**P3（5 项，记录/精度）**

- a. `visual-qa.md §1` 的 theme 行仍在引用**已删除的覆盖层**："body/focal/顶栏 #000，backdrop rgba(231,233,234,0.05)"——最终构建的画布是 `rgb(11,14,17)`，`backdrop` 已不存在。
- b. `visual-qa.md §4` 的失败汇总仍是首轮内容（"fourposts:video 两次点击未进入预览…其余首次即通过"），与修复轮 `history`（6 条 harness 断言不同步失败、fourposts:video 已首次走通预览）不一致。
- c. `performance-comparison.md:24` 的 diag 表述不准：`captureDelta ≤0.1ms` 实际最大 0.4ms（最终新 UI）；`extract→mount 中位数 0.9–1.5ms` 实际中位 1.0（前置）/1.35（最终新 UI）/1.75（最终 L4）；方向性结论（新 UI 不慢于同窗基线）成立。
- d. `evidence/perf.mjs:537` 仍探测已不存在的 `peek-reader-backdrop`（恒为 false），字段名与含义脱节；建议与体验 harness 对齐为 `overlayNodeAbsent` 并补一条画布断言。
- e. 透明度：修复轮同轮修改了 `experience-checks.mjs` 的期望值（`topbarZ==="1"`、`body!==card` 形式的"画布已暗化"断言），且 `pageCanvas.dimmed` 只比较"body≠card"，即使回到旧的覆盖层方案也会通过；`history` 已如实标注这一点（值得肯定），但断言强度建议提升（例如同时断言 `--peek-lad-page` 计算值与 `overlayNodeAbsent`）。

**非缺陷澄清（Reviewer 观察）**

- 接管瞬间存在一个短暂窗口：MAIN world 先给焦点 article 打标记、ISOLATED 侧随后才挂 split 并释放预览（首轮已记录契约）。在该窗口内 harness 可能读到"未 pin 的原生 article（x≈308–324、文字 y=109）"。Reviewer 4ms 采样在最终构建中仍未观测到任何"既无预览也无焦点卡"的空白 tick；用户的可见结果为零位移、零重复阅读器。

## 8. 与执行方文档不一致之处（修复轮）

| # | 文档 | Reviewer 核验 | 级别 |
|---|---|---|---|
| 1 | `performance-comparison.md`：dup/blank/leftover = 0/0/0 | 原始 JSON：dup=1（新 UI 16/16） | P2-1 |
| 2 | `performance-comparison.md`：文字 dy 0（全部） | 原始 JSON：−26（新 UI 16/16）；可见位移实测 0 | P2-2 |
| 3 | `visual-qa.md` theme 行仍写 backdrop 值 | 覆盖层已删除 | P3-a |
| 4 | `visual-qa.md` §4 失败汇总与 history 不符 | history 为 harness 断言不同步 6 条 | P3-b |
| 5 | `performance-comparison.md`：captureDelta ≤0.1ms / extract 中位 0.9–1.5ms | 实际 ≤0.4ms / 1.0–1.75ms | P3-c |
| 6 | 五核心指标、逐目标 T1a、loops 5/5、灯箱断言、viewports、narrow、身份守卫 | **全部吻合** | — |

## 9. 最终判定：**CONDITIONAL GO**

修复轮的两项核心变更经 Reviewer 独立实测**确实修好了首轮的缺陷**：覆盖层压暗卡片/右栏的问题消失（卡片恢复纯白，画布承担暗化），灯箱原生关闭键不再被顶栏吞掉（`:has` 让位 + 真击关闭成功），P2-1 样本数表述已修正，性能配对指标与文档一致且无退化。G1–G9、G11–G15 全部 PASS。

但修复轮**引入了一项功能回归**：画布规则以 `!important` 覆盖了 `readTheme()` 所读的 `body` 背景，导致"阅读器挂载期间的主题就地变化"不再跟随（G10 **FAIL**），且离线 K2/D4 因此在 jsdom 中变成"假通过"。影响面经实测较窄（X 的设置路径会卸载阅读器），但这是真实回归且当前测试无法发现，故不能给 GO。

放行条件（执行方剩 1 轮修复预算）：

1. **必须**（P1）：修复主题信号的读取（建议 `readTheme()` 优先使用 X 自身的内联信号 `body.style.backgroundColor` / `html.style.colorScheme`），并**新增一条真实浏览器的就地主题切换断言**（jsdom 无法覆盖此类层叠遮蔽）；修复后 G10 可改判 PASS。
2. **必须**（P2）：按原始 JSON 修正 `performance-comparison.md` 的 `dupFrames`（1）与 `textJumpPx`（−26）表述，并写明该字段的采样窗口口径（MAIN 先打标记、接管前窗口）。
3. 建议（P3）：清理 `visual-qa.md` 中已删除的 backdrop 表述与过期的失败汇总；修正 diag 数值；`perf.mjs` 的 `backdrop` 字段改为 `overlayNodeAbsent` 并补画布断言；修正 `reader-skin.js:22` 与 `experience-checks.mjs:327-329` 的过期注释。

上述 1、2 完成后即可转为 **GO**；其余为文档/观测口径整理，不阻塞。
