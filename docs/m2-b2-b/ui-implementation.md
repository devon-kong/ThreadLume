# M2-B2-B — UI 实现边界（ui-implementation）

## 新增文件

| 文件 | 职责 | 明确不负责 |
|---|---|---|
| `native-extension/src/layout-adapter/reader-skin.js` | 视觉层唯一新模块：几何（`skinGeometry()`）、主题调色板（`skinPalette()`）、皮肤 CSS（`skinCss()`）、扩展自有顶栏与背景幕节点的挂载/卸载（`mountSkinChrome` / `removeSkinChrome`）、X 应用栏标记（`tagXAppBar`） | GraphQL、React Fiber、虚拟列表保留逻辑、数据提取、预览身份识别、原生互动请求、认证信息 |

## 改动文件（最小化）

| 文件 | 改动 |
|---|---|
| `src/layout-adapter/controller.js` | ① `mountLayout/removeLayout` 调用皮肤挂载/卸载（挂载失败自动回退功能基线）；② `THEME_VARS` 扩展 7 项皮肤调色板并统一由 `skinPalette()` 单源写入；③ 新增 `releaseToNativeView()`；④ 顶栏返回回调 `onSkinBack()` 复用 R4 已验证的 `safeBackTarget()` 规则 |
| `src/preview-layer.js` | `previewCss()` 的几何与配色改为读取 `skinGeometry()`/`skinPalette()`（状态机、身份校验、超时清理全部未动） |
| `adapter-core.js` | **零改动**（MAIN world 包装、健康检查、恢复逻辑完全未触碰） |
| `LAYOUT_CSS`（controller 内） | **零改动**——仍是 52vw/48vw 功能基线；皮肤以同优先级后置样式覆盖几何 |

## 分层与回退契约

1. **功能基线**：`LAYOUT_CSS`（L4 验证过的边到边双栏）在皮肤缺席时原样工作；
2. **视觉层**：皮肤样式在 `LAYOUT_CSS` 之后注入 `<head>`，同特异性 `!important` 后序覆盖几何/配色；
3. **挂载失败回退**：`mountSkin()` 捕获任何异常并清除半挂载的样式与 chrome 节点，布局退回基线，不影响阅读；
4. **皮肤 CSS 与 chrome 节点均受 `@media (max-width: 979.98px)` 抑制**：<980px 时页面为 X 原生单栏，扩展正是"零视觉存在"。

## 视觉规格（floating 变体）

| 项 | 值 |
|---|---|
| 顶栏高 | 52px（固定，`--peek-reader-top`） |
| 卡片外边距 | 16px（`--peek-reader-inset`，四边） |
| 两栏间距 | 16px（`--peek-reader-gap`，背景幕透出形成分隔） |
| 圆角 | 16px（`--peek-reader-radius`） |
| 阴影 | 浅色 `0 8px 28px rgba(15,20,25,0.14)`；深色 `0 8px 28px rgba(0,0,0,0.55)` |
| 背景幕 | 扩展自有 fixed 节点（z55，`pointer-events:none`，非伪造时间线）；浅色 `rgba(15,20,25,0.07)`，深色 `rgba(231,233,234,0.05)` |
| 层叠 | 背景幕 55 < 预览 58 < 焦点卡 59 < 顶栏 60 < X `#layers` 弹层（既有事实，L4+S3 菜单/灯箱实测) |
| 顶栏内容 | 细线返回箭头（安全导航）+ `Peek` 文字标题 + `原生视图` 释放入口；**零品牌图形** |
| 右栏 | cell 显式卡片底色 + 左右留白；列表容器恒定 `padding-top: 68px` 与卡片顶对齐（安装时一次设定，不做动画） |

## 安全与合规

- X 详情页自带应用栏由**标记属性**（`data-peek-reader-appbar`，JS 从 `app-bar-back` 向上定位）隐藏——选择器不依赖易变的 DOM 深度；标记及样式随会话清理；
- 顶栏返回：仅当 `safeBackTarget().back` 为真才 `history.back()`，否则原地释放（与 M1-R/L4 同一已验证规则）；
- Esc **不绑定**任何处理（X 原生弹窗语义不受影响，S3 实测灯箱 Esc 只关灯箱）；
- 不新增任何 X 私有 API 调用、不移动/克隆 React 节点、不修改 `body/html` overflow。
