<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="public/brand/logo-dark.svg"><img src="public/brand/logo-light.svg" alt="ThreadLume" width="420"></picture></p>
<p align="center"><strong>Read Beyond the Post.</strong><br>为 X 提供原生双栏阅读、AI 摘要、视频章节和交互脑图。</p>

[English](README.md) · **简体中文**

[安装](#安装) · [架构](docs/architecture.md) · [工程案例](docs/case-study.md) · [验收记录](docs/validation.md) · [隐私说明](PRIVACY.md)

ThreadLume 将原帖、媒体和评论并排呈现。你可以阅读长文、观看带字幕的视频、展开脑图，再返回时间线继续浏览。

**预览版本：** 面向桌面 Chromium 浏览器，通过「加载已解压的扩展程序」安装。AI 功能需要自行配置兼容 API 服务；基础阅读器无需 AI 即可使用。ThreadLume 是独立项目，与 X Corp. 无隶属关系，也未获其背书。

## 实际效果

![英文帖子的原生双栏阅读](docs/assets/reader.png)

| 长文摘要 | 交互脑图 |
| --- | --- |
| ![英文长文摘要](docs/assets/summary.png) | ![交互脑图](docs/assets/mindmap.png) |

**视频字幕与章节**

![视频原生字幕与 AI 章节](docs/assets/video-captions.png)

**AI 服务配置**

![AI 服务设置](docs/assets/settings.png)

以上均为真实浏览器截图，来源和验证条件见[验收记录](docs/validation.md)。演示视频将另行制作。界面可切换为简体中文，AI 输出语言独立设置。

## 核心能力

- **原生阅读：** 原帖、视频和评论保留 X 自身的交互，在双栏布局中集中阅读。
- **AI 摘要与视频章节：** 总结合适的长文和当前可用字幕，点击章节可跳转至原生播放器的对应位置。
- **交互脑图：** 展开分支、平移、缩放、适应画布并复制结构化大纲。
- **渐进显示：** 可开启流式模式，在完整响应结束前阅读摘要和经过校验的脑图预览。
- **请求控制：** 优先生成当前视图，可停止、显式重试和复用缓存；未完成的输出不会写入成功缓存。
- **自定义 AI 服务：** 自行填写 HTTPS Chat Completions API、模型和 Key，不内置供应商账号。
- **独立语言偏好：** 支持英文和简体中文界面，分别选择并记住 AI 输出语言。
- **浅色与深色主题：** 跟随 X，或为阅读器选择独立主题。

## 安装

准备 Node.js 22.12+、npm 和当前版本的桌面 Chromium 浏览器。

```sh
git clone https://github.com/devon-kong/ThreadLume.git
cd ThreadLume
npm ci
npm run build
```

1. 打开 `chrome://extensions/`，启用「开发者模式」。
2. 点击「加载已解压的扩展程序」，选择 `dist-extension-native/`。
3. 刷新 X 标签页，然后打开帖子。

也可以从 [Releases](https://github.com/devon-kong/ThreadLume/releases) 下载 ZIP，解压后加载包含 `manifest.json` 的目录。

更新时，重新构建、重载扩展并刷新 X。请保持相同的安装目录，以保留扩展身份和本地设置。新的仓库目录或浏览器配置文件不会自动获得原有 API 配置。

## 配置 AI

打开 ThreadLume 设置，点击 **Add AI service／添加 AI 服务**，填写服务名称、HTTPS Base URL、模型和 API Key。点击 **Save, test & enable／保存、检测并启用** 后，只申请该域名的访问权限，并发送最小兼容性检测请求；检测不会发送当前文章。

连接成功后，打开合适的内容会自动生成当前视图；另一个视图在选中时生成。供应商的收费和用量限制仍然适用。流式模式需要主动开启，并在保存时验证；不支持流式时不会自动降级或重发。

**界面语言与 AI 输出语言分别设置。** 切换界面语言仅更新自有控件；切换输出语言会按显式切换规则处理当前任务，各语言的缓存相互隔离。X 原生菜单、评论和帖子正文继续使用 X 自身的语言与原始内容。

原豆包扩展桥接已停用。旧数据仍保留在本地，但不会尝试连接、恢复或调用豆包。请选择已配置的兼容 API 服务继续使用 AI。

## 工程亮点

- **原生页面生命周期：** 通过有界的布局适配、所有权和恢复机制保留 X 虚拟列表中的内容，避免重新实现评论系统。
- **异步可靠性：** 限定任务归属，支持取消、拒绝迟到响应、Worker 恢复和明确的失败状态。
- **服务绑定：** 配置与 Key 版本化，检测成功后原子发布，并按端点处理权限。
- **渐进可视化：** 校验部分输出，控制脑图初始展开深度，保持渲染稳定，各视图使用独立缓存。
- **验证方法：** 行为回归测试、构建隔离检查，以及与离线测试明确区分的真实浏览器证据。

[工程案例](docs/case-study.md)介绍问题、决策及取舍；[架构说明](docs/architecture.md)记录运行时边界。这些技术文档当前为英文。

## 开发

```sh
npm test              # 构建唯一产物并运行 Native 全套测试
npm run build:current # 与 npm run build 输出相同
npm run build:native  # 与 npm run build 输出相同
```

`native-extension/` 为产品代码，`tests/native/` 为回归测试，`scripts/` 为构建工具，`docs/` 为当前技术和发布文档。构建产物和依赖不提交到仓库。

## 支持范围与限制

- 面向桌面窗口；宽度低于 980 CSS 像素时隐藏 AI 面板，保留 X 原生视图。
- 视频 AI 使用当前可用的原生字幕，可能不覆盖整个视频。不下载视频、不做语音识别，也不会自动点击字幕按钮。
- 短帖和没有可用字幕的视频不会生成 AI 内容。
- 阅读器依赖 X 的 DOM 和有界的 React 内部布局适配。X 改版可能导致适配失效，此时将控制权交还原生视图。
- 回复、点赞、收藏等账号操作仍由 X 处理。ThreadLume 不主动发起 X 私有 HTTP API 请求。
- 飞书收藏目前为禁用的未来功能，不属于预览版本的可用能力。
- 模型质量、格式遵循、延迟和可用性取决于所选服务。已验证与未验证场景见[验收记录](docs/validation.md)。

## 项目信息

[贡献指南](CONTRIBUTING.md) · [安全说明](SECURITY.md) · [隐私说明](PRIVACY.md) · [更新记录](CHANGELOG.md)

代码采用 [MIT 许可证](LICENSE)。原有版权声明予以保留，依赖及来源致谢见[第三方声明](THIRD_PARTY_NOTICES.md)。X 和 Twitter 商标属于各自权利人。
