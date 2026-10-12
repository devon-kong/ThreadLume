# Peek Native（M1 工程底座）

本目录是 Peek 的 **Native 模式**正式工程源码（M1 第一包），由 R4 已验收的 PoC v5
机制（`exploration-poc/mv3-poc/`）工程化而来。构建产物输出到 `dist-extension-native/`，
与 Legacy 原版构建产物 `dist-extension/` **完全独立、互不覆盖**。

## 与 Legacy 的关系

| | Legacy（原版） | Native（本目录） |
|---|---|---|
| 源码 | `extension/`（保持不动） | `native-extension/src/*.js` |
| 产物 | `dist-extension/` | `dist-extension-native/` |
| 数据来源 | 自有 GraphQL 重放（page-bridge.js，MAIN world） | X 原生详情页 DOM 提取（零私有接口请求） |
| 注入 | MAIN world bridge + isolated world UI | 仅 isolated world，`document_idle` |
| 权限 | `storage` + host permissions | 无任何 permissions |
| 打包 | 复制 + vendor（icons/hls/brand） | esbuild 打包 `src/main.js` + vendor brand |

## 构建

```bash
npm run build:native    # → dist-extension-native/
npm run test:native     # 构建并运行 Native 测试套件（tests/native/）
```

构建脚本内置隔离自检：产物若包含任何 Legacy 桥接标记（fetch/XHR、webpack 探测、
queryId、CSRF/token 捕获、hls 等）会直接构建失败；`tests/native/native-isolation.test.mjs`
对产物做独立复核。

## 测试安装（不与 Legacy 同装）

1. Chrome 打开 `chrome://extensions/`，开启「开发者模式」。
2. 若同一 Profile 已加载 Legacy/旧 PoC，请先停用，避免双注入（或在独立
   Chrome Profile 中安装）。
3. 「加载已解压的扩展程序」选择 `dist-extension-native/` 目录。
4. 打开 x.com 任意帖子详情页：左侧出现 Peek 阅读栏，右侧为 X 原生详情。

回退：停用 Native 扩展、启用 `dist-extension/`（Legacy）即可，两者互不影响。

## 模块边界（M1-A）

- `src/route-observer.js` — SPA 路由与导航观察（事件驱动 + 轮询兜底）
- `src/navigation-session.js` — 关闭决策的会话历史记录（防跳出站外）
- `src/focal-extractor.js` — 焦点帖/引用/Article/媒体/计数提取
- `src/reader-lifecycle.js` — 构建、取消、有界恢复、销毁与资源所有权
- `src/reader-view.js` — 左栏阅读视图与原地字段刷新
- `src/native-interaction.js` — 原生互动控件定位与高亮（绝不代点击、不构造写入）
- `src/anchor-restore.js` — 关闭返回信息流的单次有界锚点微调（M1-B3）
- `src/theme-adapter.js` — 主题跟随
- `src/diagnostics.js` — 最小化内存内诊断（不持久化、不上报）
- `src/main.js` — 装配入口与注入幂等守卫
