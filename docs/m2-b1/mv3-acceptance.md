# M2-B1 真实 MV3 扩展验收（S6）

**装载方式（如实记录）**：本机验证浏览器（ego，Chromium 152 内核）以 `--load-extension=<dist-extension-native-lab>` 加载——这是**真实扩展运行时**（真实 manifest 解析、`world: "MAIN"` content script 注册、真实扩展 ID `ogahkcgimhiieflimdlkgpbhadmaalln`、真实 content script 隔离管线），非 CDP 等效注入。背景：Chrome 155 已移除 `--load-extension`（本机 Chrome 155 与 Chrome for Testing 155 实测均忽略该标志），Chromium 152 仍支持。与"chrome://extensions 手动加载已解压扩展"的差异仅在选择器来源，装载后的运行时行为一致。此点如实标注，供 Reviewer 权衡。

## 13 项检查

| # | 检查 | 结果 | 证据 |
|---|---|---|---|
| 1 | 正确安装与启用 | PASS — chrome://extensions 显示 "Peek Native (M2-B1 Lab)" v0.10.0，ENABLED；manifest 含 `world: "MAIN"` 条目（P2 构建测试） | 截图（扩展卡片）；P2 |
| 2 | 从信息流点击进入详情 | PASS — S5 harness 30+ 次真实时间戳链接点击 | s5-results-*.json |
| 3 | 左右分栏自动建立 | PASS — 详情页自动出现固定左栏（文章标记 + 样式 + html 属性），无需任何手动操作 | s3-split-clean.png；s6-mv3-checks.json `splitA` |
| 4 | 左侧原生视频正常 | PASS — 播放/暂停/进度/静音/全屏/标签页切换全套（S4） | s4-video-*.json |
| 5 | 右侧连续深滚 | PASS — 5800px+ 深滚，焦点存活、评论持续加载 | s3-scroll-results.json |
| 6 | 图片查看器及 Esc | PASS — 左栏图片打开原生查看器，Esc 关闭（X 自行恢复 overflow） | s4-photo-*.json |
| 7 | 回复编辑器 | PASS — 右栏编辑器真实输入成功（输入后已清空，从未发送）；占位符状态确认 | s6-mv3-checks.json `composer` |
| 8 | 关闭恢复 | PASS — 离开详情：样式/属性/标记清零、banner 恢复、方法恢复（prototype-owned property 删除） | s3-scroll-results.json `teardown` |
| 9 | 扩展重新加载 | PASS — dev-mode Reload 按钮 + 页面刷新后：适配器重新 ACTIVE、单焦点、无 M1 面板、无双 pane | s6-mv3-checks.json `devReload/afterReload` |
| 10 | 页面刷新 | PASS — 刷新即全状态重置（页面即边界），重新 INSTALL 正常 | 同上 + S5 各轮 goto |
| 11 | 快速切帖 | PASS（真实+单元）— 真实：A 打开(active/1 focal) → 快速离开 → idle/0 focal 零残留；detail→detail 语义由真实构建产物单元测试 E3 覆盖（旧实例恢复+新实例包装+样式保持） | s5 会话记录；单元 E3 |
| 12 | 禁用扩展后原生 X 恢复 | PASS — 管理页禁用后所有页面为原生渲染（S5 native 基线整个 pass 即运行在禁用态扩展的浏览器上）；重新启用即恢复适配 | s5-results-native.json 全程 |
| 13 | 不兼容结构时自动安全退出 | PASS（单元级 + 真实回退路径）— 形状/所有权校验的 10 种失配在真实构建产物单元测试中全部走 UNSUPPORTED/ERROR 且方法恢复（B3/B4/B5/B10/C2/C3/C5/C7）；真实浏览器验证了回退终点（窄视口降级 = CSS 全部卸载 → 原生单栏正常渲染；MAIN 缺失 → `data-peek-lad-failed` 诚实标记）——"X 更新致真实失配"无法在本轮人为制造，列入 L4。 | 单元套件；s3-viewports.json 960×800 |

## CDP 等效注入的定位（任务书要求）

本轮 S3–S6 的页面级证据全部来自上述**真实扩展运行时**，不是 CDP `addScriptToEvaluateOnNewDocument` 等效注入。M1 时代的 L3（CDP 注入）结论不用于本轮任何 PASS。

## 物理操作边界（NOT_TESTED → L4 用户检查单）

- 物理键盘 Esc 退出视频全屏（CDP 无法合成浏览器级快捷键；`exitFullscreen()` 同路径已验证）
- 真实点击 chrome://extensions「加载已解压的扩展程序」的装载链路（本轮为命令行装载；manifest 解析/世界注册已实证）
- X 更新导致真实内部形状失配的现场回退（单元级已全覆盖）
- X Article 真实样本、GIF 专属 UI

## 用户手动检查单（最终发布前执行一次）

1. 在你的 Chrome（155+）中以 chrome://extensions → 开发者模式 → 加载 `dist-extension-native-lab/`。
2. 打开一条含视频的帖子 → 右栏深滚 5000px+ → 视频继续播放、左栏不卸载。
3. 按 Esc 退出全屏视频；按 Esc 关闭图片查看器。
4. 快速连开两帖再返回信息流：无双焦点、无残留样式、时间线位置正常。
5. chrome://extensions 重载扩展 → 刷新 X：行为一致。
6. 关闭（禁用）扩展 → 刷新：X 完全原生。
