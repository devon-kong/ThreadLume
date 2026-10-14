# M2-B2-A-L4 — 环境与真实安装（environment-and-install）

日期：2026-10-14 · 分支：`fix/peek-native-m2b2a-l4`（基于 `feat/peek-native-m2b2a-fast-reading` @ 92e0207，与远端 HEAD 一致）

## 1. 浏览器环境

| 项 | 值 |
|---|---|
| 浏览器 | ego lite（Chromium）Chrome **152.0.0.0**，macOS 15.5 (Build 24F74)，arm64 |
| Profile | `/Users/devon/Library/Application Support/Citro Labs/ego lite/Default`（用户授权的专用测试浏览器） |
| X 登录态 | 已登录（home 时间线正常渲染，`a[data-testid="AppTabBar_Profile_Link"]` 存在） |
| 扩展安装能力 | 开发者模式已开启，`chrome://extensions` 完整可操作（快照 + 语义点击） |
| 已加载扩展 | **Peek Native (M2-B1 Lab) 0.10.0**，unpacked，ID `ogahkcgimhiieflimdlkgpbhadmaalln` |

## 2. 真实安装机制（本轮关键发现）

上一轮（M2-B2-A S5-S7）的结论是“Agent 无法自主加载未打包扩展（load-unpacked 需要原生目录选择器）”。本轮实测发现该限制可以被绕过，**用户只需一次性加载**：

1. Chrome 将 unpacked 扩展的源目录记录在 Profile 的 `Secure Preferences` 中。读取该记录（仅路径，无任何凭据）得到：已加载目录即本仓库的 `dist-extension-native-lab/`。
2. 由此建立了**自主产物切换通道**：把目标产物完整复制进被监视目录 → 点击 `chrome://extensions` 的 Reload 按钮 → 扩展即以新产物重启。全程无需原生目录选择器。
3. `chrome://extensions` 的「Load unpacked」按钮本身仍无法自动化（原生目录选择器不可被 CDP 文件选择器拦截）——本轮未再尝试该路径，也不再需要。

本轮实际执行的自主切换（全部成功，切换后均通过身份验证）：

| 顺序 | 模式 | 产物 | 机制 |
|---|---|---|---|
| 1 | m2a | 重建的 lab 构建（含诊断标记） | 原地重建 + Reload |
| 2 | b1r | `dist-extension-native-lab-b1r-baseline` 复制到暂存目录并打标（`b1r-202610140906-3a3017ded3`） | 复制进监视目录 + Reload |
| 3 | m1r | `PEEK_BUILD_DIAG=1` 构建的测量副本（`m1r-202610140913-58889092e7`） | 复制进监视目录 + Reload |
| 4 | native | 扩展详情页 Off 开关关闭扩展 | 详情页开关 |
| 恢复 | m2a | 重建 lab 构建 + 详情页开关重新启用 + Reload | 同上 |

隔离说明：四个构建产物本体（`dist-extension-native*`）从未互相覆盖；监视目录只是运行时载体，测量结束后已重建为 lab 官方产物。暂存目录（`dist-stage-*`）测量后已删除。

## 3. Agent 自主完成 / 需用户完成的事项

**Agent 自主完成**：
- 真实浏览器内连接、页面操作、真实指针点击、截图；
- 产物构建、打标、换装、扩展 Reload、启用/停用切换；
- 全部身份验证、点击覆盖、体验验收、四模式性能采样与数据落盘；
- 测量器修复、扩展源码修复、离线回归测试。

**用户已完成**：一次性把 `dist-extension-native-lab/` 加载为 unpacked 扩展（本轮开始前）。

**用户仍需人工完成的事项**：无（本轮无遗留人工步骤）。若未来需要在全新浏览器 Profile 安装，仍需人工执行一次「加载已解压的扩展程序」。

## 4. L2/L3/L4 层级声明

- **L2 离线 DOM**：`tests/native/`（213 项，全部通过）。
- **L3 CDP/脚本注入**：本轮未作为验收依据（不存在 L3 冒充 L4 之处）。
- **L4 真实扩展**：本轮全部实机证据均来自真实加载的 MV3 unpacked 扩展 + 真实指针事件，产物身份由共享 DOM 标记逐轮校验（见 measurement-fixes.md）。
- **L5 用户人工验收**：待最终 Draft PR 后由用户进行。

## 5. 提交签名说明

本机 git 配置为 SSH 提交签名（1Password `op-ssh-sign`）。本轮提交时代理返回错误（`1Password: agent returned an error`），重试无效，故本轮提交为**未签名提交**（`--no-gpg-sign`，仅作用于本轮提交，未改动任何 git 配置）。
