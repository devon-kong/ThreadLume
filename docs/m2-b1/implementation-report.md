# M2-B1 实施报告 — 最小 X 内部布局适配器工程化

分支：`feat/peek-native-m2b1-layout-adapter`（基于 `f4d7b6c` 实验基线）
状态：S0–S6 完成，S7 独立 Reviewer 结论见 `architecture-gate.md`。

## 交付概览

| 交付物 | 位置 |
|---|---|
| 适配合同（S0） | `docs/m2-b1/adapter-contract.md` |
| MAIN world 适配器核心（S1-A） | `native-extension/src/layout-adapter/adapter-core.js` |
| MAIN world 消息入口 | `native-extension/src/layout-adapter/main-world-entry.js` |
| ISOLATED 控制器（S1-B） | `native-extension/src/layout-adapter/controller.js` |
| 共享常量/协议 | `native-extension/src/layout-adapter/constants.js` |
| 双构建系统 | `scripts/build-extension-native.mjs`（默认关 / `--lab` 或 `PEEK_LAYOUT_ADAPTER=1` 开） |
| 生命周期与回退（S2） | `docs/m2-b1/lifecycle-and-rollback.md` |
| 媒体验收（S4） | `docs/m2-b1/media-acceptance.md` |
| 性能与网络（S5） | `docs/m2-b1/performance-and-network.md` |
| 真实 MV3 验收（S6） | `docs/m2-b1/mv3-acceptance.md` |
| 架构 Gate（S7） | `docs/m2-b1/architecture-gate.md` |
| 自动化测试 | `tests/native/native-lab-adapter.test.mjs`(31) / `-controller`(9) / `-build`(5)，共 45 项新测试执行真实构建产物 |
| 浏览器证据 | `docs/m2-b1/evidence/`（JSON + 截图 + 可复跑脚本） |

## 架构（两个边界，一个合同）

- **MAIN world 适配器**：只做一件事——在当前详情页唯一的虚拟列表实例上包装 `_getFinalRenderedItems()`，让焦点条目不被虚拟化回收。安装前完成形状/所有权校验（own descriptor 的 configurable/accessor 检查），卸载按所有权感知恢复（prototype 来源 `delete`，own-data 来源按保存描述符 `defineProperty`），恢复后只读断言。运行期守卫（this/URL/形状/焦点存在性）+ 有界健康检查（重绑/有界重装/安全退出）。
- **ISOLATED 控制器**：路由驱动的会话管理（复用 M1-R 的 route-observer 管线，`buildReader`/`removeReader` 作为 seam）；有界安装重试；只在 ACTIVE 后挂载布局 CSS；失败即回退 **X 原生单栏**（绝不退回 M1 复制式双栏——lab 模式下该路径代码不可达）；主题变量、窄视口媒体查询降级、诚实失败报告。
- **消息协议**：`window.postMessage`，`source===window && origin===页面origin` + 类型白名单 + nonce 关联；载荷只含字符串。合同明确记录：nonce 是关联标记不是安全边界；真正的边界是来源校验 + 适配器零凭据、零写入。

## 内部依赖（G13 如实披露）

依赖 X 未公开内部：`_getFinalRenderedItems` 方法形状、`_cells: Map<id,{getElement}>`、`props.list`（item.id 键）、React Fiber 键前缀、渲染条目结构 `{item, offset, visible, key…}`。全部列于合同 §7 并配失效兜底（UNSUPPORTED/优雅降级/安全退出）。维护成本：X 更名任一形状 → 适配器拒绝安装并回退原生单栏（fail-closed），不会错位渲染。

`{offset:0, visible:true}` 注入语义的验收结论：深滚 5800px 后焦点 stub 高度稳定 85px、无重复注入、无累积几何漂移、同一视频元素持续播放——S3 实测覆盖了合同 §7 列出的全部未验证面。

## 与既有模块的关系（G11）

- 默认构建（`dist-extension-native/`）：manifest 一字不改、无 MAIN world 文件、适配器代码路径死代码化（define false）——M1-R 随时可独立构建，行为等价（控制器源码以常量 false 门控留在默认产物中成为惰性死代码，适配器核心与 MAIN 入口不在默认产物内；P4 测试 + 93 项既有测试全绿 + Legacy 119 项全绿）。
- lab 构建（`dist-extension-native-lab/`）：manifest 注入 `world: "MAIN"` 条目、命名 `Peek Native (M2-B1 Lab)` v0.10.0、两个 bundle 均过禁止标记扫描。
- Legacy（`extension/`）：零接触。

## 构建期隔离闸门

禁止标记扫描（fetch/XHR/webpack/queryId/CSRF/cookie/page-bridge/hls 等）在默认与 lab 的全部产物上执行，build 脚本与测试双重覆盖（P3）。

## 最终问题直接回答（任务书"最终必须回答"）

1. **是否真正实现了单窗口左原帖、右评论？** 是。真实 MV3 加载 + 真实登录页面实测：左栏为唯一原生焦点帖（含正文/媒体/原生操作栏），右栏为原生回复编辑器 + 评论列表，双栏独立滚动。
2. **是否消除了原帖双重展示？** 是。M1 阅读副本在 lab 模式从不挂载（E1/P5）；右栏顶部只剩 85px 的焦点 cell 空桩（article 已固定到左栏），非第二份内容。
3. **左侧视频能否在右侧深滚时持续播放？** 能。右栏深滚 5800px：同一 video 元素（dataset 身份标记）、持续播放、currentTime 连续推进（10.5→25.8s）。
4. **是否只修改一个明确的虚拟列表实例？** 是。适配器单例状态机 + `this !== instance` 守卫 + 焦点 cell 必须匹配 URL status id 的安装条件；对其他列表零包装（B8/B9/A5）。
5. **适配器是否能在所有已测终止路径恢复原方法？** 是。10 条终止路径（路由离开/重装/X 自替换/形状漂移/cell 消失/实例替换/预算耗尽/迟到包装/同焦点幂等/未激活卸载）单元全覆盖（B1/B6/C1–C7/E6），恢复后 `instance[key] === original` 断言 + 无 own-property 残留（prototype 情形）。
6. **哪些 X 内部结构是必需依赖？** 见合同 §7 表（`_getFinalRenderedItems`/`_cells`/`props.list`/Fiber 键/entry 结构）。
7. **X 更新导致失配时能否安全退回？** 能。安装期形状/所有权校验零副作用拒绝；运行期漂移健康检查安全退出并恢复方法；控制器拆布局回原生单栏；失败后路由内休眠，明确报告（C2/C3/B10/B11）。
8. **T1/T2/T4 是否保持 M1-R 水平？** T1 中位数：lab 1583ms vs M1-R 1580ms（+3ms，门槛 50ms）；native 1577ms。T2 受 X 限流窗口污染记录为 INCONCLUSIVE（B vs A 的可用样本 +117ms～+502ms，超门槛——列入 L4 复测关闭）。T4 三模式均毫秒级。
9. **额外内存、CPU、React 渲染及媒体请求开销？** 包装开销 0.23–1.43μs/调用（3000 次直测）；空闲零 long task；深滚帧预算三配置一致（~80ms/10帧，受控实验）；扩展主动私有 API 请求 = 0。详见 performance-and-network.md。
10. **是否仍保持零扩展主动私有 API 调用？** 是。代码级（无 fetch/XHR/webpack/凭据）+ 构建期扫描 + 测试 P3。
11. **真实 MV3 是否完成？** 是——真实扩展运行时（manifest 注入 MAIN world content script、真实扩展 ID、真实 content script 注册管线）在本机 Chromium 152 加载并完成 S3/S4/S6 全部页面级验证；`--load-extension` 的装载机制说明与逐项检查单见 mv3-acceptance.md。
12. **是否可以进入完整 Peek 产品化？** 依 S7 Gate 结论（CONDITIONAL GO/GO/NO-GO）——见 architecture-gate.md。
13. **下一阶段优先补齐哪些原版功能？** 若 Gate 通过：紧凑全局头部（56px）、右栏回复排序与「查看引用」右置、翻译联动、设置页、Esc 关闭回信息流的关闭语义、投票交互式支持、Article 样本补充验收。

## 诚实边界

- S5 的 M1-R（A）基线首跑因 X 软限流全程失败（"出错了"页），已记录并以延时重跑为准——性能结论只引用成功 pass 的数据。
- 早期一轮 lab 深滚测量出现 8s 伪影，受控重测（同窗口同会话三配置背靠背）证明深滚帧预算一致（~80ms/10帧）；该伪影未进入结论。
- Article/GIF 专属 UI/物理键盘 Esc 退出全屏：NOT_TESTED，列入 L4 检查单。
