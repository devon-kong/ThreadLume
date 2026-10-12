# M1-A2/A3 构建隔离证明

日期：2026-10-13。目标：证明 Native 构建完全不加载 Legacy 私有 API 桥接，且两个
构建产物可独立测试、可明确回退（Gate G2/G9 的证据文档）。

## 1. 隔离的三个层次

### 1.1 构建时门禁（fail-fast）

`scripts/build-extension-native.mjs` 在 esbuild 打包后立即扫描产物，以下标记任一
命中即构建失败：

```
XMLHttpRequest / webpackChunk / __webpack_require__ / fetch( / queryId /
x-csrf-token / bearer / document.cookie / page-bridge /
chrome.(scripting|tabs|cookies|webRequest|declarativeNetRequest|storage|runtime|action) /
hls.min|hls.js / peek-poc / __peekPoc
```

同时硬性保护输出路径：`dist === legacyDist` 时抛错拒绝构建。

### 1.2 产物静态验证（tests/native/native-isolation.test.mjs）

对 `dist-extension-native/` 的独立复核（构建门禁被绕过也能抓住）：

| A3 验证项 | 测试 | 结果 |
|---|---|---|
| 1. 无 MAIN world page bridge | manifest 无 `world:"MAIN"`、脚本列表无 page-bridge、产物目录无 page-bridge.js 文件、产物文本无 `page-bridge` | PASS |
| 2. 无主动 X 私有 API 请求 | 产物无 `fetch(`、`XMLHttpRequest`、`queryId`；源码目录同扫 | PASS |
| 3. 无全局 fetch/XHR 包装 | 同上（产物与源码双层） | PASS |
| 4. 无 Webpack 探测 | 无 `webpackChunk`/`__webpack_require__` | PASS |
| 5. 无认证请求元数据捕获 | 无 `x-csrf-token`/`bearer`/`document.cookie` | PASS |
| 6. 无后台隐藏数据读取 | manifest 无 `background`、无隐藏页；扩展仅一个 document_idle 注入 | PASS |
| 7. 无自动账号写入 | 静态扫描 + 互动语义测试组（定位不代点、不构造写入） | PASS |
| 8. 不因缺少 Legacy bridge 而失败 | 离线 harness 环境无任何 Legacy 全局（无 TuzaiPhosphorIcons 等）全部功能测试通过 | PASS |

附加项：无 `eval`/`new Function` 动态代码；无 `peek-poc`/`__peekPoc` 命名残留；
无 hls.js；无 popup/background（M1 范围外能力如实缺省，不静默假装存在）。

### 1.3 manifest 权限面

Native manifest（`dist-extension-native/manifest.json`）：

- `content_scripts`：1 条，isolated world（未声明 `world` 即默认 isolated），
  `document_idle`，js 仅 `vendor/brand/icon.js` + `content.js`。
- **无 `permissions`、无 `host_permissions`、无 `web_accessible_resources`、
  无 `action`/popup、无 `background`**（对比 Legacy：`storage` + host permissions +
  MAIN world bridge + hls vendor + popup）。
- 名称 `Peek Native (M1)`、版本 `0.9.0`，与 Legacy（`Peek · X 帖子浮层阅读器`
  0.8.10）在 chrome://extensions 中可区分。

## 2. Legacy 完好性（G1/G9）

- `git diff b496c54 -- extension/` 为空（本分支对原版源码零改动）。
- 测试断言：Legacy manifest 仍声明 MAIN world page-bridge、`storage` 权限仍在、
  `page-bridge.js`/`content.js`/`core.js` 文件仍在。
- Legacy 构建（`npm run build:extension`）与 Native 构建（`npm run build:native`）
  完全独立；两者输出路径互斥（测试断言 + 脚本内硬保护）。
- Legacy 活体冒烟（L3 注入 `dist-extension/` 全链：bridge + vendor + core + content）：
  时间线可信点击 → 浮层打开、正文与 7 条回复卡在位（`exploration-poc/m1` 检查 Run E
  `legacySmoke`）。
- Legacy 119 项原版测试全绿（未删任何断言）。

## 3. 双产物安装/回退说明

见 `native-extension/README.md` §测试安装。要点：同一 Profile 并存安装会导致双注入
（两套 pane/路由观察并存），**测试必须分 Profile 或停用其一**；回退 = 停用 Native、
启用 Legacy，无共享状态、无迁移负担。

## 4. 已知边界（如实声明）

- Native 构建不打包 popup/设置界面：Legacy 的翻译开关等设置项在 Native M1 尚无对应
  UI（功能矩阵如实标记 PARTIAL/未见，见 `m1-feature-parity.md`）。
- `window.__peekNativeTest` 钩子与 DOM 镜像属性仅在 `window.__PEEK_NATIVE_TEST__`
  被外部武装时启用；生产环境无人设置该全局，钩子不存在。
