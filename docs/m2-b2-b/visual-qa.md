# M2-B2-B — 视觉与体验验收（visual-qa）

脚本：`evidence/experience-checks.mjs`（真实浏览器、真实指针事件、无账号写入）；原始记录：`evidence/experience-results.json`（`records` = 各场景首个通过运行；`history` = 去重的失败运行）；截图：`evidence/shots/`。
Lab 产物身份：见 results JSON 的 `buildId` 字段（每轮以 `<html data-peek-artifact>` 校验）。

> 注：本文记录的是 **S3 修复轮之后**（画布暗化方案 + 灯箱层叠修复）的最终构建。修复前（覆盖层方案）的记录已被本轮替换；修复动因与实测见 `ui-implementation.md` §层叠事实。

## 1. 结果总表（14/14 通过）

| 场景 | 结果 | 关键证据 |
|---|---|---|
| fourposts text/photos/highcomments | PASS | 预览身份一致、接管后焦点帖恰 1 个、正文 362/162/194 字符 |
| video | PASS | 自动播放、暂停/恢复、全屏进入/退出、右栏深滚 5000px 后同元素仍在焦点帖内持续播放（702ms） |
| quote | PASS | 引用卡在左卡内部完整可见（quoteInsideCard）；引用内含 X Article 的嵌套原样保留 |
| lightbox | PASS | 灯箱打开时顶栏 CSS 让位（`display:none`）→ **X 原生关闭键可点击**（真击关闭成功、顶栏自动恢复）；Esc 只关灯箱，阅读器保持 ACTIVE（皮肤不绑定 Esc/无 JS 监听） |
| menu | PASS | 焦点帖菜单在 #layers 打开，完整位于视口内、层级最高（无裁剪） |
| topbarback | PASS | 顶栏返回 → 回到 /gefei55，无焦点帖/顶栏残留 |
| nativeview | PASS | 「原生视图」→ state idle、split/顶栏/背景幕全部下线、仍在详情页；下一次导航重新武装 |
| loops | PASS | 5/5 开关循环：每轮无预览残留、无焦点帖残留、无顶栏残留、信息流恢复可交互 |
| viewports | PASS | 1440×900 / 1280×800 / 1000×800：卡片 fixed+内缩、顶栏可见、零横向溢出；800×900：article 非 fixed、顶栏 display:none（X 原生单栏） |
| theme | PASS | 深色即时光卡与原生接管完整走通（body/focal/顶栏 #000，backdrop rgba(231,233,234,0.05)）；恢复浅色 |
| narrow(<980px) | PASS | 无预览（onFrames 0）、无 split、无皮肤节点 —— X 原生单栏 |
| reload | PASS | 扩展重载后标记正确、预览→接管完整走通 |

## 2. 预览 → 原生接管几何连续性（T1c 核心）

每轮在页内 4ms 采样器同时记录预览卡与 pinned 原生卡的矩形：

| 样本 | 预览矩形 | 原生矩形 | dx/dy/dw |
|---|---|---|---|
| fourposts text/photos/highcomments、theme、reload、loops×5 | {x:16,y:68,w:665,h:720} | 同左 | **0 / 0 / 0** |

共 **9 次独立采样全部为 0px**；文字块 dy 全为 0（对比 L4 记录的文字位移 -11..0px 与 15→17px 字体变化：本轮预览与原生卡同为 X 详情排版，因为预览卡与皮肤卡使用同一几何源）。横向溢出（scrollWidth > innerWidth）在所有采样中均为 false。

## 3. 皮肤状态断言（每个 fourposts 样本）

`topbar=true, skinStyle=true, radius=16px, brandFree=true, appbarTaggedHidden=true, hOverflow=false, topbarZ=1, overlayNodeAbsent=true, pageCanvas.dimmed=true`。

- **brandFree**：顶栏节点内零 `img/image`，仅 `Peek` 文字标题 + 细线图标 —— 原版兔子 Logo 未出现在 Native 页面 UI 的任何位置；
- **appbarTaggedHidden**：X 自带「← 帖子」应用栏被标记隐藏（其返回语义由顶栏安全返回接管）；
- **pageCanvas.dimmed**：`body` 计算色 `rgb(237,241,244)` ≠ 卡片 `rgb(255,255,255)` —— 暗化环境来自页面画布本身（**无覆盖层节点**，`overlayNodeAbsent=true`），像素抽验：卡片/右栏 `255`、缝隙 `≈235–238`；
- **topbarZ=1**：顶栏压在右栏 cell 之上，灯箱打开时由 `:has()` 规则自动让位（实测 closeProbe.clickable=true）。

## 4. 失败运行汇总（不隐藏）

- `fourposts:video` 两次「点击未进入预览」：X 时间线在懒加载下回流导致真实指针点击落在目标之外（L4 记录同类噪声，harness 的坐标回验+重试预算内未命中）。该视频帖由独立 `video` 场景（直连详情页）完整验证并通过。其余所有场景首次运行即通过。

## 5. 不可自动化项（沿用 L4 结论）

- 视频静音控件：当前 X 构建的播放条/设置弹层无静音控件（仅播放速度/画质），如实标注不可自动化；
- 真实账号写入：不在本轮范围（阅读器全流程零账号写入）。
