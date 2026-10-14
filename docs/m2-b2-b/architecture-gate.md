# M2-B2-B — 独立 Reviewer 最终结论（architecture-gate）

Reviewer：独立 agent（与执行方隔离，未参与任何实现）；2026-10-14。
审查对象：`da0428d`（L4 稳定点）→ `196509f`（首轮交付）→ `52c239e`（S3/S4 修复轮）→ `3a165b2`（P1 修复）+ `d8e7760`（最终配对性能/文档同步）。本文件记录**三轮独立复核**：首轮、修复轮、终校。

审查方式（全部为 Reviewer 自行重算/实测，不接受 md 转述）：

1. `git diff` 全量阅读（源码 + 测试 + 文档 + 原始 JSON 字段）；`git status` 干净；`adapter-core.js` 逐 commit sha256 对比；
2. 自行重建并复跑：`npm run build:native:lab && npm run build:native && node --test tests/native/*.test.mjs`（终校：**223 pass / 0 fail**）；
3. L4 源码用 `git archive da0428d` 落到 `/tmp/l4check` 独立重建，用于哈希/包体对照（未触碰仓库工作区）；
4. 原始 JSON 自写脚本重算（中位数、逐样本、逐目标、handoff、labIntegrity、resources、diag、wrapper/idle）；
5. 真实浏览器独立验证（ego-browser TaskSpace 22 / page p1，真实已装载产物，CDP 真实指针事件，截图自存 `/tmp`，像素抽样用 sharp）；
6. 截图抽看与 L4 对照；launch-free 的 jsdom 探针用于证明测试能力边界。

未修改仓库内任何文件；仅创建/更新本文件。按任务书要求重建了 `dist-extension-native{,-lab}`（生成物、gitignore）；三轮重建的 lab 产物 content hash 均与执行方对应测量产物逐字节一致。

## Gate 表（15 项，含三轮修订）

| Gate | 首轮 | 修复轮 | **终校** | 独立证据（终校为准） |
|---|---|---|---|---|
| G1 L4 核心架构未被破坏 | PASS | PASS | **PASS** | 三轮源码改动仅限皮肤/主题着色层；`adapter-core.js` sha256 四 commit 相同（`4e350eb7…6c0f3`）；实盘双栏、独立滚动、关闭路径全通过 |
| G2 左栏唯一完整原生焦点帖 | PASS | PASS | **PASS** | 实盘 `focalCount=1`；四个 fourposts 记录 `preview.id` 与目标一致；右栏无原帖副本 |
| G3 右栏原生评论与分页正常 | PASS | PASS | **PASS** | 首轮实测 cells 23→31 / 右栏 article 11→15；cell 几何自首轮起逐字未变 |
| G4 原生视频深滚仍保持挂载 | PASS | PASS | **PASS** | retention 代码字节相同；最终场 `videoIdentityAfterDeepScroll.sameElement` 4/4；视频场景深滚后 `stillConnected/inFocal/timeAdvanced/playingAfter` 全 true |
| G5 预览与原生接管视觉连续 | PASS | PASS（口径需修正） | **PASS** | 终校实盘：预览卡 `16,68,659×652` == pinned 卡（dx/dy/dw=0/0/0）；**可见文字位移 0**（预览 `.ppl-text` y=135 == pinned `tweetText` y=135）；**预览出现之后零空白 tick**（见 §7.2）；`blank/leftover=0`；文档已改按原始口径（dup=1、textJump 原始 −26/−16 均已如实标注） |
| G6 无新增私有 API 主动调用 | PASS | PASS | **PASS** | 四轮 diff 零网络/接口代码；隔离扫描 P3 复跑通过；manifest 零权限零 background |
| G7 未扩大 React 内部包装范围 | PASS | PASS | **PASS** | `adapter-core.js` 四 commit 同 sha256；`wrappedOwnProperty=true`；`perCallUs` 0.43–1.0（同字节代码，差异为测量噪声） |
| G8 UI 视觉质量明显改善 | PASS | PASS | **PASS** | 像素抽样（Reviewer 自截图，sharp）：浅色卡片/右栏 `255,255,255`、缝隙 `228–234`、顶栏条带 `238,241,244`（=画布）；深色卡片 `#000`、画布 `#0b0e11` |
| G9 不使用原版 Peek 兔子 Logo | PASS | PASS | **PASS** | 顶栏 0 `img`、仅 `Peek` 文字 + 2 细线图标；`#peek-native-pane=null`；逐样本 `brandFree=true` |
| G10 浅色和深色主题正常 | PASS | FAIL（P1） | **PASS** | P1 已修复并独立复证：① jsdom K10 通过；② **实盘**（产物 `…3abb7ea0aa`，阅读器 ACTIVE）写入 X 式内联深色 → 7 个调色板变量整体翻转（`--peek-lad-bg #ffffff→#000000`、`--peek-lad-page #edf1f4→#0b0e11`、卡片 `rgb(255,255,255)→rgb(0,0,0)`），画布 `html/body/column` 三处 `rgb(11,14,17)`（皮肤 `!important` 仍胜出）；恢复 → 全部回浅色；③ 仅 `html` 内联 `color-scheme` 的第二信号同样生效（dark/light 双向）；④ 内联 `rgba(0,0,0,0)` 被正确忽略；⑤ 真实 X 设置页切深色 → 回详情页挂载：画布 `rgb(11,14,17)`、卡片 `rgb(0,0,0)`、顶栏=画布、`radius=16px`、无覆盖层、无横向溢出；实测 X 在深/浅两态都同时写 `body` 内联背景与 `html` 内联 `color-scheme`（两个信号冗余 → 修复稳健） |
| G11 图片、视频、菜单、弹层、Esc 正常 | PASS | PASS | **PASS** | 灯箱（浅色与深色各测一次）：顶栏 `display:none`、X 原生关闭键中心 `(30,30)` `elementFromPoint` 命中其自身、不在顶栏内、真实指针点击后灯箱关闭且顶栏恢复 `flex`、阅读器保持 `active`；Esc 只关灯箱；无灯箱时（含视频页）`swipe-to-dismiss` 命中 0、顶栏 `flex`（无假阳性）；菜单记录 `topmostIsMenu=true`、在视口内、未被裁剪 |
| G12 性能满足 L4 非退化标准 | PASS | PASS | **PASS** | 终校重算最终配对（16/16 vs 16/16，身份逐样本）：T1a 29.5 vs 32.0、T1b 396.5 vs 418.0、T2b 1215 vs 1222、T4a 70.7 vs 77.55、T4b 732.6 vs 840.15 → **五项全部快于基线**（−2.5/−21.5/−7.0/−6.85/−107.55）；T1a 29.5 ≤100ms 且优于历史 34.0；同一 L4 bundle（`29fc210ac2`）在 78/27.5/32.0 三个窗口摆动，漂移归因成立 |
| G13 关闭和异常恢复正常 | PASS | PASS | **PASS** | 实盘两条关闭路径零残留：顶栏返回 → `/gefei55`、`state=idle`、顶栏/皮肤/split/预览/焦点卡/appbar 标记全部消失、`body` 回 X 自身 `rgb(255,255,255)`、`--peek-lad-page` 清空；`原生视图` → `idle`、split+chrome 下线、仍在同一详情 URL、body 已还原；loops 5/5（零残留、geom 0/0/0） |
| G14 Legacy/M1-R/L4 回退完整 | PASS | PASS | **PASS** | 各轮 `extension/ worker/ src/ scripts/ tests/sites-worker.test.mjs native-extension/manifest.json` diff 均为空；稳定标签 `stable/peek-native-m2b2a-l4-20261014` → 97c70ea；默认 M1 carrier 产物重建可用 |
| G15 真实 MV3 核心验收通过 | PASS | PASS | **PASS** | 实盘产物 `m2a-202610141505-3abb7ea0aa`（Reviewer 重建 `…1506-3abb7ea0aa`，content hash `3abb7ea0aa` 一致）；完整生命周期（列表点击→预览→接管→返回/原生视图）实盘走通；零权限、无 background、无残留、无横向溢出 |

## 1. 源码与 diff 核验（三轮）

- 首轮（`da0428d..196509f`）：新增 `reader-skin.js`；`controller.js` 挂载接线 + 主题变量扩展；`preview-layer.js` 几何/配色同源；`adapter-core.js` 零改动。
- 修复轮（`196509f..52c239e`）：覆盖层节点删除，暗化改为页面画布（`html`/`body`/`primaryColumn` 的 `--peek-lad-page !important`）；顶栏 `z-index 60→1` 且底色改画布色；新增纯 CSS `:has([data-testid="swipe-to-dismiss"])` 灯箱让位；`SKIN_THEME_VARS` 的 `backdrop`→`page`。
- 终校（`52c239e..3a165b2`）：**仅 `theme-adapter.js` 的 `readTheme()`**（+`parseRgb`），分层信号源：① `document.body.style.backgroundColor`（内联）→ ② `documentElement.style.colorScheme`（内联）→ ③ computed body 背景 → ④ computed colorScheme；内联 `rgba(...,0)` 跳过；`parseRgb` 兼容 rgba。`d8e7760` 仅为证据/文档同步（新增 `perf-results-*-final2.json`、`final-answers.md` 等）。**皮肤、几何、层叠、预览层在终校轮零改动**（`reader-skin.js`/`controller.js`/`preview-layer.js`/`adapter-core.js` 无 diff）。
- 三轮均无 DOM 移动/克隆、无 iframe/隐藏标签页、无 `body/html` overflow 写入、无凭据/网络代码；皮肤挂载仍在 `try/catch` 内、失败回退 L4 基线；`removeLayout()` 无条件先清皮肤与 chrome。

## 2. 离线测试（Reviewer 重建复跑）

| 命令 | 结果 |
|---|---|
| `npm run build:native:lab`（终校） | 成功；`Artifact identity: build m2a-202610141506-3abb7ea0aa`，**content hash `3abb7ea0aa` 与交付产物一致** |
| `npm run build:native` | 成功（M1 carrier，无 MAIN world 文件） |
| `node --test tests/native/*.test.mjs` | **223 pass / 0 fail**（首轮/修复轮 222，本轮 +K10） |
| `tests/native/native-reader-skin.test.mjs` | 10/10（K1–K10） |

- K10（新增）覆盖"皮肤挂载 + 画布 `!important` 规则存在时，内联主题写入仍翻转调色板"；测试注释如实声明 jsdom 不实现 `!important` 层叠、真实层叠由 live `themeinline` 场景覆盖——**该边界已被 Reviewer 独立证明**（jsdom 探针：内联胜出、读出内联值；真实浏览器：`!important` 胜出、读出画布色，故修复必须依赖内联信号）。
- D4 的 `writes = before + 7` 与 `skinPalette` 7 个深浅有别的键一致；K1/K2/K4 的画布断言、K9 几何单源断言均通过。

## 3. 产物身份与隔离（终校）

- 实盘 `<html data-peek-artifact>` = `m2a-202610141505-3abb7ea0aa`；lab `content.js` 含皮肤与 `:has` 规则；`layout-adapter-main.js` 不含皮肤字样；默认 carrier 产物仍含 adapter/皮肤字符串（L4 同类既有现象，`adapterEnabled()` 编译期常量门 + P4 行为测试保证零注册；已登记为后续优化项）。
- manifest 未改：零 `permissions`、零 `host_permissions`、零 `background`；lab 独有 MAIN world 入口。

## 4. 性能独立重算（终校，最终配对）

| 指标 | L4 历史 17:06 | L4 配对 23:01 | M2-B2-B 最终 22:56 | 配对差 |
|---|---:|---:|---:|---:|
| T1a | 34.0 | 32.0 | 29.5 | −2.5 |
| T1b | 375.5 | 418.0 | 396.5 | −21.5 |
| T2b | 1599 | 1222 | 1215 | −7.0 |
| T4a | 63.25 | 77.55 | 70.7 | −6.85 |
| T4b（stable） | 1369.8 | 840.15 | 732.6 | −107.55 |

- 与 `performance-comparison.md` 的终校表格**逐格一致**（文档 32.0/418.0/1222/77.5/840.2 与 29.5/396.5/1215/70.7/732.6 完全吻合；T4a L4 我重算 77.55，文档 77.5 为取整）；逐目标 T1a 中位数亦独立复算一致（新 UI video 32 / photos 26.5 / text 28 / highcomments 29）。**本窗口内新 UI 五项全部快于同窗基线**；由于各项差异均在该指标自身噪声量级内，可辩护的表述是"无退化（本窗口更好）"，不构成"更快"的强主张。
- handoff 字段（Reviewer 重算，与文档新表一致）：`dupFrames` 新 UI 1（16/16）、L4 配对 1（14/16）+ 0（2/16）；`blankLeftFrames`/`leftoverPreviewFrames` 两场全 0；`articleJumpPx` 新 UI 全 (0,0)、L4 配对 (0,0)×14 + (−308,11)×2；`textJumpPx.dy` 原始值 新 UI −26(15)/−16(1)、L4 配对 −11(15)/0(1) —— **首轮 P2-1/P2-2 已按原始口径改写并附口径说明**。
- `labIntegrity`（终校两场）：新 UI 16/16 `skin=true, topbar=true, focalRadius=16px, hOverflow=false, focalCount=1, previewLeftover=false, state=active, overlayNodeAbsent=true`，`canvas={body: rgb(237,241,244), cardBg: rgb(255,255,255)}`；L4 16/16 `skin=false, topbar=false, focalRadius=0px`、`canvas.body=rgb(255,255,255)` → 身份无交叉污染，且新字段已在本场次生效。
- 其它：`hOverflow` 两场全 false；idle 长任务 0；深滚长任务 0；`videoSame` 4/4；`resources` 中 `mediaImages` 全为缓存命中 0 字节、`videoMedia/rest11/xOther` 为 X 自身请求、无扩展发起桶；`wrapper` `wrappedOwnProperty=true`（0.7 / 1.0µs，同字节代码下的噪声）；堆/DOM 同量级。
- 漂移归因（Reviewer 独立加证）：历史场与配对场为**同一份 L4 bundle**（逐样本身份 `29fc210ac2`；Reviewer 用 `/tmp/l4check` 重建再次复现该 hash），同一 bundle 在 21:32 / 22:21 / 23:01 三个窗口 T1a 中位 78 / 27.5 / 32.0ms → 34→29.5 的差异属环境漂移而非代码。扩展内部 `extract→mount` 中位：终校新 UI 1.15ms vs L4 配对 1.85ms（新 UI 本窗口更快，均 ≪100ms 缺口）。

## 5. 体验原始记录（终校）

- `experience-results.json`：`buildId=m2a-202610141438-3abb7ea0aa`，**16 条 records 全部 `pass=true`**（fourposts×4、video、lightbox、quote、topbarback、nativeview、viewports、loops、themeinline、theme、narrow、reload、menu），`history` 仅 1 条并附注性质："reader was still activating 5s after the direct load (scenario wait, not the product); scenario hardened to poll for the pinned caret and re-run"。
- 关键字段复核：fourposts 四个样本 `pageCanvas{consistent:true, dimmed:true}`（html/body/col 三处同为 `rgb(237,241,244)` ≠ 卡片 `rgb(255,255,255)`）、`overlayNodeAbsent=true`、`topbarZ="1"`、`brandFree=true`、geom 0/0/0；`themeinline` 三态（`varBg #ffffff→#000000→#ffffff`、`varPage #edf1f4→#0b0e11→#edf1f4`、卡片 `255→0→255`、body 画布浅→深→浅、state 全程 active）；`lightbox` `closeProbe{clickable:true, coveredByTopbar:false}` + `closeClicked:true` + `afterEsc{dialogGone,onDetail,focal:1,state:active}`；`menu{open:true, withinViewport:true, topmostIsMenu:true}`；`loops` 5/5 零残留；`viewports` 1000px 仍 split，800px `split=false/topbar=none/relative`；`theme` 设置页切换 + 恢复浅色。
- 截图抽看：`themeinline-1-dark.png`、`lightbox-*`、`viewport-*`、`fourposts-*-2-native.png` 与 Reviewer 自截图一致，未见浮层几何或品牌问题。

## 6. 终校专项复核（对应任务书四项）

### 6.1 `readTheme()` 三层信号的行为（jsdom + 真实浏览器）

- jsdom：K10 通过（内联路径）；jsdom 探针证明"内联胜出、`!important` 不生效"，故 K10 只能覆盖内联路径——测试注释已如实声明。
- 真实浏览器（终校产物，阅读器 ACTIVE 全程）：
  - 基线：`inlineBody=rgb(255,255,255)`、`inlineScheme=light`（**X 同时写两个信号**），调色板浅色、画布 `rgb(237,241,244)`、卡片 `rgb(255,255,255)`。
  - ①内联 body 深色 → `--peek-lad-bg=#000000`、`--peek-lad-page=#0b0e11`、卡片 `rgb(0,0,0)`、`html/body/column` 三处 `rgb(11,14,17)`（皮肤画布规则仍胜出，未破坏视觉层）。恢复 → 全回浅色。
  - ②仅 `html` 内联 `color-scheme`（移除内联 body 背景）→ dark/light 双向均生效。
  - ③全部内联信号移除 → 回退 computed（读到画布色）；当前构建不可达（X 两态都写内联信号，已实测），列为残余理论边界。
  - ④内联 `rgba(0,0,0,0)` → 正确忽略，无误判深色。
  - ⑤真实 X 设置页切深色 → 回详情页挂载：`html/body/column=rgb(11,14,17)`、卡片 `rgb(0,0,0)`、顶栏=画布、`radius=16px`、无覆盖层、无横向溢出；恢复浅色后 `body=rgb(255,255,255)`。

### 6.2 `themeinline` 断言强度

足够：三态各断言调色板变量 + 卡片计算色 + 画布 computed 色 + `state=active`，其中 `dark.body === "rgb(11, 14, 17)"` 恰好证明"调色板翻转的同时皮肤画布规则仍生效"，且 `before/back` 双向对称。可加强（非必须）：深色态补 `html`/`column` 一致性（Reviewer 已独立验证三处同为 `rgb(11,14,17)`），并记录"信号来自 X 自身写入"（该场景为合成内联写入；真实设置路径由 `theme` 场景覆盖）。

### 6.3 两份最终 perf JSON 中位数重算

见 §4；五个中位数 + 逐目标 T1a + handoff 原始口径 + labIntegrity 字段全部与 Reviewer 重算一致，未发现文档与原始文件冲突（本轮起）。

### 6.4 画布 / 灯箱 / 几何在**新产物**上的行为

- 画布：浅色 `html/body/col=rgb(237,241,244)`、卡片 `rgb(255,255,255)`；深色 `rgb(11,14,17)` / `rgb(0,0,0)`；`#peek-reader-backdrop` 不存在；顶栏 = 画布色、`z-index=1`、`radius=16px`、`hOverflow=false`。
- 灯箱（浅色与深色各一次）：顶栏 `display:none`；X 原生关闭键 `(30,30)` 命中其自身、不在顶栏内；真实指针点击 → 灯箱关闭、顶栏自动恢复 `flex`、阅读器仍 `active`。
- 几何：列表真实点击 → 预览卡 `16,68,659×652` == pinned 卡（dx/dy/dw = 0/0/0）；**文字 y=135 == 135（delta 0）**。
- 空白窗格核验（专项）：4ms 采样 816 tick 中"既无预览也无标记文章"的 tick 全部出现在**点击送达之前**（clickedAt=24.1ms，none ticks 在 18.9/20.6/24.2ms，路径仍为 `/gefei55`）；**预览出现（t=58.5ms）之后没有一个空白 tick**（`noneAfterFirstPv=[]`），仅有 1 个"两者共存"的 tick（MAIN 打标→ACTIVE 的消息间隙，文章尚未 pin、且被预览覆盖）→ 无可见空白/重复阅读器。
- 关闭路径：见 G13。

## 7. 遗留问题（全部 P3，均不阻塞放行）

1. **`performance-comparison.md:26` 的 diag 表述未按上轮 P3-c 修正**：仍写"captureDelta ≤0.1ms、extract→mount 中位数 0.9–1.5ms"。Reviewer 实测（各窗口）：captureDelta 最大值 0.1（21:24 场）/0.4（22:16）/0.2（22:56），extract 中位数 1.0 / 1.35 / 1.15（新 UI 各场）与 1.75 / 1.85（L4 配对各场）。建议改为"captureDelta ≤0.4ms、extract 中位 1.0–1.85ms（新 UI 在各同窗配对中不慢于基线）"。
2. **同文件窗口指代不一致**：第 26 行仍称 22:16/22:21 为"最终配对…正式结论"，而文件头与核心表已以 22:56/23:01（final2）为最终交付配对。
3. **同文件第 53 行结论段仍引用早前窗口差值**（"+0.5/+9.5/+33.5/+9.8/−50"），与上方表格的 final2 差值（−2.5/−21.5/−7.0/−6.8/−107.6）不一致；建议结论段改用 final2 差值（或同时列两窗口并标注）。
4. **同文件第 43 行字段说明与事实略有出入**：`backdrop` 旧字段只存在于 22:16/22:21 两场；最终 final2 两场已使用 `overlayNodeAbsent`/`canvas`（`backdrop` 键不存在），文中"在最终两场中"与"（下一场次生效）"的表述需订正为"22:16/22:21 两场为旧字段名；最终两场已生效新字段"。
5. **过期源码注释**（功能性无害）：`reader-skin.js:22` 写"the top bar sits at z-index 0"，实际 CSS 为 `z-index: 1`；`evidence/experience-checks.mjs:330-332` 仍描述"skin chrome stays at z 50/51, below X's layers"，与现行 `z-index:1 + :has` 让位机制不符。
6. 报告层面的小差异（非工件问题）：本轮交接摘要称体验"15/15"，`records` 实为 16 条且全部通过。

## 8. 与执行方文档不一致之处（终校剩余）

| # | 位置 | 文档 | Reviewer 实测/原始 JSON | 级别 |
|---|---|---|---|---|
| 1 | `performance-comparison.md:26` | captureDelta ≤0.1ms、extract 中位 0.9–1.5ms | capture 最大 0.4（22:16 场）/0.2（22:56 场）；extract 中位 1.0–1.85 | P3 |
| 2 | `performance-comparison.md:26/53` | 以 22:16/22:21 为"最终配对/正式结论"并引用其差值 | 最终交付配对为 final2（22:56/23:01），差值 −2.5/−21.5/−7.0/−6.8/−107.6 | P3（内部不一致） |
| 3 | `performance-comparison.md:43` | "原字段名 backdrop 在最终两场中…（下一场次生效）" | final2 两场已用 `overlayNodeAbsent`/`canvas`，无 `backdrop` 键 | P3 |
| 4 | 五个核心中位数、逐目标 T1a、handoff 原始口径（dup/blank/leftover/articleJump/textJump）、labIntegrity、resources、loops 5/5、灯箱断言、viewports、narrow、身份守卫、`themeinline` 三态 | — | **全部吻合** | — |

上轮 P2-1/P2-2（交接字段口径）、P3-a（theme 行画布口径）、P3-b（失败汇总重写）、P3-d（`perf.mjs` 字段改名）、P3-e（`pageCanvas` 加固为 html/body/col 一致 + 与卡片不同 + `overlayNodeAbsent`）**均已核实修正到位**。

## 9. 最终判定：**GO**

理由：三轮独立复核后，**G1–G15 全部 PASS**，无 P0/P1/P2 遗留。

- 首轮交付的浮层皮肤、以及修复轮的画布暗化与灯箱层叠，均在 Reviewer 独立实测下成立；
- 我在修复轮提出的 P1（画布 `!important` 遮蔽 `readTheme()` 信号，导致挂载期间主题就地变化不跟随）已由 `3a165b2` 修复，并通过分层信号（内联 body 背景 / 内联 `color-scheme`）在**真实浏览器**中双向复证：调色板翻转、卡片跟随、画布保持皮肤色不变，且真实 X 设置路径与灯箱让位在深色下同样正常；
- 性能在最终背靠背配对中五项均不劣于同窗基线（本窗口内更快），T1a 29.5ms ≤100ms 目标且优于历史 34.0ms，漂移归因由"同一 L4 bundle 三窗口摆动"独立佐证；
- 体验 16/16 场景通过、loops 5/5 零残留、关闭路径零残留、几何与可见文字位移均为 0、预览后无空白 tick；
- 回退完整性（Legacy/demo/worker/scripts 零改动、稳定标签在位、默认 carrier 产物可重建）保持不变。

遗留问题仅为第 7 节的 P3（`performance-comparison.md` 一处 diag 数值与两处窗口指代/结论段的陈旧表述、两处过期源码注释、一处报告计数），全部为文档/注释整理，**不影响任何功能、性能或安全结论**，建议随下一次文档提交一并订正，无需再次测量。
