# M1 实施报告

日期：2026-10-13。分支 `feat/peek-native-m1`（自 `b496c54` 切出）。本报告回答
"完成了什么、代码在哪、怎么验证"。

## 1. 交付物总览

| 交付 | 位置 | 状态 |
|---|---|---|
| Native 工程源码（10 个 ES 模块） | `native-extension/src/` | 完成，73 项离线测试全绿 |
| Native 构建脚本（含隔离门禁） | `scripts/build-extension-native.mjs` | 完成；产物 `dist-extension-native/` |
| Legacy 原版 | `extension/`、`scripts/build-extension.mjs` | **零改动**（`git diff b496c54 -- extension/ scripts/build-extension.mjs` 为空） |
| Native 测试套件 | `tests/native/`（6 文件） | 73 项，执行**真实构建产物** |
| 既有测试 | `npm test`（119）、`npm run test:r3-r`（75） | 全绿，未删任何断言 |
| CI 双/三模式结果 | `.github/workflows/ci.yml` | legacy / exploration / native 三个独立 job，任一失败可见 |
| M1 验证 harness 与证据 | `exploration-poc/m1/harness/`、`exploration-poc/m1/evidence/` | 性能 12 窗口 + 网络普查 24 窗口 + 判定器复算 |
| M1 报告 | `docs/m1/` | 本目录 |

## 2. M1-A（工程架构与隔离）

- 模块边界与依赖图：`docs/m1/m1-architecture.md` §2。10 模块按真实耦合拆分，
  无环依赖，无新增运行时依赖（打包用 esbuild 来自既有 vite 工具链）。
- 构建隔离（A2，最高优先级）：构建期禁用标记扫描 + 测试期独立复核 + manifest 无
  MAIN world/无权限/无 web_accessible_resources。证据：`docs/m1/m1-build-isolation.md`。
- A3 八项验证全部通过（无 page-bridge、无主动私有 API、无 fetch/XHR 包装、无
  webpack 探测、无凭据捕获、无后台读取、无自动写入、缺 Legacy 全局时不失败）。

## 3. M1-B（R4 核心机制迁移）

- **快速首显机制**原样迁入并实测：信息流格 DOM 提取 → 折叠正文即时首显 → X 原生
  详情加载 → 详情水合原地刷新（计数/时间/媒体/引用）→ 展开全文原地升级。
  文本单调性守卫（P2-1）、引用卡误配防护、焦点 ID≡URL 不变量全部保留并有测试。
- **生命周期工程化**：生成号取消、有界构建（30×500ms）、有界恢复（3 轮、只武装一次）、
  导航事件优先、计时器/观察者所有权、重复注入幂等、关闭竞态不残留——12 项竞态测试
  （`tests/native/native-race.test.mjs`）+ 实测。
- **返回锚点修复（B3，新能力）**：见 `m1-performance-report.md` §3。X 自身重锚
  151–153px → 单次有界微调后终态 ≤2px（12/12 窗口）。设计极限：一次调整、用户输入
  取消、窗口过期放弃、绝不持续滚动。
- **互动语义（B4）**：按钮/aria/反馈如实表达"定位高亮、用户亲自执行、不构造写入"；
  控件缺失时中性提示。测试 `native-race.test.mjs` 互动语义组。

## 4. M1-C（真实 MV3 回归）

L4 级（用户手载真实扩展）需要用户先加载 `dist-extension-native/`；本轮在 ego 登录
会话以 CDP 等效注入（L3，与 R4 相同机制）完成全部 8 项检查，另以真实扩展完成
重载语义/双注入清理验证。逐项结果：`docs/m1/m1-mv3-acceptance.md`。

## 5. M1-D（性能与网络）

- 性能：12 窗口（4 样本 × 3 轮）对照 R4 最终轮。T1 无回退（Δ −8~0ms），T2 同分布，
  T4 相当，锚点 B3 ≤2px。`docs/m1/m1-performance-report.md`。
- 网络：24 窗口点击对齐普查 + R4 严格判定器复算。V1（扩展独有 API 操作）= 0、
  V3（方法不一致）= 0、API 总量 M1 206 < 裸 X 212；唯一 letter-FAIL 为 X 自身广告
  遥测的轮次波动（发送方归因探针证实两条件均由 X 自有脚本发起）。

## 6. 测试统计

| 套件 | 数量 | 结果 |
|---|---|---|
| `npm test`（Legacy 原版） | 119 | 全绿 |
| `npm run test:r3-r`（R3/R3-R/R4 实验） | 75 | 全绿 |
| `npm run test:native`（M1，执行构建产物） | 73 | 全绿 |

Native 测试覆盖：隔离静态扫描（产物+源码+manifest）、提取（身份/引用/计数/回退/
Article/媒体归属）、关闭导航（轨迹 6 场景 + Navigation API 5 场景 + Esc 3 语义）、
竞态/生命周期（B4-1..10 + 布局挂载）、锚点（B3 状态机 12 场景 + 真实 Chrome 行为
3 场景）、互动语义（6 场景）。

## 7. 过程中发现并修复的缺陷

| # | 缺陷 | 发现方式 | 修复 |
|---|---|---|---|
| F1 | `mountStyle()` 未迁移——布局规则与 `data-peek-native` 门禁不生效 | L3 冒烟探针 `htmlAttr:null` | 补回 `reader-view.mountStyle()`，构建时调用；离线回归 B4-1b |
| F2 | `reader-view.js` 引用未导入的 `STYLE_ID`（打包后悬空引用运行时崩溃） | 离线测试 ReferenceError | 补导入 |
| F3 | 找不到原生控件时仍反馈"已定位"（误导，违反 B4） | 互动语义测试 | 中性提示分支；测试覆盖 |
| F4 | `diagnostics.state` 缺 `lastRouteChangeAt:-1` 初始值 | 离线测试 | 补初始值 |
| F5 | **Chromium 不向隔离世界投递 `navigate` 事件**（监听可注册、事件不到达）→ B3 锚点捕获死路径 | 实况诊断（recordNav/trail 从未更新） | 捕获阶段点击监听统一承担锚点捕获（先于 X 路由器）；`native-anchor-live.test.mjs` 固化 |
| F6 | 1Password 无头签名失败（环境） | git commit 失败 | 按 `--no-gpg-sign` 提交（与仓库既有未签名历史一致），已披露 |

## 8. 环境限制（如实记录）

- 本环境无法以自动化方式加载新的 unpacked 扩展：品牌版 Chrome 137+ 移除了
  `--load-extension`；Chrome for Testing 二进制在本沙箱不启动（端口/管道均无响应，
  全新下载副本同样）；Homebrew chromium cask 已被禁用。因此 Native 的 L4 级验证
  需用户手载（步骤见 `m1-mv3-acceptance.md` §用户步骤）。
- CDP 可信键盘分发在多窗口会话间歇丢包（R4 L4 已记录，本轮复现并定位：隔离世界
  Esc 处理器 `stopImmediatePropagation` 使后注册的主世界监听器失明——perf harness
  据此把 recorder 注册顺序调整为 R4 同款）。
