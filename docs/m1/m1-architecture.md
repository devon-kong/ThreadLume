# M1-A 正式工程架构与模块边界

日期：2026-10-13。分支 `feat/peek-native-m1`（自 R4 验收基线 `b496c54` 切出）。
M1 是正式工程底座第一包：把 R4 已验收的 PoC v5 机制工程化为可构建、可测试、可回退的
Native 扩展，同时完整保留 Legacy 原版作为对照与回退方案。

## 1. 双构建布局（Legacy / Native 隔离）

| | Legacy（原版，保持不动） | Native（M1 新增） |
|---|---|---|
| 源码 | `extension/`（本分支零改动，`git diff b496c54 -- extension/` 为空） | `native-extension/src/*.js`（11 个 ES 模块源文件） |
| 构建入口 | `npm run build:extension` → `scripts/build-extension.mjs` | `npm run build:native` → `scripts/build-extension-native.mjs` |
| 构建产物 | `dist-extension/`（gitignore，不覆盖 Native） | `dist-extension-native/`（gitignore，不覆盖 Legacy） |
| manifest | MAIN world `page-bridge.js`（document_start）+ isolated UI | 仅 isolated world `content.js`（document_idle），无任何权限 |
| 私有接口 | 自有 GraphQL 重放（动态发现，凭据不落盘） | **零**：无 fetch/XHR、无 webpack 探测、无 queryId、无凭据捕获 |
| 运行时依赖 | hls.js vendor、Phosphor icons、brand data URL | 仅 brand data URL（48px PNG→base64，构建期生成） |
| 测试 | `npm test`（119 项，原样保留） | `npm run test:native`（73 项，执行真实构建产物） |

两个产物名称、目录、manifest 名称/版本均不同（`Peek Native (M1)` 0.9.0 vs
`Peek · X 帖子浮层阅读器` 0.8.10），可在 `chrome://extensions` 中并存安装但**测试时
必须分 Profile 或停用其一**，避免同一页面双注入（安装说明见
`native-extension/README.md`）。

构建期隔离门禁：`scripts/build-extension-native.mjs` 在打包后对产物做禁用标记扫描
（fetch/XHR/webpackChunk/`__webpack_require__`/queryId/x-csrf-token/bearer/document.cookie/
page-bridge/chrome.* API/hls 等），任一命中立即构建失败；`tests/native/native-isolation.test.mjs`
对产物与源码做独立复核（纵深防御），并验证 Legacy manifest/文件原样保留、两产物路径互斥。

## 2. Native 模块边界（按真实耦合拆分，非强制九文件）

| 模块 | 职责 | 关键约束（R4 已验证语义） |
|---|---|---|
| `src/constants.js` | 命名空间、节奏常量、共享小工具 | 单一来源，无逻辑 |
| `src/navigation-session.js` | 关闭决策的会话历史：Navigation API `entries()` 为主、文档内轨迹回退 | `history.back()` 仅在前驱为同站 X 时调用；外部直达/刷新/初始条目一律原地拆除 |
| `src/route-observer.js` | SPA 路由观察：捕获阶段点击（锚点捕获+级联）、navigate 事件（尽力）、title 观察者、轮询兜底 | 事件驱动优先，轮询只兜底；只观察不拦截（从不 preventDefault） |
| `src/focal-extractor.js` | 焦点帖身份/正文/引用/Article/媒体/计数提取 | 纯 DOM 读取；引用卡内时间链接不充当焦点格；未知计数不伪造 0 |
| `src/reader-lifecycle.js` | 构建、生成号取消、有界恢复、销毁、关闭 | 快速首显（折叠先上屏）→ 解耦升级（水合刷新/展开全文）原地完成；恢复只武装一次；挂载前双重校验 URL 与 pane 幂等 |
| `src/reader-view.js` | 左栏阅读视图、原地字段刷新、布局样式挂载 | 刷新不重挂；文本单调性守卫（`data-peek-full-text`，R4 P2-1）；布局规则只在 `data-peek-native` 属性存在时生效，拆除即还原 |
| `src/native-interaction.js` | 原生互动控件定位与高亮 | **只定位不代点**：绝不 `.click()` 原生写入控件、不构造写入 API；文案与点击反馈如实表达"由用户亲自决定"（M1-B4） |
| `src/anchor-restore.js` | 关闭返回信息流的单次有界锚点微调（M1-B3，新增） | 打开时（点击捕获阶段）记录焦点格视口位置 → 关闭返回后等待格重挂+滚动稳定 → 至多一次 `scrollBy`；任何用户输入取消；窗口过期放弃；纯函数 `computeAnchorAdjustment` 可单测 |
| `src/theme-adapter.js` | 主题跟随 | 只镜像 X 当前绘制的颜色；MutationObserver 跟随 html/body 变化 |
| `src/diagnostics.js` | 最小化内存内诊断（路由/首显/水合/锚点计时） | 不持久化、不上报；测试钩子镜像到 DOM 属性供离线/CDP harness 读取 |
| `src/main.js` | 装配入口、注入幂等守卫（`__peekNativeInstalled`）、Esc 捕获处理 | 模块顶层全部为纯状态声明，守卫先于任何监听器注册 |

依赖图无环：`constants ← navigation-session/focal-extractor/theme-adapter ← reader-view/
native-interaction/anchor-restore ← reader-lifecycle ← route-observer ← main`。

## 3. 与 R4 PoC 的有差异点（M1-B 交付）

1. **锚点修复（B3，新能力）**：R4 记录关闭返回后 X 自身重锚导致被点击帖偏移
   151–153px（=裸 X 行为）。M1 新增单次有界微调：实测把终态偏移收敛到 ≤2px
   （12/12 窗口，目标 ≤60px）。设计上不持续强制滚动、不与虚拟化器竞争、用户任何输入
   即取消。发现并修复一个真实环境事实：**Chromium 不向隔离世界投递 Navigation API
   `navigate` 事件**（监听可注册但事件永不到达）——锚点捕获因此挂在捕获阶段点击监听
   （先于 X 路由器执行，源列表 DOM 必在），`entries()` 读取不受影响（关闭决策实测
   `navapi-same-site-entry` 正确）。回归测试
   `tests/native/native-anchor-live.test.mjs` 固化该行为。
2. **互动语义规范化（B4）**：按钮文案改为「定位回复/定位转推/定位点赞/定位收藏」，
   工具行 aria-label 与静态说明、点击后的临时反馈均如实说明"只定位高亮、由你亲自
   点击、不构造账号写入"；找不到原生控件时给中性提示而非伪装成功。
3. **布局样式挂载**：`mountStyle()` 从构建流程补回（冒烟发现缺失，52/48 让位布局
   与 `data-peek-native` 门禁此前不会生效）。
4. **品牌头**：按产品决策（AGENTS.md）应用兔图标 + 精确标题 `Peek` + 在 X 打开 + 关闭。
5. **诊断钩子**：`window.__peekNativeTest`（仅 `__PEEK_NATIVE_TEST__` 武装时）+
   `data-peek-native-route-change-at` / `data-peek-anchor` DOM 镜像，供 harness 验证。

## 4. 构建与运行时体积

- Native 产物：`content.js`（可读、未压缩，约 40KB）+ `content.css` + manifest +
  brand icon（数 KB）+ 应用图标。不含 hls.js、不含 Phosphor 图标集、不含旧解析器。
- 必要权限：**零**（无 `permissions`、无 `host_permissions`、无 `web_accessible_resources`）。
- 运行时依赖：无（不引入任何框架；打包用 esbuild 来自既有 vite 工具链，无新增依赖）。
