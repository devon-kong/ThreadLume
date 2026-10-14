# M2-B2-B S0 — 设计基线审查与方案

分支：`feat/peek-native-m2b2b-ui`（自 `fix/peek-native-m2b2a-l4` @ da0428d 切出，远端 HEAD 一致，工作树干净）。

## 一、八个必须先回答的问题

### Q1 当前原生焦点帖的实际布局边界

`article[data-peek-lad-focal]`（controller.js `LAYOUT_CSS`）：
`position:fixed; left:0; top:var(--peek-lad-top,54px); bottom:0; width:52vw; overflow-y:auto; overscroll-behavior:contain; z-index:59; background; border-right:1px`。
`--peek-lad-top` 实测 X banner 高度（40–80px 夹取，回退 54px）。**<980px 视口全部规则失效**，X 原生单栏。焦点帖自身就是独立滚动容器。

### Q2 左右栏共享的祖先容器

DOM 上焦点 article 仍在 X React 树内（`primaryColumn` → section → 虚拟列表 → focal cell 的 `cellInnerDiv`），只是被 `position:fixed` 视觉上拔出。共享祖先：`[data-testid="primaryColumn"]`（已被设为 100vw）及其内的 section/列表容器。所有 `cellInnerDiv`（含焦点 cell）被 `margin-left:52vw; width:48vw` 右移，焦点 cell 的 `cellInnerDiv` 单独 `transform:none`。因此：**对 primaryColumn/列表容器加任何几何属性都会同时影响两栏**。

### Q3 影响 React 虚拟列表测量的 CSS 属性

- `cellInnerDiv` 的宽度（48vw → 改变文字换行与媒体宽高比→cell 高度）；
- cell 的 padding/margin/border（直接改变 cell 盒高）；
- cell 内 font-size/line-height；
- 列表容器或 cell 的 transform（X 用 translateY 定位 cell，焦点 cell 已被显式 `transform:none`）；
- 焦点注入项固定 `offset:0`，列表坐标原点（容器 padding-top）必须**在安装时恒定**，不能运行动画或运行中改值。

结论：几何变量只在 CSS 挂载时确定一次，不做过渡动画；右栏宽度常量 = `48vw − gap − inset`。

### Q4 不能加 transform/overflow/contain 的元素

- **primaryColumn、section、列表容器、cellInnerDiv**：transform 会创建包含块，破坏 X 的 sticky/fixed 定位与虚拟器 offset 数学；overflow 会截断 X 的 window 滚动虚拟化。
- **焦点 article 的祖先链**：不新增 `contain:layout/paint`（会改变 fixed 后代与层叠上下文）。
- 焦点 article 自身**已有** `overflow-y:auto`（L4 已验证）：X 的下拉菜单、HoverCard、Tooltip 渲染在 body 级 `#layers` 传送门，不受该裁剪影响（L4 实测菜单/弹层正常）；article 内绝对定位元素（视频控制条、插入符号按钮）在 article 滚动盒内，border-radius 只裁圆角处背景，不裁控件。
- **不加 backdrop-filter blur**（GPU 开销 + 潜在堆叠副作用），顶栏用高不透明度纯色。

### Q5 原生视频全屏与菜单弹层的层叠关系

- 视频全屏进入 **top layer**，高于一切 z-index/overflow/transform，浮层外壳无法裁切它（L4 实测全屏进/出正常）。
- X 菜单/HoverCard 在 `#layers` 传送门，L4 已验证其层叠高于焦点窗格 z=59。新增顶栏取 z=60、背景幕取 z=55，保持低于 X layers 的既有事实。
- Esc：本皮肤**不绑定任何 Esc 处理**——X 原生弹窗（灯箱/菜单）的 Esc 语义完全不受影响，S3 的"Esc 不冲突"检查项由此结构性满足。关闭入口 = 顶栏返回按钮（指针操作），复用已验证的 `safeBackTarget()` 规则。

### Q6 52:48 的实际阅读宽度

1440px 视口：左 748px、右 691px；1280px：左 666px、右 614px。X 详情正文列约 600px，两侧均 ≥ 原生密度所需宽度。980–1100px 窄桌面：右栏 ≈470–520px，与 L4 现状一致，可接受。52:48 保留。

### Q7 预览层与原生焦点帖共享几何

当前两者各自写死 `left:0; top:banner高; width:52vw`（preview-layer.js `previewCss()` 与 controller `LAYOUT_CSS` 独立测量 banner 高度）。本论引入**单一几何来源** `reader-skin.js` 的 `skinGeometry()`：顶栏高、外边距、栏间距、圆角、阴影、左右宽度全部出自同一函数，预览 CSS 与皮肤 CSS 引用同一组 CSS 自定义属性，保证"预览→接管"逐像素连续。

### Q8 浮层视觉能否不移动 React 节点

**可以。** 浮层 = 纯 CSS（fixed article 内缩 + 圆角 + 阴影）+ 扩展自有节点（背景幕、顶栏，均新建于 body 末尾、pointer-events 受控、不触碰 React 树）。不移动/克隆任何 X 节点，不改虚拟器行为，与 L4 架构完全同构。右栏"卡片"通过给 cell 显式背景色 + 左右留白实现（文档流不变，window 滚动不变）。

## 二、候选方案

### 方案 A：浮层式阅读器（优先）

- 扩展自有固定**背景幕**（z55，主题感知暗化，pointer-events:none——背景是已导航后的 X 详情页，不伪造时间线、不假装可交互）。
- 左栏焦点帖：固定**浮卡**（四边内缩、16px 圆角、轻阴影、1px 描边），几何与预览完全一致。
- 右栏评论：cell 显式卡片底色形成连续"面板"，左右留白露出背景幕，与左卡之间以 gap 分隔；顶部留白与顶栏对齐。
- **紧凑顶栏**（z60，高 52px）：细线返回箭头（safeBackTarget 安全导航）+ `Peek` 文字标题 + 右侧"原生视图"释放入口（会话释放回 X 原生单栏，真实逃生舱）。**无兔子 Logo、无旧品牌图形**。
- 隐藏 X 详情页自带的"← 帖子"应用栏（其返回语义由顶栏接管），列表容器补偿恒定 padding-top。

### 方案 B：精致全屏双栏（回退）

同一皮肤模块的 `flush` 变体：无背景幕、左卡零内缩零圆角（保留 1px 分隔线）、右栏全出血；顶栏、主题变量、滚动条与细节打磨与 A 共用。几何变量切零即得，结构零改动。

### 比较预案与选择纪律

A 的结构性风险点：① cell 显式背景色对 X 主题变体（纯黑/昏暗/浅色）的适配；② 隐藏 X 应用栏选择器的构建漂移；③ 浮卡阴影/圆角带来的额外绘制开销（T1b/T4 预算内应可吸收）。每一项都有独立回退（主题变量跟随 readTheme；应用栏隐藏失败时仅视觉冗余，不破坏功能；开销超预算即切 B）。**若 A 经最多一轮针对性修复仍不稳定，直接采用 B，不无限优化。**

## 三、工程边界（S2 预声明）

- 新增 `native-extension/src/layout-adapter/reader-skin.js`：皮肤 CSS、几何/主题变量、顶栏与背景幕节点的挂载/卸载。只管视觉，不碰 GraphQL/Fiber/虚拟器/数据提取/认证。
- `adapter-core.js` **零改动**；`controller.js` 仅：mountLayout/removeLayout 调用皮肤挂载/卸载、主题变量表扩展、新增 `releaseToNativeView()`。
- `LAYOUT_CSS` 结构基线**原样保留**（52vw/48vw 契约、离线测试断言不变）；皮肤 CSS 以同优先级后置样式覆盖几何——皮肤挂载失败时自动退化为 L4 功能基线。
- `preview-layer.js` 仅替换几何/配色来源为 `reader-skin.js` 的共享函数，状态机不动。
