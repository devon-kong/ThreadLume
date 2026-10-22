<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="public/brand/logo-dark.svg"><img src="public/brand/logo-light.svg" alt="ThreadLume" width="420"></picture></p>
<p align="center"><strong>Read Beyond the Post.</strong><br>在 X 原帖旁阅读 AI 摘要、探索交互脑图、跳转视频章节。</p>

[English](README.md) · **简体中文**

[下载预览版](https://github.com/devon-kong/ThreadLume/releases) · [查看实际效果](#实际效果) · [安装](#安装)

将 X 长文和带字幕视频转成清晰摘要、交互脑图与可跳转章节，同时保留原文、媒体和评论，方便随时对照。

**桌面 Chromium 预览版。** 基础阅读无需配置 AI；AI 功能需要自己的兼容 API 服务，费用由所选服务收取。下载 ZIP 后加载即可，无需 Node.js 或构建工具。

## 实际效果

**把原帖与讨论放在一起阅读**

双栏展示原文、媒体与原生评论，保留 X 自身的交互。

![原帖、AI 摘要与原生评论](docs/assets/reader.png)

**快速找到要点**

在原文旁阅读结构化摘要，再复制到自己的笔记中。

![英文长文摘要](docs/assets/summary.png)

**看清内容结构**

展开分支查看细节，缩放脑图，或将其复制为大纲。

以下为一个展开分支的局部截图：

![展开分支的交互脑图](docs/assets/mindmap.png)

**回到视频中的对应片段**

根据当前可用的原生字幕生成章节，点击时间戳跳转原生播放器。可用字幕可能只覆盖部分视频。

![字幕视频与 AI 章节](docs/assets/video-captions.png)

以上均为真实浏览器截图，见[截图来源与发布验证条件](docs/validation.md#screenshot-provenance)和[本轮展示核验](docs/showcase-validation.md)。界面与 AI 输出语言可分别设置。

## 你可以做什么

- **连贯阅读：**查看原帖、媒体和评论，再返回时间线。
- **提炼与整理：**将合适的长内容转成摘要、脑图或视频章节。
- **控制生成：**随时停止，按需重试，复用已完成的结果；开启流式模式后可逐步阅读临时输出。
- **使用自己的 AI 服务：**配置兼容的 HTTPS Chat Completions 端点和模型。
- **选择语言与外观：**支持英文和简体中文界面，独立选择 AI 输出语言及浅色、深色主题。

## 安装

1. 从[最新预览版 Release](https://github.com/devon-kong/ThreadLume/releases) 下载扩展 ZIP，解压到准备长期保留的目录。
2. 在桌面 Chromium 浏览器打开 `chrome://extensions/`，启用「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择包含 `manifest.json` 的解压目录。
4. 刷新 X 标签页，打开帖子体验阅读器。

**先使用基础阅读，需要时再连接 AI。** 打开 ThreadLume 设置 → **Add AI service／添加 AI 服务**，填写服务信息，点击 **Save, test & enable／保存、检测并启用**。检测只发送最小测试提示，不发送当前文章。

连接成功后，打开符合条件的内容会自动生成当前 AI 视图；选择另一个视图可能发送新请求。文章正文或可用字幕会发送给你选择的服务，其收费与数据政策独立适用。

[详细设置、更新与故障处理](docs/installation.md#简体中文快速设置) · [隐私与数据处理](PRIVACY.md)

## 使用前了解

- AI 面板需要至少 980 CSS 像素宽的桌面窗口。
- 视频 AI 使用可用的原生字幕，不做语音转录；短帖和无可用字幕的视频不生成 AI 结果。
- 请对照原文检查 AI 输出。质量、速度和兼容性取决于服务与模型。
- X 的页面改版可能影响阅读器，你可以返回原生视图；扩展不主动发起 X 私有 HTTP API 请求。

ThreadLume 为独立项目，与 X Corp. 无隶属关系，也未获其背书。

## 开发者入口

扩展使用 Manifest V3、JavaScript 和 CSS，唯一构建产物为 `dist-extension-native/`。

[从源码构建](docs/installation.md#build-from-source) · [架构说明](docs/architecture.md) · [工程案例](docs/case-study.md) · [验证记录](docs/validation.md)

## 项目信息

[贡献指南](CONTRIBUTING.md) · [安全说明](SECURITY.md) · [隐私说明](PRIVACY.md) · [更新记录](CHANGELOG.md)

代码采用 [MIT 许可证](LICENSE)。原有版权声明予以保留，依赖及来源致谢见[第三方声明](THIRD_PARTY_NOTICES.md)。X 和 Twitter 商标属于各自权利人。
