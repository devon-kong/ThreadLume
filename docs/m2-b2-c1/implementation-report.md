# M2-B2-C1：实现与回归

分支 `feat/peek-native-m2b2c1-content-parity` 从已验收 B2-B `57b216fe8f1c86cc4dad01235d4a46f31914d113` 创建；原稳定恢复点 `stable/peek-native-m2b2a-l4-20261014` 保留。执行前确认了远端 B2-B HEAD 与该 SHA 一致、本地无未提交改动、仅一个主 worktree、无其他活动 Agent。C1 的产物仍须显式使用 lab 构建/加载，不把实验功能升级为默认扩展。

## 产品代码变更：1 个小修复

`native-extension/src/focal-extractor.js` 的投票富媒体识别补当前 X 的 `role="radiogroup" > role="radio"` 结构。旧 `poll`/`vote` testid 仍支持。提取结果同时供即时预览和默认 M1 阅读栏使用；它只显示“投票由原生组件接管”提示，不读取投票状态、不点击选项，也不改变 X 原生投票树。真实公开投票帖的 DOM 明确不含旧 testid，当前语义结构可见。

独立审查发现引用卡内的投票会被误标为主帖投票。用实际默认构建复现后，在同一提取模块按已识别的引用卡 DOM 子树排除主帖的投票、视频、网站卡、Article 正文和普通正文提取候选；引用卡内容仍由 X 原生节点显示。含网站卡的语义引用曾绕过引用识别，随后加入该反例并修正。新增三个引用边界测试均先失败、重建后通过。该边界尚无真实 X 引用投票或引用 Article 样本；多层/多引用仍未覆盖，离线修复不能升级为实机验收。

测试先在真实 DOM 形态的 fixture 中失败（`false !== true`），修正选择器后通过。首次实现曾把浏览器可访问性快照的 `radiobutton` 名称误当成真实 DOM 的 `role` 属性；实机检查发现实际属性是 `role="radio"`，于是同一问题第二次红→绿，错误假设和修正均保留在执行记录中。测试位于 `tests/native/native-extraction.test.mjs`，执行实际默认构建产物的提取逻辑，没有新增“镜像算法”的测试替身。

本轮没有修改 `adapter-core.js`、MAIN-world 通信、虚拟列表、导航/锚点、媒体播放器或皮肤。`adapter-core.js` 与 B2-B 的 SHA-256 均为 `4e350eb7e52025ca2c88e83e02e4f6f3c282de1193601735ab4920c655a6c0f3`。Article 专注模式返回到深滚位置、评论关系不可证明、T2b 有效样本不足等没有低风险且足证的局部修复；继续改这些路径会跨越本包架构边界，故列为 PARTIAL/NOT_TESTED，不虚构修复数。

## 验证

| 命令 | 最新结果 |
|---|---|
| `npm run test:native` | **227 pass / 0 fail**（原 223 项仍在，新增 4） |
| `npm test` | **119 pass / 0 fail**（Legacy 含 Sites，不删断言） |
| `npm run test:r3-r` | **75 pass / 0 fail** |
| `npm run test:sites` | **4 pass / 0 fail**；`dist/client/index.html`、`dist/server/index.js`、`dist/.openai/hosting.json` 存在 |
| `node docs/m2-b2-c1/evidence/scan-native.mjs` | 实际 Native lab 内容脚本及 MAIN 入口禁用模式计数全 0；manifest 无权限/background |

真实浏览器的公开样本、两版本配对原始 JSON、脱敏网络分类与少量截图位于 `evidence/`。性能对照对应引用归属修正前的 C1 受测产物 hash `cec9a4db35`；当前引用归属修正需要单独看最终构建扫描和离线测试，不能把旧实机数据冒充当前产物的性能复测。`perf-c1.json` 属更早的同轮候选构建，不作 Gate 依据。所有真实账号写入均未执行。

## 仍在合同外或待验

本包没有完成评论排序、自动翻译、AI 回复、收藏分类或账号写入；这些不是 C1 修复计数。Premium 极长帖展开、独立 GIF、深层回复分页终止、真实删除/不可访问回复、Article 加粗/斜体与嵌入视频等缺稳定样本。右侧 X 原生列表含广告/推荐，缺父子字段时不应将其算法化为“评论”。
