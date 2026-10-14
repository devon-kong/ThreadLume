# M2-B2-B — 独立 Reviewer 最终结论（architecture-gate）

Reviewer：独立 agent（与执行方隔离，未参与本轮任何实现）；2026-10-14 完成审查。
范围：`da0428d`（L4 稳定点）→ `196509f`（本轮提交），分支 `feat/peek-native-m2b2b-ui`。

审查方式（全部为 Reviewer 自行重算/实测，不接受 md 转述）：

1. `git diff da0428d..196509f` 全量阅读（源码 + 文档 + 新增测试）；`git status` 干净；`adapter-core.js` 取两 commit 的 sha256 对比；
2. 自行重建并复跑：`npm run build:native:lab && npm run build:native && node --test tests/native/*.test.mjs`；
3. 把 L4 源码用 `git archive da0428d` 落到 `/tmp/l4check` 独立重建，用于与本轮产物做哈希/包体对照（未触碰仓库工作区）；
4. 原始 JSON 用自写脚本重算（中位数、逐样本值、handoff、labIntegrity、resources、diag、wrapper/idle）；
5. 真实浏览器独立验证（ego-browser TaskSpace 22 / page p1，真实已装载的 floating lab 产物，CDP 真实指针事件，截图自存 `/tmp`）；
6. 截图抽看（本轮 shots + L4 shots 对照）。

未修改仓库内任何文件；仅创建本文件。测试期间按任务书要求重建了 `dist-extension-native{,-lab}`（生成物、gitignore），lab 产物 content hash 与执行方测量产物逐字节一致（见 §4）。

## Gate 表（Reviewer 判定）

| Gate | 判定 | 独立证据 |
|---|---|---|
| G1 L4 核心架构未被破坏 | **PASS** | 实盘：单窗口双栏、`state=active`、`data-peek-lad=on`、split CSS + 皮肤共存；焦点帖 `position:fixed`；两栏独立滚动经深滚验证（右栏滚至 14045px 左卡不动）；`adapter-core.js` sha256 两 commit 完全相同（`4e350eb7…6c0f3`）；离线 222/222 通过 |
| G2 左栏唯一完整原生焦点帖 | **PASS** | 实盘 `focalCount=1`、左卡正文为真实帖文（截图为完整长文 + 引用卡 + X Article 嵌套）；右栏首项为回复编辑器、无原帖副本（截图 + `fourposts`/`quote` 场景 JSON `quoteInsideCard=true`）；perf `focalCount=1` 16/16 |
| G3 右栏原生评论与分页正常 | **PASS** | 独立实测高评帖：滚动中 cell 23→31、右栏 article 11→15、文档高 10448→14781px，`state` 全程 active，无横向溢出；perf `t2bCandidate` 中位 1546.5ms（16/16 有值）；`t4Cells/t4Anchor` 记录正常 |
| G4 原生视频深滚仍保持挂载 | **PASS** | 独立实测：同一 focal 元素、同一 video 元素深滚 4500px（落 4063px）后 `isConnected`/`stillInFocal` 均 true，`paused=false`，currentTime 3.22→4.84s（1.5s 窗口内 +1.62s）；perf `videoIdentityAfterDeepScroll.sameElement` 4/4 true；离线 A 系列 retention 测试全过 |
| G5 预览与原生接管视觉连续 | **PASS** | 独立 4ms 采样（列表真实指针点击，`elementFromPoint` 命中 `time` 且 `inA=true`）：预览首 tick t=77.8ms 矩形 `16,68,659×652`，末 tick t=414.5ms 矩形不变，**零空白 tick**（无"两者皆无"），仅 1 个 tick 两者共存；接管后 pinned 焦点卡实测同为 `x=16,y=68,w=659.078,h=652,radius=16px`（几何完全一致，dx=dy=dw=0）；执行方 JSON 9 个采样点 geom 全 0 |
| G6 无新增私有 API 主动调用 | **PASS** | `native-extension/src/**` 全量 grep：零 `fetch(`/`XMLHttpRequest`/`graphql`/`queryId`/`csrf`/`cookie`（命中的全部是注释与 README 说明文字）；构建期隔离扫描测试 P3（含 `layout-adapter-main.js`）本轮复跑通过；manifest 零 `permissions`/零 `host_permissions`/零 `background`；`adapter-core.js` 零改动 |
| G7 未扩大 React 内部包装范围 | **PASS** | `adapter-core.js` 两 commit sha256 相同（MAIN world 包装与恢复逻辑零改动）；`wrapper.wrappedOwnProperty=true` ×3 场次；`perCallUs` 新 UI 0.43 / 配对 L4 0.47 / 历史 0.53（同量级）；A10/A11 gen-continuity 测试复跑通过 |
| G8 UI 视觉质量明显改善 | **PASS** | 与 L4 截图（`docs/m2-b2-a-l4/evidence/shots/fourposts-text-2-native.png` 边到边无顶栏）对照：本轮为浮层卡片（16px 内缩 + 16px 圆角 + 阴影 + 背景幕分隔 + 52px 紧凑顶栏 + 右栏卡片底色），Reviewer 自截图复核几何真实、留白与层次一致 |
| G9 不使用原版 Peek 兔子 Logo | **PASS** | 实盘：顶栏 `img` 数 0、`svg` 数 2（返回箭头/开窗图标）、文档内 `data:image/png` 图片 0、`#peek-native-pane` 为 `null`；源码：`reader-skin.js`/`preview-layer.js`/`controller.js` 零品牌引用；`vendor/brand/icon.js` 仅被 `reader-view.js::renderPane`（M1 pane）消费，lab 构建在 `adapterEnabled()` 处短路（离线 E1/P5 复跑通过） |
| G10 浅色和深色主题正常 | **PASS** | 独立实测：切深色后 7 个调色板变量全部翻转（`--peek-lad-bg #000000`、`border #2f3336`、`fg #e7e9ea`、`dim #71767b`、`hover rgba(231,233,234,0.08)`、`backdrop rgba(231,233,234,0.05)`、`shadow 0 8px 28px rgba(0,0,0,0.55)`），顶栏/背景幕/焦点卡计算样式同步跟随，radius 16px、top 54px 不变；浅色恢复后回白。执行方 theme 场景用的是真实 X 设置色块（`swatchUsed=1`），`themeAfterRestore=rgb(255,255,255)` |
| G11 图片、视频、菜单、弹层、Esc 正常 | **PASS**（含 1 项 P3 观察） | 实盘：灯箱打开后 Esc 只关灯箱、阅读器保持 active/顶栏/焦点卡；视频播放/暂停/全屏由执行方视频场景记录（每日真实指针），Reviewer 复验播放与深滚存活；菜单场景截图显示菜单位于 `#layers` 内且完整可见、未被左卡裁剪；**P3 观察**：灯箱打开时 `elementFromPoint(30,26)` 仍返回顶栏自身图标 → 顶栏位于 X 弹层之上（`#layers` 计算 `z-index:1`），与文档"顶栏 60 < X `#layers` 弹层"的表述相反 |
| G12 性能满足 L4 非退化标准（配对口径） | **PASS** | Reviewer 自行重算（见 §3）：T1a −0.5ms、T1b −13.5ms、T2b −468.5ms、T4a −14.75ms、T4b −198.3ms，配对口径全部不退化；T1a 绝对中位 77.5ms ≤ L4 文档既定 100ms 目标；T4b 判为"噪声内不可分辨、无退化证据"（见 §3.3） |
| G13 关闭和异常恢复正常 | **PASS** | 实盘两条关闭路径：顶栏返回 → 回到 `/gefei55`，`topbar/backdrop/skin/split/preview/focal/appbarTag` 全部消失、`data-peek-lad` 移出；`原生视图` → `state=idle`、split+顶栏+背景幕下线、仍在同一详情 URL；执行方 loops 5/5 复核：每轮 closed=true、`pvLeftover=false`、`focalLeftover=0`、`chromeLeftover=false`、geom dx=dy=dw=0；离线 K4/K5/K7 复跑通过 |
| G14 Legacy/M1-R/L4 回退完整 | **PASS** | `git diff da0428d..196509f --stat -- extension/ worker/ src/ scripts/ tests/sites-worker.test.mjs` 为空；稳定标签 `stable/peek-native-m2b2a-l4-20261014` 存在且指向 97c70ea；默认 native 产物（M1 carrier）本轮重建可用，P4/P5 行为测试通过；`extension/manifest.json` 权限仍为 `["storage"]` 未动 |
| G15 真实 MV3 核心验收通过 | **PASS** | 真实已装载 unpacked MV3 扩展（无 background、零权限）：`<html data-peek-artifact>` = `m2a-202610141335-8c45772a44`，hash 与执行方测量产物及 Reviewer 重建产物一致；完整会话生命周期（列表点击→预览→接管→返回/原生视图）实盘走通；无残留、无横向溢出、无 iframe/隐藏标签页 |

## 1. 源码与 diff 核验

- `git diff da0428d..196509f -- native-extension/` 仅 3 个文件：`controller.js`（+64/-? 挂载接线、`THEME_VARS` 扩展、`releaseToNativeView`、`onSkinBack`）、新增 `reader-skin.js`（251 行）、`preview-layer.js`（几何/配色改为读 `skinGeometry()/skinPalette()`）。
- **`adapter-core.js` 零改动**：`git show da0428d:… | shasum -a 256` 与 `196509f:` 同为 `4e350eb7e52025ca2c88e83e02e4f6f3c282de1193601735ab4920c655a6c0f3`。
- **无 DOM 移动/克隆、无 iframe、无隐藏标签页、无 `body/html` overflow 写入**：`overflow` 命中仅 `preview-layer.js` 自身 overlay 内部的 `overflow:hidden`；皮肤节点全部是扩展自有 `div/button`，append 到 `body`，卸载即移除。
- **无凭据/网络代码**：源码 grep 零命中（仅注释提及"不做这些"）。
- **挂载失败可回退**：`mountSkin()`（controller.js:374-382）`try { mountSkinStyle(); mountSkinChrome(...) } catch { removeSkinChrome(); removeSkinStyle(); }`；`mountSkinChrome`（reader-skin.js:179-223）在 append 抛错时先清理半挂载节点再 rethrow；`removeLayout()` 无条件先 `removeSkinChrome(); removeSkinStyle()`。皮肤样式缺失时 `LAYOUT_CSS` 原样工作（离线 P4/P5 与「删除皮肤样式后布局仍按基线」行为一致，K4 复跑证明卸载后无残留）。
- 皮肤是"后置同优先级"覆盖：`LAYOUT_CSS` 未改；皮肤 CSS 在 `@media (min-width:980px)` 内以 `!important` 覆盖几何，`@media (max-width:979.98px)` 把 chrome 全部 `display:none`（实盘 800px 验证通过）。
- 生命周期边界清晰：皮肤随 `mountLayout/removeLayout`（即会话 ACTIVE→teardown）挂载/卸载，路由此前由 `offRoute()`/`teardownSession()` 触发移除，因此不会在时间线上遗留顶栏/背景幕（实盘关闭后核验）。

## 2. 离线测试（Reviewer 重建复跑）

命令与结果（Reviewer 本机）：

| 命令 | 结果 |
|---|---|
| `npm run build:native:lab` | 成功；`Artifact identity: build m2a-202610141337-8c45772a44`，**content hash `8c45772a44` 与执行方证据同源产物一致** |
| `npm run build:native` | 成功；默认 M1 carrier 产物（无 MAIN world 文件） |
| `node --test tests/native/*.test.mjs` | **tests 222 / pass 222 / fail 0**（2820ms） |
| `node --test tests/native/native-reader-skin.test.mjs` | **9/9 PASS**（K1–K9） |
| `node --test tests/native/native-labr-fix.test.mjs` | **30/30 PASS**（含 D4） |

- **D4 的 `writes === before + 7` 正确**：`skinPalette()` 每主题 8 个键（`card/fg/dim/border/hover/accent/backdrop/shadow`），其中 **7 个在深浅之间取值不同**（`accent #1d9bf0` 两侧相同且未被 `THEME_VARS` 写入），`applyAdapterTheme()` 恰好写 7 个（bg+border+fg+dim+hover+backdrop+shadow），`--peek-lad-top` 不变故跳过 → 一次外部变更 = 7 次写入。测试与单一来源一致。
- `SKIN_THEME_VARS` 5 项 + controller 原有 3 项 = `THEME_VARS` 8 项，`captureInlineVars` 覆盖全部并原样恢复（K2/K4 复跑通过）。

## 3. 性能原始 JSON 独立重算

Reviewer 自写脚本直接读 `evidence/perf-results-m2b-ui.json`、`evidence/perf-results-m2a.json`、`docs/m2-b2-a-l4/evidence/perf-results-m2a.json`，重算中位数、逐样本、逐目标中位数、handoff、labIntegrity、resources、diag、wrapper/idle。**执行方 `performance-comparison.md` 的核心数字与原始 JSON 一致**（下表左三列与文档逐格吻合）。

### 3.1 核心中位数（ms，Reviewer 重算）

| 指标 | L4 历史 17:06 | L4 配对 21:32 | M2-B2-B | 配对差 |
|---|---:|---:|---:|---:|
| T1a | 34（n=16） | 78（n=15） | 77.5（n=16） | −0.5 |
| T1b | 375.5 | 382 | 368.5 | −13.5 |
| T2b | 1599 | 2015 | 1546.5 | −468.5 |
| T4a | 63.25（文档 63.2） | 76.8 | 62.05（文档 62.1） | −14.75 |
| T4b（stable） | 1369.8 | 1769.1 | 1570.8 | −198.3 |

逐样本 T1a 中位数：L4 配对 {video 88, photos 77, text 78, highcomments 78.5} vs 新 UI {82, 76.5, 73, 77}（与文档一致）。T4a 文档值与我重算相差 ≤0.05ms（取整口径差异，无实质影响）。

### 3.2 T1a 归因：**接受"配对无回归"**，且证据比执行方自述更强

- 关键独立发现：**历史场次与配对场次跑的是同一份 L4 代码**。历史文件逐样本身份 `m2a-202610140753-29fc210ac2`，配对基线逐样本身份 `m2a-202610141319-29fc210ac2`，**content hash 相同**；Reviewer 用 `git archive da0428d` 在 `/tmp/l4check` 重建 L4 lab 产物得到 `…-29fc210ac2`（hash 再次吻合）。同一份 bundle 在 17:06 产出 T1a 中位 34ms、在 21:32 产出 78ms → 差异只能来自环境/时段，不来自代码。
- 历史样本分布是**双峰**的（video 44/32/27/36、photos 79/74/22/24、text 27/24/75/77、highcomments 76/74/24/23）：同一场次内快慢模式随机轮换，"22–44ms 快模式"不是该构建的稳定属性；21:32 两构建分别 78/77.5ms，分布紧致（新 UI 71–89，配对 73–94）。
- diag 戳（Reviewer 全样本重算）：`captureDeltaMs` 三场次中位均为 0（0–0.1ms）；扩展内部 `extract→mount`：**新 UI 中位 1.0ms（0.9–1.3）**、配对 L4 中位 1.5ms（0.7–2.4）、历史 1.4ms（1.1–5.1）。即本轮皮肤在扩展处理器内**没有**带来 43ms——差异发生在扩展处理器之外的 X 自身点击任务里。
- 结论：T1a **配对口径无回归（−0.5ms）**成立；绝对中位 77.5ms 亦满足 L4 文档既定 `≤100ms` 目标。历史 34ms 属环境漂移，此归因**站得住**（比执行方"同一 L4 产物源码"的论证更硬：哈希相同已证明是同字节代码）。

### 3.3 T4b 判定：**不改判、但建议标注为"噪声内不可分辨"**

- 配对差 −198.3ms（新 UI 更快）方向正确，但该指标**单场次内部离散度 2.0–2.5s**（新 UI 969–2998ms，配对 836–2961ms，历史 721–3191ms），远大于 198ms。因此"更快 198ms"**不是可判定的结论**；能站住的表述是"配对口径下无退化证据"。
- 与 T1a 同理，历史 1369.8ms 与配对 1769.1ms 是**同一份 L4 代码**的两次场次结果 → 历史预算 `max(150,137)` 的超标项属环境漂移，不能归给本轮皮肤。
- 建议文档把 T4b 的结论从"更快"下调为"无退化证据（指标分辨率不足）"，数据与判定不必改。

### 3.4 handoff / labIntegrity / resources（Reviewer 重算）

- **handoff**：新 UI 16/16 样本 `dupFrames=0、blankLeftFrames=0、leftoverPreviewFrames=0`；`textJumpPx.dy` 全 0（preview 15px vs native 17px 字体下仍零位移）；`articleJumpPx` 新 UI dx −298/dy 25|15、配对 L4 dx −314/dy 11（即 unpinned→pinned 的宿主位移，非预览→接管位移）。
- **labIntegrity**：新 UI 16/16 `skin=true, topbar=true, backdrop=true, focalRadius=16px, hOverflow=false, focalCount=1, state=active, previewLeftover=false`；配对 L4 15/15 `skin=false, topbar=false, backdrop=false, focalRadius=0px` → 两场次测的确是两种 UI，身份无交叉污染。
- **resources**（新 UI，点击→稳定窗口）：`mediaImages` 仅图片样本有值（1/4/13 个，全部 `cacheHits==count`、字节 0），`videoMedia` 12–61、`xOther` 5–11、`rest11` 1–6（部分 300B）、`gqlOther` 1–2（283–3175B）——均为 X 自身请求；**无扩展发起的请求桶**（结构性保证：源码零 fetch/XHR、manifest 零权限零 background）。
- 其余：`wrapper.perCallUs` 0.43/0.47/0.53（`wrappedOwnProperty` 均 true）；`idle` 三场次 `{longTasks:0}`；深滚长任务 新 UI 全 0、配对 3 次 1ms、历史 10 次 1–2ms；深滚后堆 新 UI 113–215MB、配对 123–226MB；DOM 节点 新 UI 835–2923、配对 941–4629；视频同元素 新 UI 4/4、配对 3/3。

## 4. 产物身份与隔离

- **lab 产物**：`m2a-202610141335-8c45772a44`（浏览器实盘读取）＝ Reviewer 重建 `…1337-8c45772a44`＝执行方测量 `…1256-8c45772a44`，**content hash 完全一致**（同字节代码；ID 的时间段不同是构建时刻不同，非代码差异）。lab `content.js` 含 `peek-reader-skin`/`peek-reader-topbar`/`pk-tb-btn`；`layout-adapter-main.js` 不含皮肤字样（皮肤只在 ISOLATED 世界）。
- **manifest**：lab 与默认产物均**零 `permissions`、零 `host_permissions`、零 `background`**；host 访问仅来自 `content_scripts.matches`；lab 才注册 MAIN world 入口（`layout-adapter-main.js`，`document_start`）。与 L4 对比 `native-extension/manifest.json` diff 为空（未扩权）。
- **默认产物（carrier）**：`content.js` 内 `reader-skin`/`peek-lad`/`pk-tb-btn` 等**字符串确实存在**（与任务书"adapter 编译剔除、不含 reader-skin/peek-lad 字样"的预期不符）。但这是**既有事实、非本轮引入**：Reviewer 在 `/tmp/l4check` 重建 L4 默认产物，同样含 `peek-lad-style`/`52vw`/`teardownSession`（本轮默认产物 71,403B vs L4 61,965B，增量 ≈ 本轮源码增量）。功能隔离仍然成立：`adapterEnabled()` 编译期常量门 + `mountLayout` 从不被调用，离线 P4 证明默认产物无 `data-peek-lad-state`、无布局 CSS、无 MAIN 注册。
- 品牌文件 `vendor/brand/icon.js`（`globalThis.TuzaiBrandIconDataUrl`，标识符按 AGENTS.md 保留）在 lab 清单中仍作为 ISOLATED 前置脚本加载，但**渲染入口只有 M1 pane**，lab 下从不挂载。

## 5. 体验原始记录与截图

- `experience-results.json` 14 个场景终态全 `pass=true`；`history` 如实保留失败运行：`fourposts:video` **两次** `did not open with preview`（`at 2026-10-14T13:10:54.829Z`）、`viewports` 一次失败（`at 2026-10-14T13:13:40.994Z`）——与任务书所述"两次点击未命中"一致，未隐藏。history 采用累计+重复追加写法，最终条目 1661 条（体积噪声，非事实错误）。
- 场景细节抽取复核：`loops` 5/5（每轮 `closed=true`、`pvLeftover=false`、`focalLeftover=0`、`chromeLeftover=false`、geom 0/0/0）；`viewports` 1440/1280/1000 均 `fixed + topbar flex`、800 为 `relative + topbar none`；`narrow` 预览 `onFrames=0`、`focalCount=0`、`state=idle`；`theme` 真实色块切换 + 恢复；`topbarback` 回到 `/gefei55` 且 `focalLeftover=0/chromeLeftover=false`；`nativeview` `state=idle/split=false/chrome=false/focal=0/onDetail=true` 且 `rearmed=true`；`video` 含播放/暂停/恢复/全屏进出的真实指针记录，深滚 702ms 后 `videoStillConnected/inFocal/timeAdvanced/playingAfter` 全 true；`quote` `quoteInsideCard=true`；`reload` 标记 `m2a-202610141256-8c45772a44`。
- 截图抽看（Reviewer 亲自查看）：`viewport-1440x900.png`、`viewport-1000x800.png`（浮层几何真实、圆角/阴影/背景幕/顶栏齐全、右栏卡片底色可用、无横向溢出、无重复原帖、无兔子 Logo）、`theme-2-native.png`（深色：顶栏/卡片/背景幕/右栏全部跟随，层次正确）、`variantB-flush.png`（flush 变体：still 顶栏、边到边，回退路径可目视）、`fourposts-text-1-preview.png`（预览浮卡 + 背景幕压暗页面）、`quote-1-native.png`（引用卡及其内嵌 X Article 完整留在左卡内）、`lightbox-1-open.png`（灯箱覆盖双栏，唯顶部 52px 顶栏条仍在最上——见 P3-3）、`menu-1-caret.png`（菜单在左卡之上完整可见、未裁剪）、`narrow-viewport.png`（800px X 原生单栏、无皮肤）。另与 L4 同帖截图对照确认"明显改善"（见 G8）。
- Reviewer 实盘补充：`#peek-native-pane` 为 null；顶栏文本 `Peek 原生视图`；`data:image/png` 图片 0；关闭后所有扩展节点归零；800px 下 `topbar/backdrop display:none`、`article position:relative`、`radius 0px`、无横向溢出（`state` 仍为 active，属 LAYOUT_CSS 媒体禁用后的既有语义，与 L4 相同）。

## 6. Reviewer 独立发现的问题与处置建议

**P0：无。** **P1：无。**

**P2（1 项，文档表述与实测不符，需文档侧修正）**

1. **`performance-comparison.md` 第 10 行"两场各 16/16 有效样本，无 skip"与原始 JSON 不符**。原始数据：新 UI 16/16 有效；**配对 L4 为 15 有效 + 1 skip**（round 2 / video / `"click did not open the target detail"`），同一文档第 31 行自己也写"L4 配对（15 样本）"，自相矛盾。数值结论不受影响（该 skip 不贡献任何指标值，中位数不变）。建议改为"新 UI 16/16；L4 配对 15/16（1 次点击未进入目标详情，已如实记录）"。

**P3（5 项，记录/精度，建议下轮或文档补丁处理）**

1. **默认 carrier 产物含 adapter/皮肤死代码字符串**（`peek-reader-skin`/`peek-reader-topbar`/`pk-tb-btn`/`peek-lad-*`），本轮使其新增 ≈9.4KB（61,965B→71,403B）。与 L4 同类（L4 默认产物同样含 `LAYOUT_CSS`/`teardownSession` 等），**无行为影响**（编译期常量门 + P4 行为测试通过）。根因：`preview-layer.js` 静态 import `reader-skin.js`，使皮肤模块进入 carrier 依赖图。建议下轮把皮肤（或整个 adapter 子树）改为 flag-gated 动态 import，使 carrier 产物真正零残留。
2. **基线 JSON 的 `env.identityMarker` 与逐样本身份不一致**：`perf-results-m2a.json` 的 env 头写的是**新 UI** 构建 `m2a-202610141256-8c45772a44`，而它 15 个逐样本身份是 L4 的 `m2a-202610141319-29fc210ac2`；`perf-results-m2b-ui.json` 的 env 为 `null`。原因是 harness 在首轮导航前只读一次 `documentElement[data-peek-artifact]`（读到上一产物遗留值）——历史 L4 文件同样如此（env `…0740-ec295705ee` vs 样本 `…0753-29fc210ac2`）。**逐样本身份才是有效证据**，本轮归属正确（新 UI=8c45772a44、基线=29fc210ac2，Reviewer 已用重建哈希双向验证）。建议把 env 读取移到首轮导航之后，或删除该字段以免误读。
3. **`ui-implementation.md` 的层叠表述"顶栏 60 < X `#layers` 弹层"与实测相反**：实盘 `#layers` 计算 `z-index:1`（`position:absolute`），灯箱打开时 `elementFromPoint(30,26)` 返回顶栏自身的图标路径 → 顶栏（z=60）绘制在 X 弹层之上，灯箱/弹窗顶部 52px 条被阅读器 chrome 覆盖（截图 `lightbox-1-open.png` 可见）。功能不受损（灯箱可开可关、Esc 只关灯箱且阅读器保持 active），属视觉层叠观感问题。建议下轮明确意图：若希望弹层压顶栏，需要让皮肤 chrome 进入低于 X 弹层容器的层叠层（当前 55–60 的硬编码层级不足以表达"低于 X 模态"）；若希望顶栏常驻，请在文档中改写该行并保留截图证据。
4. **`performance-comparison.md` 资源段"`mediaImages` 1 次全为缓存命中"表述偏低**：实测逐样本为 1/4/13（16 个样本中 8 个该桶为 null，因纯视频样本不载图），全部 `cacheHits==count`、字节 0。"无扩展发起的跨源请求"这一结论正确（有源码与 manifest 的结构性保证）。
5. **Reviewer 工具侧备注（非产品问题）**：`Emulation.clearDeviceMetricsOverride` 经 ego-browser 的 CDP 桥接对目标无效；Reviewer 已用 `Emulation.setDeviceMetricsOverride(1329×736,dpr2)` 显式恢复原视口，测试结束页面为 `/home`、浅色、无任何 Peek 节点、`state=idle`。

**另需澄清的一处 Reviewer 观察（非缺陷）**：Reviewer 用 4ms 采样在接管瞬间观测到 **1 个 tick 同时存在预览与 `article[data-peek-lad-focal]`**，此时该 article 仍是未 pin 的自然位置（x=308），且位于背景幕之下——与 MAIN 契约"先打标记、后回 ACTIVE"（controller.js:203-216）一致。执行方的 `dupFrames` 口径要求"预览可读 + 标记存在"，因此记为 0，两者不矛盾；建议在文档中注明该口径，避免后续 reviewer 重复发现同一现象。

## 与执行方文档不一致之处（汇总）

| # | 执行方文档 | Reviewer 核验 | 影响 |
|---|---|---|---|
| 1 | `performance-comparison.md`："两场各 16/16 有效样本，无 skip" | 配对 L4 为 15 有效 + 1 skip（round2/video） | 表述错误，数值不变（P2-1） |
| 2 | `performance-comparison.md`：资源段"`mediaImages` 1 次" | 逐样本 1/4/13（8 个 null），全缓存命中 0 字节 | 表述偏低（P3-4） |
| 3 | `performance-comparison.md`：T4b"新 UI 快 198.3ms" | 配对差确实 −198.3ms，但指标内部离散 2.0–2.5s，应表述为"无退化证据" | 表述偏强（§3.3） |
| 4 | `performance-comparison.md`：T1a diag"extract→mount≈1.0–1.3ms" | 实测 0.9–1.3ms（中位 1.0） | 取整，无实质差异 |
| 5 | `ui-implementation.md`：层叠"顶栏 60 < X `#layers` 弹层" | `#layers` z-index=1，顶栏在弹层之上 | 表述相反，引 P3-3 |
| 6 | 任务书/假设：默认产物不含 `reader-skin`/`peek-lad` 字样 | 默认 carrier 产物含这些字符串（L4 亦然，本轮 +9.4KB 死代码） | 预期不符，引 P3-1 |
| 7 | 任务书/执行方文档：两 JSON 的 marker 归属 | 逐样本归属**正确**（新 UI=8c45772a44，基线=29fc210ac2，Reviewer 以重建哈希双向证实）；但**基线 JSON 的 env 头**写的是新 UI 构建 | env 字段误导，引 P3-2 |
| 8 | `performance-comparison.md`：T4a 63.2 / 62.1 | Reviewer 重算 63.25 / 62.05 | ≤0.05ms 取整差，无实质差异 |

其余数字（T1a/T1b/T2b/T4b 中位、逐目标 T1a、handoff 全 0、labIntegrity、wrapper/idle、深滚长任务、堆与 DOM 区间、身份断言、loops 5/5）Reviewer 重算/实测**全部吻合**，未发现任何凑数、skip 掩盖或加速代码路径。

## 最终判定：**CONDITIONAL GO**

工程结论：本轮交付物（浮层皮肤视觉层）在 Reviewer 独立复跑下**全部 15 项 Gate 通过**：L4 核心能力（单窗口双栏、左唯一原生焦点帖、右原生评论与分页、双栏独立滚动、视频深滚存活、预览→接管像素连续、关闭与释放零残留、<980px 安全降级、零主动私有 API、零新增 React 包装）实测未破坏；产品化体验（同源几何/配色、深浅主题、品牌零兔子、15px/20px 阅读密度、原生菜单/灯箱/Esc）属实；性能配对口径无退化且 T1a 满足 100ms 既定目标。

未给纯 GO 的唯一原因是**证据文档中的 P2 表述错误与 3 项 P3 精度/表述偏差**（均为文档侧，不含代码、不含测量错误）。放行条件（仅文档修订，**无需重测或改码**）：

1. **必须**修正 `performance-comparison.md` 的"16/16 无 skip"→"新 UI 16/16；L4 配对 15/16（1 次点击未命中）"，消除与同文档"15 样本"的自相矛盾（P2-1）；
2. 建议同时修正 `mediaImages` 计数表述、T4b 结论措辞、"extract≈1.0–1.3ms"为"0.9–1.3ms"，并在 layer 表述处记录 `#layers z-index=1` 与顶栏实测层叠（P3-3/P3-4）；
3. 基线 JSON `env.identityMarker` 的来源在文档中加一句说明（harness 首轮前读取，阅读时以逐样本 identity 为准），或下轮把该读取移到首轮导航之后（P3-2）；
4. 默认 carrier 产物死代码与皮肤动态 import 的改进登记为下轮事项（P3-1）。

上述 4 项完成后即可转为 **GO**；其中第 1 项属必须修正项。
