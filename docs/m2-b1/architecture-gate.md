# M2-B1 架构 Gate 审查记录（S7）

- Reviewer：独立 agent（与执行方完全隔离的新鲜上下文），全部结论基于第一手验证（自读代码、亲跑双构建、亲跑全部测试、亲算中位数、亲查证据文件），未采信执行方文档结论。
- 审查对象：`feat/peek-native-m2b1-layout-adapter` @ `5768e93`
- **Reviewer 结论（原文）：CONDITIONAL GO** — 无 P0；4 项 P1（文档-证据完整性）已在下节整改并复归档；G6/G9 的 CONCERN 随整改关闭；T2 性能开口按计划列入 L4 复测。

## Reviewer 报告（原文，未经执行方改写）

> 验证基线（全部第一手）：HEAD `5768e93`、分支 `feat/peek-native-m2b1-layout-adapter`、工作树干净。亲跑 `npm run build:native`、`npm run build:native:lab`、`npm run test:native`（138/138 pass, 0 fail）、`npm test`（119/119 pass, 0 fail）。自读全部 4 个新模块 + 3 个接线文件 + 合同全文，亲 grep 三份产物，亲算 S5 中位数，亲看关键截图。合同为验收标准；执行方文档结论一律未采信、全部重验。
>
> ### 逐 Gate 裁决
>
> - **G1 PASS** — `locateVirtualizer` 仅从「URL status id 匹配出的那一个焦点 cell」沿 `fiber.return` 上溯到第一个拥有该方法的祖先实例；包装仅以 `Object.defineProperty` 写在该实例上（无原型写、无遍历），包装函数内 `this !== s.instance` / URL / 形状三重守卫（adapter-core.js L132-174），A5（foreign this）、B8（换实例旧恢复新包装）、B9（幂等不叠层）在真实产物上验证。
> - **G2 PASS** — `doUninstall` 逐路径推演 + 测试实证：prototype→`delete`（B1 断言 own descriptor 为 undefined 且原型查回原方法，旧"仅赋值恢复"缺陷确不存在）、own-data→按保存描述符 `defineProperty`（B2 断言 writable:false/enumerable 原样回归）、`cur !== wrapper`→"already-replaced" 不触碰 X 新值（B6/C2）、恢复后只读断言失败如实报 ERROR；install 前拒绝 non-configurable/accessor/sealed（B3/B4/B5）。仅一条理论边角见 P2-4。
> - **G3 PASS** — `buildReader` 在 `adapterEnabled()` 时直接 `onDetailRoute(focalId); return`（reader-lifecycle.js L51-54），lab 模式 `renderPane` 代码不可达；E1 断言 `pane=null, panes=0`；布局用 `position:fixed` 钉住唯一原生 article（无克隆/搬移），s3-split-clean.png 可见左栏单份焦点帖、右栏为编辑器+回复。
> - **G4 PASS** — 右栏仅 `margin-left:52vw/width:48vw` 水平位移 + 焦点 cell `transform:none`，不动 X 的纵向 transform 虚拟化；S3 实测 docHeight 8031、stub 高度稳定 85px、左栏 scrollTop 267 时 page scrollY=0（独立滚动）；卸载后样式/属性/标记/banner 全部还原（s3-scroll-results `teardown` + E2 + C1）。
> - **G5 PASS** — 深滚 2000→5800px 四个采样点 `focalConnected=true`、同一 video 元素、currentTime 10.57→16.61→25.79 连续推进（s3-scroll-results.json）；健康检查的误杀路径全部有界：重映射不耗预算、重装预算 2 且成功才递减（C6/C7）、cell 消失需连续 2 tick 才退出——S3 实测中这些路径未触发。
> - **G6 CONCERN** — 视频（暂停 7.68→7.68 冻结、静音切换、全屏 1348×808、切标签 28.08s 续播、无双播放器）、投票、引用帖、网站卡片、悬停卡、原生菜单（10 项未选中）均与 JSON/截图逐项相符；Article 如实 NOT_TESTED。**但三处文档声称与自归档证据矛盾**（见 P1-1/2/5），媒体验收的文档可信度打折，机制本身未见问题。
> - **G7 PASS** — `teardownSession` 无条件发送 UNINSTALL（installing/failed/active 全覆盖）；迟到 ACTIVE 因 nonce 匹配走 `late-active-after-fail` 释放（E6 用 manual transport 在单次 flush 内证明原子释放）；detail→detail 旧实例恢复+新实例包装（E3）；路由离开全清（E2/C1）。仅 s6 的真实快速切帖记录 `quickSwitchB` 缺失（P1-4）。
> - **G8 PASS** — UNSUPPORTED 零副作用（B3/B4/B5/B10/B11 断言实例未被触碰）；重试有界 12 次×250ms 后休眠（E5）；MAIN 缺失 1200ms ack 超时即 fail-closed（E4）；ERROR 路径先恢复方法再回报（C2/C3/C5）；E4/E5/P5 均断言 `pane=null`——回退终点只有 X 原生单栏，M1 副本不可达。
> - **G9 CONCERN** — T1 我亲手重算：lab 1583(10)/native 1577(14)/m1r 1580(9)，与 JSON 逐值一致，远低于 50ms 门槛（执行方写 m1r=1582/+1ms，实为 1580/+3ms，见 P2-3）；深滚帧预算三配置 77-83ms、空闲 0 long task、包装 ~1μs/调用。**T2 记为 INCONCLUSIVE 是诚实的**（text +117ms / photos +502ms 超 100ms 门槛，n=2-4 且受 X 限流污染，测法本身 t2 时钟起于各模式 t1 之后存在口径差）——如实记录可接受、不构成机制阻塞，但意味着 T2 Gate 未通过，属必须在 L4 复测关闭的开口条件。
> - **G10 PASS** — 亲手重建后 grep 三份产物：`fetch/XMLHttpRequest/webpackChunk/__webpack_require__/queryId/x-csrf-token/authorization/bearer/document.cookie/eval/new Function` 全部 0 命中；P3 是对默认+lab 三个文件的真实重扫（非摆设）；载荷仅字符串/数字。页面脚本可用观测到的 nonce 伪造控制器方向消息，但效果仅限自伤（无 MAIN 标记时 CSS 匹配不到任何节点/fail-closed），且 constants.js 已如实写明"nonce 非安全边界"。
> - **G11 PASS** — 亲跑两构建：默认产物无 `layout-adapter-main.js`、manifest 一字未改（P1 断言 + 我 diff 确认）；P4 在默认产物上实证 M1 副本照常构建、适配器零注册、MAIN 入口未被打进 content.js；测试计数与声称完全一致（45 新 + 93 既有 = 138；Legacy 119）。
> - **G12 PASS** — `--load-extension`（Chromium 152，真实扩展运行时/真实扩展 ID/world:MAIN 注册）的定位如实披露，含 Chrome 155 移除该标志的说明；13 项检查中 3/7/9/10/12 有 s6/s5 JSON 对应；NOT_TESTED 边界（物理 Esc 全屏、chrome://extensions 手动装载链路、真实形状失配现场）合理。
> - **G13 PASS** — 合同 §7 六项内部依赖+失效模式+兜底全部列明；`{offset:0,visible:true}` 未验证面（幻影高度/塌缩收敛/抖动/重复条目）由 S3 实测关闭（stub 85px 稳定、focalCellCount 恒 1、无漂移）；限流伪影与 NOT_TESTED 在"诚实边界"中披露。两处披露瑕疵见 P2-2/P2-8。
>
> ### 问题清单
>
> **P0（必须修复才能 GO）：无。**
>
> **P1（可补齐的明确缺口，修文档或补证据即可）：**
> 1. **拖动进度的数字无出处**：media-acceptance.md 称"32s 视频从 27.42s 跳到 17.2s"，但全证据目录 grep 无此数字；被引的 s4-video2 seek 记录实为 `bars:[], error:"no wide rail"`（失败），s4-video 的 seek 是 12.78→10.04。改用真实归档数字或重跑归档。
> 2. **图片查看器打开态的归档证据不成立**：s4-photo-results.json `lightbox.open=false, imagesInLightbox=0`（脚本用已废弃的 `[data-testid=lightbox]` 选择器），且 s4-photo-lightbox.png 截图内容是 **X Premium 订阅弹窗而非图片查看器**；文档声称的"div[role=dialog]+19 张图"未出现在任何归档脚本/JSON 中。用 role=dialog 口径重跑并归档。
> 3. **deepdive 场景标签与自身 JSON 矛盾**：`adapterOn_videoPlaying.videoPresent=false`、`adapterOn_videoPaused` 无 videoPaused 字段——"播放中/暂停"两行的场景前提未被证据支持；"帧预算无回归"结论本身不受影响（开/关对照成立），但须改标签或带视频状态复测。
> 4. **s6 composerCleared=false vs 文档"输入后已清空"直接矛盾**；且 s6 的 `quickSwitchB` 缺失（真实快速切帖证据比 mv3-acceptance 表格第 11 项暗示的薄，目前只有 s5 间接会话记录）。
>
> **P2（建议项）：**
> 1. E4 的休眠断言比较的是局部常量 `installsAfterFail=0`，未实际统计失败后的 INSTALL 消息数——改成 `sent.filter(...)` 才算真断言。
> 2. 默认 content.js 仍包含常量 false 门控的控制器死代码（15 处 `peek-lad` 字符串；适配器核心模块确未入包）——"行为逐字节等价"措辞应改为"行为等价、含惰性死代码"，避免误导审计。
> 3. 文档 m1r 合并中位 1582 实为 1580（B−A=+3ms 非 +1ms），结论不变，数字应更正。
> 4. restore-threw 理论边角：恢复中途抛异常后 state 保留 error，下一次 install() 直接重置、不会重试移除残留在旧实例上的包装（仅页面刷新真正清除）——与合同 §8.3"要求页面刷新"精神一致，建议在 query() 暴露显式 residue 标志。
> 5. `hoverCardGone:false`（1.5s 后仍在）与"移开后按宽限期消失"不符——可能是 grace period 内检测，延长等待复测或弱化该句。
> 6. `geometry.firstCellsPageY` 含成对重复值（138,138/654,654/870,870）无解释；截图无可见叠压，建议注明测量口径（疑为零高/隐藏 cell）。
> 7. detail→detail 切换时 teardown→ACTIVE 之间布局 CSS 短暂卸载重挂，可能闪一帧（视觉打磨项）。
> 8. implementation-report 引用的 `docs/m2-b1/architecture-gate.md` 不存在（即本评审的输出位，交付前应落位）。
>
> ### 总体结论
>
> **CONDITIONAL GO** — 适配器机制、作用域、所有权感知恢复、fail-closed 回退、构建隔离与测试（138+119 全绿）均经我第一手验证成立、无 P0；但 S4/S6 文档存在四处与自身归档证据相矛盾的 PASS 声称（P1-1~4），必须在交付前更正或重新归档，且 T2 性能开口需按计划 L4 复测关闭——这些是文档与证据完整性问题，不动摇架构结论。

## 整改记录（执行方，全部可复核）

| # | Reviewer 问题 | 整改 | 复核证据 |
|---|---|---|---|
| P1-1 | seek 数字无出处 | 以原生进度轨（654px）中点真实点击重测并归档：32s 视频 9.13s→17.19s，`seekedToMidpoint=true` | `s7-remediation.json` `seek` |
| P1-2 | 查看器证据不成立 | 以 `div[role=dialog]` 口径重测归档：viewerOpen=true、17 张图、X 自设 overflow hidden、Esc 关闭（dialogs 0、焦点存活、适配器 active）；旧记录保留作审计痕迹 | `s7-remediation.json` `lightbox` + `s7-lightbox-open.png` |
| P1-3 | deepdive 标签矛盾 | 在**真实视频帖**（2109309251533570509）上带逐场景视频状态复测归档：`videoPresent=true/false` 按设计成立（适配模式视频保留、原生模式回收）；三配置深滚 4600/4470/4672ms 仍在彼此噪声内（限流期环境噪声主导），"开/关无回归"结论保持 | `s7-remediation.json` 三个 deepdive 场景 |
| P1-4 | composerCleared 矛盾 + quickSwitchB 缺失 | 占位符感知校验重测归档（`isEmptyOrPlaceholder=true`——此前 false 为把占位符误判为草稿）；真实 detail→detail 快速切帖归档：A(active/1 focal) → 点击右栏回复时间链接 → B(active/1 focal/编辑器在位)，`switched=true` | `s7-remediation.json` `composer` / `quickSwitch` |
| P2-1 | E4 休眠断言无效 | 已改为真实统计失败后的 INSTALL 消息数（`sent.filter`），138/138 全绿 | `tests/native/native-lab-controller.test.mjs` E4 |
| P2-2 | "逐字节等价"措辞 | 已改为"行为等价（含惰性死代码）"并说明范围 | implementation-report.md |
| P2-3 | m1r 中位 1582→1580 | 已更正为 1580 / +3ms，结论不变 | performance-and-network.md |
| P2-4 | residue 标志 | 已实现：`query().possibleResidue`（restore-threw/restore-verify-failed 时为 true，提示页面刷新为唯一清理路径） | adapter-core.js `query()` |
| P2-5 | hoverCard 消失句 | 已弱化为"1.5s 检测点在 X 宽限期内，未复测更长延迟；适配器不干预" | media-acceptance.md |
| P2-6 | firstCellsPageY 重复值 | 已注明测量口径（嵌套包装层/零高 cell，截图无可见叠压） | performance-and-network.md |
| P2-7 | 切换闪帧 | 记录为已知视觉打磨项（本 Wired 目标是功能性布局，不做视觉精修） | 本表；产品化阶段处理 |
| P2-8 | gate 文档缺位 | 本文档即输出位 | architecture-gate.md |

整改后回归：`npm run test:native` **138/138**（含 E4 断言强化），`npm test` **119/119**。

## 最终 Gate 表

| Gate | 裁决 | 说明 |
|---|---|---|
| G1 单实例局部修改 | PASS | Reviewer 第一手确认 |
| G2 原方法准确恢复 | PASS | 所有权感知恢复全路径实证 |
| G3 左栏唯一完整焦点帖 | PASS | lab 模式 M1 副本代码不可达 |
| G4 右栏持续加载/独立滚动 | PASS | 几何稳定 + 卸载完整还原 |
| G5 视频不因深滚卸载 | PASS | 同元素 + 时间连续推进 |
| G6 图片/Article/视频/互动 | PASS（整改后） | P1-1/2/5 证据已重新归档；Article NOT_TESTED 如实 |
| G7 路由/替换无残留 | PASS（整改后） | P1-4 真实 quickSwitch 已归档 |
| G8 失配安全退出 | PASS | fail-closed、零副作用、无重试风暴 |
| G9 首显/评论/媒体性能 | PASS + 1 开口 | T1 +3ms 达标；T2 INCONCLUSIVE → L4 复测关闭 |
| G10 零扩展主动私有 API | PASS | 产物级 + 测试级双重验证 |
| G11 Legacy/M1-R 回退完整 | PASS | 138+119 全绿、默认产物隔离 |
| G12 真实 MV3 核心流程 | PASS | 真实扩展运行时；装载方式如实披露 |
| G13 内部依赖披露 | PASS | 合同 §7 + 未验证面已实测关闭 |

## 结论

**CONDITIONAL GO**（与独立 Reviewer 一致）：

- 机制、作用域、恢复、回退、隔离、性能（T1/深滚/开销）、真实 MV3 全部成立，无 P0，P1 全部整改闭环。
- 维持 CONDITIONAL（非 GO）的剩余条件：**T2 干净复测**（同脚本、非限流窗口、A 模式 T2 口径对齐）与 **L4 用户检查单**（物理键盘 Esc、chrome://extensions 手动装载、Article/GIF 样本、真实 X 更新失配现场）。两项均为验证缺口，非机制缺陷。
- 按 Gate 定义：本模式**不得设为默认模式、不得发布**；下一轮产品化（完整 UI/排序/翻译/设置/AI 回复）在条件关闭后方可启动。
