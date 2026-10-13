# M2-B1 生命周期与失败回退

适配合同：`adapter-contract.md`（§5 生命周期 / §8 回滚策略）。
本文档逐项映射任务书 S2 的 15 项生命周期场景到实现机制与验证证据（单元测试 + 真实浏览器证据）。

## 实现的防御层（按响应顺序）

1. **包装函数内守卫**（每次调用，廉价同步）：`this` 身份、URL focusId、返回数组形状、焦点是否已在集合中、`props.list` 是否仍含焦点 item。失配即原样返回，绝不注入。
2. **MAIN world 健康检查**（1500ms interval，仅在 ACTIVE 时运行）：包装方法是否被替换、实例形状是否漂移、焦点 cell 是否存活（可重绑则重绑、实例被替换则有界重装、彻底丢失则安全退出）、路由是否已离开。任何异常路径都先恢复原方法再回报。
3. **ISOLATED 控制器会话**：每个详情路由一个会话；有界安装重试（12 次 × 250ms）；ack 超时（1200ms）即判定 MAIN 缺失；失败后休眠直到路由变化；CSS/属性/标记只在 ACTIVE 后挂载，任何失败路径移除。
4. **所有权感知卸载**（合同 §8）：prototype 来源 → `delete` 实例属性；own-data 来源 → `Object.defineProperty` 按保存的描述符原样恢复；X 已自行替换 → 不触碰当前值；恢复后只读断言 `instance[key] === original`，断言失败如实报 ERROR（不伪装成功）。

## 15 项场景逐项

| # | 场景 | 机制 | 证据 |
|---|---|---|---|
| 1 | 从信息流打开帖子 A | route-observer → `removeReader`(lab=offRoute) → `buildReader`(lab=onDetailRoute) → INSTALL → ACTIVE → 挂布局 | 真实浏览器：S3 初始截图；单元 E1 |
| 2 | 从 A 进入回复 B | checkRoute detail→detail：offRoute(UNINSTALL+恢复 A 的实例方法) → onDetailRoute(B) INSTALL | 单元 E3 + B8；真实切换见 S6 |
| 3 | 从 A 进入引用帖 C | 同 #2（引用帖是普通 detail 路由）；引用卡点击仍由 X 原生处理 | 同上 |
| 4 | 浏览器前进/后退 | popstate → checkRoute → 同一路由管线；适配模式不注册额外 popstate 逻辑 | M1-R 既有路由测试覆盖管线；lab 管线复用同一路由事件（E2/E3） |
| 5 | 关闭阅读器 | 适配模式无阅读器；离开详情路由 = offRoute：UNINSTALL + 样式/属性/标记清理 → 原生单栏 | 真实浏览器：s3-scroll-results.json `teardown`（idle/样式移除/banner 恢复） |
| 6 | 刷新详情页 | 页面即边界：全状态随文档销毁；刷新后重新 INSTALL | 真实浏览器 S6 重载项 |
| 7 | 重新加载扩展 | Chromium 行为：旧内容脚本孤儿化但继续工作（纯 DOM/消息，不依赖 chrome.runtime）；刷新页面后新实例接管；MAIN 入口有 `__peekLayoutAdapterMainInstalled` 幂等守卫 | 单元（幂等守卫 A9/B9）；S6 执行重载项 |
| 8 | 快速切换 A→B→C | 会话按 focusUrlId 幂等；消息 FIFO 保证 UNINSTALL 先于下一 INSTALL 被处理；旧会话迟到响应按 nonce 丢弃 | 单元 E7 + B8；S6 快速切帖项 |
| 9 | X React 重新水合 | 健康检查重绑：焦点 cell 被重建 → 以 DOM 身份重新映射 `_cells.get(key).getElement() === 新cell` → 迁移标记继续适配 | 单元 C4 |
| 10 | 虚拟列表实例替换 | 健康检查发现映射失败 + cell 存在 → 有界内部重装（预算 2，成功才递减，不重置）；预算耗尽 → missStreak×2 → 安全退出 | 单元 C6/C7 |
| 11 | 原生焦点 item 删除或失效 | 包装守卫：`props.list` 找不到 focusItemKey → 停止注入，焦点 cell 自然回收，不做强制渲染 | 单元 A6 |
| 12 | 视频播放中关闭/切帖 | offRoute → UNINSTALL → 方法恢复；视频生命周期由 X 自己管理（布局 CSS 移除后回到原生单栏渲染） | 真实浏览器：S4 视频序列 + S3 teardown |
| 13 | 图片查看器打开时切换路由 | 适配器不触碰 X 的模态；Esc 归 X（lab 模式下 M1 的 Esc 处理因 pane 不存在而天然旁路）；路由离开只清理自有资产 | 真实浏览器：S4 lightbox Esc（adapterState 保持 active、焦点存活） |
| 14 | 异常退出、重入、重复注入 | install 幂等（同焦点 already-active）；重入走 teardown→fresh；MAIN 入口幂等守卫防双重注入；迟到 ACTIVE 后自动下令 UNINSTALL | 单元 B9、E6（迟到包装在一个 flush 内被原子释放） |
| 15 | X 页面更新致内部字段变化 | 形状校验（方法/props.list/_cells/返回数组/entry.item.id）+ 所有权校验（sealed/non-configurable/accessor 拒绝）→ UNSUPPORTED 零副作用；运行期漂移 → safeExit | 单元 B3/B4/B5/B10、C2/C3 |

## 安全退出后的最终状态（合同 §9）

- 恢复优先级：**X 原生单栏详情页**。禁止静默退回 M1 复制式双栏（lab 模式下 `buildReader` 被短路，回退路径在代码上不可达）。
- 控制器 `failSession`：移除样式与 html 属性、写 `data-peek-lad-failed=<reason>`、`console.warn` 明确报告（含"刷新页面可重置实验状态"）、该路由内休眠（不再 INSTALL）。
- 清理清单（teardownSession/removeLayout）：方法包装、自有 CSS（`peek-lad-style`）、`data-peek-lad`/`-state`/`-failed` 属性、`data-peek-lad-focal` 标记、主题 MutationObserver、ack/retry 计时器、健康 interval。**不清理** X 自身管理的对象与监听器。
- 无法安全恢复的异常（restore-verify-failed / restore-threw）：状态置 ERROR，报告要求页面刷新，不继续注入。

## 与 M1-R 的关系

- 默认构建：`__PEEK_LAYOUT_ADAPTER__ === false`，`adapterEnabled()` 恒 false，全部入口 no-op——行为与 M1-R 完全一致（测试 P4 验证）。
- lab 构建：M1 阅读副本永不挂载（`buildReader` 短路 + E1/P5 验证）；锚点恢复（onReturnToList 的滚动校正）在适配模式被门控关闭，交还 X 原生的信息流滚动恢复（route-observer 注释与单元 E2）。
