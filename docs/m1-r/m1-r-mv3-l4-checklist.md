# M1-R L4 检查单 — 真实 MV3 扩展验收（用户人工执行）

构建产物：`dist-extension-native/`（`npm run build:native` 生成，当前分支 `fix/peek-native-m1-r`）。
与 Legacy 互不影响：`dist-extension/` 为独立目录，建议用**独立 Profile** 同时验证第 9 步。

只读为主：除点赞（第 11 步，可选）外不要求任何账号写入。工程 Gate 不因第 11 步跳过而受阻（保持 NOT_TESTED 即可）。

| # | 步骤 | 预期 | 结果 |
|---|---|---|---|
| 1 | `chrome://extensions/` → 开发者模式 → 加载已解压 `dist-extension-native/` | 加载成功，无错误横幅 | ☐ |
| 2 | 打开时间线，点击任一帖子（时间戳或正文） | 阅读器出现：左栏阅读副本 + 右栏原生评论，无双面板、无残留 | ☐ |
| 3 | `chrome://extensions/` 重新加载扩展后重复第 2 步 | 正常（重载幂等，无双注入） | ☐ |
| 4 | **键盘路径**：在时间线用 X 自带快捷键（如 `j`/`Enter` 或 `o`）打开帖子 | 阅读器**立即**出现（本轮 A1 修复点：旧版此处可能等待至 2 秒轮询） | ☐ |
| 5 | 物理键盘 `Esc` 关闭阅读器 | 关闭并回列表；无额外历史回退（一次 Esc 只退一页） | ☐ |
| 6 | 打开含图帖 → 点击图片进入 X 原生图片查看器 → 按 `Esc` | 只关闭图片查看器；再按 `Esc` 才关闭阅读器（Esc 归属正确） | ☐ |
| 7 | 连续打开/关闭 5 次（不同帖子） | 每次单面板、无残留、无滚动异常 | ☐ |
| 8 | 深色/浅色切换（X 设置或系统） | 阅读器跟随 X 当前主题 | ☐ |
| 9 | 独立 Profile 安装 `dist-extension/`（Legacy） | Legacy 可正常安装使用（回退能力完好） | ☐ |
| 10 | **一次性只读探针**（本轮新增，回答 A1 的平台边界问题）：控制台执行下方脚本后，用键盘打开任一帖子 | 输出 `navDelivered` 字段：true=当前 Chrome 向扩展世界送达 navigate 事件；false=不送达（title 共主信号为必需路径）——两种结果均属正常，仅作记录 | ☐ |
| 11 | （可选）对一条真实帖子点赞，检查右侧原生控件与左栏定位高亮反馈 | 点赞成功且由你本人点击；左栏只定位不代点 | ☐ |

第 10 步探针脚本（在 x.com 页面控制台执行，仅读取，不改任何状态）：

```js
(() => {
  // 在页面主世界标记一次，看扩展（隔离世界）能否通过 DOM 观察到路由变化时间戳
  const before = document.documentElement.getAttribute("data-peek-native-route-change-at");
  // 请在执行本脚本后用键盘快捷键打开一篇帖子，再次执行：
  //   const after = document.documentElement.getAttribute("data-peek-native-route-change-at");
  // after > before 即路由被即时观察（title 或 navigate 路径生效）
  console.log({ before, navDelivered: "见注释：键盘导航后对比 after" });
})();
```

更直接的判定（二选一即可）：键盘打开帖子时阅读器**立即**出现 = 第 4 步通过，无论事件是否送达（两条检测路径任一生效即达标）。

## 判定口径

- L4 通过 = 第 1–9 步全部符合预期（第 10 步仅记录，第 11 步可选）。
- 任何一步不符合 → 记录现象与截图，回到 M1-R 修复循环。
- 未执行本检查单时，M1-R 状态保持 CONDITIONAL GO（自动化 Gate 已通过）。
