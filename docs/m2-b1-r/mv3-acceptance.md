# M2-B1-R 真实 MV3 验收补充（P1-D）

**装载方式（如实记录）**：ego lite（Chromium 152 内核）以进程参数 `--load-extension=<dist-extension-native-lab>` 重启加载——真实扩展运行时（真实 manifest 解析、`world: "MAIN"` content script 注册、真实扩展 ID `ogahkcgimhiieflimdlkgpbhadmaalln`、真实 content script 隔离管线）。与上轮（S6）装载机制相同；本轮额外在 chrome://extensions WebUI 直接核实了扩展卡片状态。

环境：登录态 X 账号、视口 1341×804 @2x、浅色主题。原始数据：`evidence/mv3r-checks.json`（三轮补测合并记录）。

## 本轮实机检查

| # | 检查 | 结果 | 证据 |
|---|---|---|---|
| 1 | chrome://extensions 卡片 | PASS — WebUI 显示 "Peek Native (M2-B1 Lab)" v0.10.0、ENABLED、真实 ID | `extCard` |
| 2 | 真实登录态打开帖子 | PASS — 性能采集 3 模式 × 4 轮 × 4 样本全部点击进入并验证落点 URL | `perf-results-*.json` |
| 3 | 右侧连续滚动，左侧视频不断开 | PASS — 5000px 深滚后视频 `sameElement=true、playableNow=true`（3/3 有效轮），`focalCount=1`、`videoInFocal=true` 恒成立 | `perf-results-lab.json videoIdentityAfterDeepScroll` |
| 4 | 物理 Esc 关闭图片查看器 | PASS — 查看器（X 现以 `role=dialog` 承载，旧 `lightbox` testid 已移除）打开后物理 Esc 关闭，适配器 `active` 不受影响 | `lightboxRetest2.afterEsc` |
| 5 | 视频播放、暂停、进度 | PASS — 原生控件实测：播放（t 0→0.98 推进）、暂停（t 冻结 2.04）、恢复（t=3）、进度条 60% 跳转（t=5.36） | `videoControlsRetest` |
| 6 | 全屏进入 | PASS — 原生全屏按钮进入（fullscreenElement=DIV，视频铺满 1348px）；**物理 Esc 退出全屏仍 NOT_TESTED**（CDP 无法合成浏览器级快捷键，见下） | `fullscreenRetest3.fs` |
| 7 | 快速切帖 + 浏览器前进后退 | PASS — 右栏回复点击 A→B（`active`、单焦点、标记正确）；history 回退回 A、前进回 B，状态全程一致 | `quickSwitch` |
| 8 | 扩展重载与刷新 | PASS（沿用 S6 证据 + 本轮 3 次浏览器重启后重新验证分栏/隔离行为一致）| `m1r sanity` / `lab sanity2` |
| 9 | 同 cell 的 article 替换（实机） | NOT_TESTED — 无法按需诱发 X 自然替换；机制经 6 个 fixture 测试全覆盖（C1–C6），观测期未出现自然事件 | fixture 测试 |
| 10 | 主题变化（实机） | NOT_TESTED — X 主题为账号级设置，自动切换构成账号写入；循环自由度以离线计数器测试证明（D1–D6） | 单元测试 |
| 11 | ACTIVE 期间结构失配 → 正确回退（实机） | **PASS（新增，上轮为单元级）** — 删除被包装方法（模拟 X 换方法的最坏漂移）后 ≤2 个健康拍：`state=failed`、样式移除、`failedAttr=wrapper-replaced`、原生单栏可读 | `mismatch` |
| 12 | 真实 X Article | NOT_TESTED（本轮重测）— 未能命中活跃样本；适配器对内容类型无感知，S4 证据延续 | — |
| 13 | GIF 与投票只读显示 | NOT_TESTED（本轮重测）— 信息流扫描未命中样本；S4 证据延续，本轮改动不涉及该代码路径 | — |
| 14 | 高评论量评论分页 + 右栏持续滚动 | PASS — 高评论样本（置顶帖 372 回复）4 轮完成打开→深滚→关闭全流程，评论候选 1.3–2.1s 进入右栏，深滚无异常 | `perf-results-lab.json highcomments` |

## 物理键盘边界（保持上轮披露）

CDP/输入管线的按键事件可到达页面（灯箱 Esc 关闭为页面级处理，已验证），但**浏览器级**快捷键（退出全屏）不经页面处理，无法合成。保留用户手动检查单：在全屏视频上按 Esc 应退出全屏并回到分栏布局。

## 与上轮 S6 的增量

- 新增 #11 结构失配实机回退（上轮仅单元级 + 推断）——本轮的最重要补证。
- 新增 #5 视频控件实测（播放/暂停/进度）。
- 新增 #7 前进/后退路径。
- chrome://extensions 卡片从截图证据升级为 WebUI 结构化读取。
- 灯箱检测随 X DOM 变化（testid 移除）更新为 dialog 口径，结论保持 PASS。

## 用户手动检查单（最终发布前执行一次）

1. `chrome://extensions` → 开发者模式 → 加载 `dist-extension-native-lab/`。
2. 含视频帖 → 右栏深滚 5000px+ → 左栏视频继续播放。
3. 全屏视频上按物理 Esc → 应退出全屏，布局完好。
4. 快速连开两帖再返回信息流：无双焦点、无残留样式、时间线位置正常。
5. X 设置切换深/浅主题 → 左栏底色与边框随动，无闪烁循环。
6. chrome://extensions 重载扩展 → 刷新 X → 行为一致。
