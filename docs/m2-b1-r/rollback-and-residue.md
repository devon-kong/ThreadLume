# M2-B1-R 异常恢复与残留锁定（P1-A / P1-B）

## 恢复失败的两种真实形态

`doUninstall()` 的恢复动作按所有权分两路（契约 §8）：

- **prototype 所有权**：`delete inst[LAD_KEY]` 摘除影子属性。若 X 在安装后将该属性固化（`configurable: false`），`delete` 在非严格 bundle 中**静默失败**——方法还在，但恢复校验 `inst[LAD_KEY] === S.original` 为 false → `restore-verify-failed`。
- **own-data 所有权**：`Object.defineProperty(inst, LAD_KEY, { ...savedDescriptor, value: original })` 精确还原原描述符。若 X 在安装后把属性改为不可配置，defineProperty 直接 **TypeError** → `restore-threw`。

两条路径在修复前都存在同一组缺陷：

1. `safeExit()` 随后用退出原因**覆盖** `lastError`（`restore-threw` 被改成如 `shape-drift`）；
2. `query().possibleResidue` 因此错误返回 false；
3. 后续 `install()` 走 `S = freshState()` 丢弃旧包装引用，然后基于旧包装之上**再次包装**（双重包装链，恢复引用互相覆盖）；
4. route-moved 优雅退出路径还会向控制器谎报 `HEALTH_UNINSTALLED`（干净退出）。

## RESIDUE_LOCKED 状态

修复后（`adapter-core.js` `lockResidue()`）：

- `S.phase = "residue-locked"`，`S.lastError` = 恢复失败原因，**永不被退出原因覆盖**；退出触发原因放在 `exitReason` 单独上报（`HEALTH_ERROR { reason: "restore-threw", exitReason: "route-moved" }`）。
- `S.residueLock` 保留诊断引用集：`{ reason, focusUrlId, gen, hasInstance, hasWrapper, hasOriginal, ownership, lockedAt }`。S 不重置，旧实例/包装/原方法引用保留到页面销毁。
- 包装器自保：`wrapped()` 第一行 `s.phase !== "active"` 即直通 `s.original.apply`——残留状态下 X 的渲染调用全部原样通过（测试 B3），页面继续可用。
- `install()` 在最顶端拒绝一切新安装：`{ type: "ERROR", reason: "residue-locked" }`。无论同焦点、异焦点、路由驱动还是内部重装（测试 B2）。
- `uninstall()` 对残留会话返回 `UNINSTALLED note: "not-active"` 且**不**清除锁（测试 B4）。
- route-moved 分支同样检查恢复结果：失败时上报 `HEALTH_ERROR` 而非 `HEALTH_UNINSTALLED`（测试 B1a 的 wire 断言）。
- 健康检查停止、cell 观察器断开、不再安排任何重试——无重试风暴。
- `query()` 如实暴露：`phase: "residue-locked"`、`possibleResidue: true`、`residueLock` 摘要（不跨 postMessage 泄露原始节点引用）。
- 控制器侧把该状态按请求级 ERROR 处理：双栏 CSS 移除、`failed` 标记、控制台明确提示"刷新页面可重置"（测试 B5 端到端）。

**诚实边界**：恢复失败 ≠ fail-closed 成功。包装可能仍物理存在于 X 实例上（测试 B1b 明确断言 `typeof inst[LAD_KEY] === "function"`），我们保留它、不再碰它、如实上报，唯一恢复途径是页面刷新。

## 同 cell 的 article 替换（P1-B）

### 缺陷

健康检查旧逻辑只判断 `S.cell.isConnected`。X 可能在**保留 cell** 的同时替换其中的 `article`（水合、内容换装）。此时布局标记 `data-peek-lad-focal` 留在旧（已断开）article 上，CSS 选择器 `article[data-peek-lad-focal]` 落空 → 左栏空白；若错误地把新 article 当焦点重绑，则可能把别人的帖子钉在左栏。

### 修复（双重检测）

1. **cell 级 MutationObserver**（`watchCell()`）：安装时对焦点 cell 监听 `childList + subtree`，变更后 120ms 去抖调用 `verifyArticleBinding()`——亚秒级重绑，不等 1.5s 健康拍。作用域仅此一个 cell，绝非全 DOM 扫描。
2. **健康拍兜底**：每次 `healthTick()` 先调 `verifyArticleBinding()`（观察器丢失事件时兜底）。

`verifyArticleBinding()` 决策表：

| 观测 | 动作 |
|---|---|
| cell 内 article 未变 | 无操作（绝大多数 tick） |
| article 暂时消失 | 记 `articleGoneSince`，3 秒（`LAD_ARTICLE_GONE_MS`）内容忍水合间隙；超时 `safeExit("focal-article-vanished")` |
| 新 article 的时间戳链接包含焦点 id（includes 口径，兼容编辑帖 `/history` 链接） | `unmarkArticle()` 清旧标记 → 标记新 article（`articleRebinds++`） |
| 新 article 无法证明属于焦点 | `safeExit("focal-article-replaced-unconfirmed")`，`articleRebindRefusals++`——宁退不留错 |

约束核对：只写属性，不移动/克隆任何 React 管理节点；视频播放器因不涉及节点操作而绝不会被重建（测试 C5 断言父节点不变）；cell 重建（连 cell 一起换）走原有重映射 + 观察器重挂路径（`healthTick` remapped 分支）。

### 实机证据边界

离线 fixture 全覆盖（测试 C1–C6）；真实页面上"X 自然发生同 cell article 替换"无法按需复现——本轮真实会话期间未观测到该事件，`mv3r-checks.json` 如实记录。机制级风险已由 fixture 与实机健康检查（形状失配回退）覆盖。

## 测试映射（tests/native/native-labr-fix.test.mjs）

| 缺陷场景 | 测试 |
|---|---|
| restore-threw + lastError 不被覆盖 + 引用保留 | B1a |
| delete 静默失败（verify-failed）同样进锁 | B1b |
| 残留拒绝新安装、不重复包装 | B2 |
| 残留下包装直通、X 可读 | B3 |
| 冗余卸载不清锁 | B4 |
| 双 world 端到端：锁传播 + 控制器回退 | B5 |
| 同 cell 替换（同焦点）重绑 | C1 |
| 替换为陌生帖 → 安全退出 | C2、C6 |
| 短暂缺失容忍 / 超时退出 | C3 |
| 观察器自动驱动（不等健康拍） | C4 |
| 不移动视频节点 | C5 |
