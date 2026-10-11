# exploration-poc — 第一轮探索 PoC 与证据

本目录是《Peek 优化第一轮探索任务书（评审修订版）》的可撤销实验产物，**不是正式产品代码**。正式产品包（`extension/`、`dist-extension/`）未做任何修改。

## mv3-poc/ — 最小 MV3 原生承载 PoC

零 permissions、零 host_permissions、无 MAIN world、无 fetch/XHR 包装、无 Webpack 探测、无 GraphQL。内容脚本（ISOLATED）仅在 `/status/` 详情页激活：从原生 DOM 提取焦点帖建左栏 + 评论列右移 + Esc/关闭=`history.back()` + 路由离开自动拆除。

运行（隔离配置，不影响用户主配置与登录态）：

```bash
# Chrome 155+ 已移除 --load-extension，用 Edge（或其他仍支持的 Chromium）：
"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
  --user-data-dir=/tmp/peek-poc-profile \
  --no-first-run --no-default-browser-check --disable-sync \
  --load-extension="$PWD/exploration-poc/mv3-poc" \
  "https://x.com/<user>/status/<id>"
```

清理：

```bash
pkill -f "peek-poc-profile"; rm -rf /tmp/peek-poc-profile
```

已验证：Edge 149 + 未登录页面（扩展注入、提取、建栏、样式注入；截图 evidence/s3-mv3-poc.png）。登录态页面集成验收未完成（Chrome 155 无法加载未打包扩展；ego-browser 不支持启动期加载）。

## translation-provider/ — TranslationScheduler（合成验证）

`node --test exploration-poc/translation-provider/translation-provider.test.mjs`（9/9）。

后端契约：`async ({ text, sourceLanguage, targetLanguage, taskId, signal }) => { text }`——X 端点、DBC 或任何符合契约的服务可插拔；本轮未接任何真实服务（DBC 协议未提供）。

## ai-draft/ — AI 回复草稿接口（合成验证）

`node --test exploration-poc/ai-draft/draft-interface.test.mjs`（4/4）。

要点：模型=纯文本→文本函数（无工具/无网络/无凭据）；网页文本以围栏按不可信数据传递；draft-only + human-review-required 元数据强制返回；发送只能由用户在原生编辑器完成。

## evidence/ — 截图证据

S1/S2/S3 各阶段公开区域截图（无账号菜单、凭据、私信、浏览记录）。
