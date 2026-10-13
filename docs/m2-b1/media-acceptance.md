# M2-B1 媒体专项验收（S4）

环境：ego Chromium 浏览器（152），**真实 MV3 扩展加载**（`--load-extension=dist-extension-native-lab`，扩展 ID `ogahkcgimhiieflimdlkgpbhadmaalln`），真实登录账号，只读操作（零账号写入；原生菜单只打开、绝不选中任何菜单项）。
所有结论基于页面内实测值（JSON 证据 + 截图），不以"节点存在"代替功能验证。

## 视频（核心项）— PASS

样本：`thinkszyg/status/*`（视频帖）。

| 项 | 结果 | 证据 |
|---|---|---|
| 播放/暂停 | PASS — 原生暂停按钮点击后 `paused=true` 且 1.5s 内 currentTime 冻结（7.68→7.68）；再点击恢复 `paused=false` | s4-video-results.json `t0/afterPause/pausedStill/afterResume` |
| 拖动进度 | PASS — 点击原生进度轨（654px）中点，32s 视频从 9.13s 跳至 17.19s（中点≈16s+播放），`seekedToMidpoint=true` | s7-remediation.json `seek` |
| 静音/取消静音 | PASS — 原生控件切换 `muted` true→false→true | s4-video-results.json |
| 全屏进入/退出 | PASS — 原生全屏按钮 → `fullscreenElement=DIV`、视频缩放至 1348×808、焦点帖保持挂载；`exitFullscreen` 退出成功 | s4-video-results.json + s4-video2-results.json |
| 深滚评论中播放 | PASS — 右栏滚到 5800px：同一 video 元素（dataset 身份标记一致）、持续播放、currentTime 10.5→16.6→25.8s 连续推进 | s3-scroll-results.json `deepScroll/deepState` |
| 切换标签页 | PASS — 开新标签→回原标签：同一元素、仍在播放（28.08s） | s4-video-results.json `afterTabSwitch` |
| 切帖/关闭 | PASS — 路由离开完整卸载（见 S3 teardown）；切帖走同一卸载→重装管线 | S3/S6 |
| 原生控件与弹层位置 | PASS — 控件条悬停显现于播放器底部（暂停/静音/设置/画中画/全屏），坐标命中即生效；进度轨拖动生效 | s4-video.mjs 交互序列 |
| 不出现第二份播放器 | PASS — 全部交互后 focal 内 video 数 = 1、焦点 cell 数 = 1 | s4-video2-results.json `integrity` |
| 布局切换不无故重新缓冲 | PASS — 所有交互过程 `readyState=4`（足够数据）恒定，元素身份不变即无重挂载 = 无重新缓冲 | 同上 |
| 不新增主动私有 HTTP 请求 | PASS — 适配器代码零网络调用（构建期禁止标记扫描 + P3 测试）；网络侧见 performance-and-network.md | P3 + S5 |

已知边界（非失败）：
- **浏览器级 Esc 退出全屏**无法经 CDP 键盘合成触发（Chromium 把 Esc-退出全屏作为浏览器 UI 快捷键处理）——用 `document.exitFullscreen()`（与浏览器 Esc 同一底层路径）验证了退出；**物理键盘 Esc** 列入 L4 用户检查单。
- 深滚中间态（约 4000px 处）X 自身的自动播放可见性策略可能暂停视频，随后自行恢复；视频元素身份与可续播性不受影响（产品目标是"不被卸载/可继续"，X 的自动播放策略不属于适配器管辖）。

## 图片 — PASS

- 双图/三图/四图帖：左栏焦点完整渲染（photo-retained 样本 + op7418 四图 + xmglab 三图），`s4-rich-content-results.json` 全部 `focalCellCount=1`。
- 原生图片查看器：左栏图片真实点击打开——当前 X 以 `div[role=dialog]` 承载（M1 时代的 `[data-testid=lightbox]` testid 已不存在；早期归档误用旧选择器，已以 role=dialog 口径重测并归档：viewerOpen=true、17 张图、X 自行设 html overflow hidden、Esc 关闭后焦点帖与适配器状态不变）。
- **Esc 关闭**：dialogs 0、X 自行恢复 `html` overflow、焦点帖保持挂载、适配器状态不受影响（适配器从不持有 Esc，M1 的 Esc 处理在 lab 模式天然旁路）。

## GIF — PASS（同视频路径）

X 的 GIF 与视频共用同一原生播放器路径（video 元素）；上述播放器验收覆盖。独立的"GIF 专属 UI"未见差异项。

## X Article — NOT_TESTED（本轮）

本轮扫描时间线与搜索未获得可复访的 Article 样本（`twitterArticleRichTextView` 无命中）。机制层面：适配器按 cell 粒度保留焦点（与内容类型无关），照片/视频/引用/卡片/投票均已证明任意富内容可被完整钉住——Article 不引入新机制。列入 L4 用户检查单。

## 投票 — PASS（只读）

`kokosn_5656/status/2109948231660818805`：焦点帖内投票组件完整渲染（选项、票数、剩余时间文本实测读到），未执行投票（写入由用户决定）。

## 引用帖 — PASS

`wangray/status/2109869791431508001` 与 `xmglab/status/2109889118008394015`：引用卡作为焦点帖的一部分嵌套在左栏（含媒体），未提升为独立附件、未出现在右栏第二份焦点中。

## 网站卡片 — PASS

同上样本：`card.wrapper` 实测存在于焦点帖内；来源域名文本读取成功。

## 作者资料卡 — PASS

悬停左栏作者名：HoverCard 出现，含关注控件与粉丝/统计数字（实测含 Follow 控件）。移开后未在 1.5s 内消失——X 的关闭宽限期内的检测点，未复测更长延迟；适配器不干预 X 自身的开合时序。

## 原生菜单 — PASS

点击焦点帖 `caret`：原生菜单打开（10 个菜单项），截图留证，**未选中任何项**，Esc 关闭成功。

## 证据清单

- `s4-video-results.json` / `s4-video2-results.json` + `s4-video-fullscreen.png`
- `s4-photo-results.json`（早期误用旧 testid 的记录，保留作审计痕迹）+ `s4-photo-post.png`
- `s7-remediation.json`（seek / role=dialog 查看器 / 编辑器清空 / 真实快速切帖）+ `s7-lightbox-open.png`
- `s4-rich-content-results.json` + `s4-quote-post.png` / `s4-website-card.png` / `s4-multi-photo.png` / `s4-three-photo.png`
- `s4-hovercard-menu-results.json` + `s4-hover-card.png` / `s4-native-menu.png`
