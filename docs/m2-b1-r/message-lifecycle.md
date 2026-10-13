# M2-B1-R 消息生命周期与状态一致性（P0-A）

## 消息合同

传输介质：同一 window 上的 `window.postMessage`（`ns: "peek-lad"`）。方向由 `from` 字段区分（`isolated` / `main`）。安全边界仍是 `event.source === window && event.origin === 页面源`；`ns`/`nonce`/`gen` 只做会话关联，**不是**安全认证——同源页面脚本可以观察或伪造任何消息。适配器因此保持零凭证、零网络能力：一条被伪造的消息最多能影响本适配器对**它已拥有的页面**的局部布局，无法获得任何网络或账号权限。

### 两类语义（本轮核心修复）

**请求响应消息**（ISOLATED 发起，必须关联到一条在途请求）：

| 请求 | 响应 |
|---|---|
| `INSTALL { focusUrlId, nonce }` | `ACTIVE { gen, reqNonce, focusUrlId, focusItemKey, ownership, nonce }` / `UNSUPPORTED` / `ERROR` |
| `UNINSTALL { reason, focusUrlId, nonce }` | `UNINSTALLED { reason, restored, note, nonce }` |
| `QUERY { nonce }` | `STATE { state, nonce }` |

**自主状态通知**（MAIN 发起，无在途请求，`nonce` 恒为 `null`）：

| 类型 | 触发 | 附加 |
|---|---|---|
| `HEALTH_ERROR` | 健康检查安全退出（形状漂移/包装被换/焦点丢失/恢复失败/内部重装失败） | `reason`、`exitReason`（触发退出的事件，恢复失败时与 `reason` 不同）、`restored` |
| `HEALTH_UNINSTALLED` | MAIN 自检发现路由已离开，优雅自卸 | `reason: "route-moved"`、`restored` |
| `HEALTH_ACTIVE` | 实例被 X 替换后内部重装成功 | `note: "reinstalled"`、`focusItemKey` |

每条自主通知携带完整关联三元组 `{ gen, reqNonce, focusUrlId }`（`adapter-core.js` 的 `emit()`）。

### 会话代次（gen）

`install()` 每次创建安装会话时 `S.gen = ++genSeq`（模块级单调计数）。`ACTIVE` 响应携带 gen，ISOLATED 控制器存入 `session.gen`。此后：

- 自主通知仅当 `m.gen === session.gen && m.focusUrlId === session.focusUrlId` 才被采信；
- 旧代次、异焦点的通知一律拒绝；
- 自身卸载重置后 gen 保留在状态里仅供诊断。

## 控制器分诊（controller.js `handleMainMessage`）

```
入站消息
├─ type ∈ {HEALTH_ERROR, HEALTH_UNINSTALLED, HEALTH_ACTIVE} → handleAutonomous()
│    ├─ 非本会话（gen/focus 不匹配）→ 拒绝；若当前无 ACTIVE 会话，
│    │   则对通知所报的 focus 发送定向 UNINSTALL（MAIN 端焦点不匹配会忽略）
│    ├─ HEALTH_ERROR   → active/installing 相位: failSession（同拍 removeLayout）
│    ├─ HEALTH_UNINSTALLED → active/installing 相位: dormantSession（干净退出，无失败标记）
│    └─ HEALTH_ACTIVE  → active 相位: 确认会话仍然有效（内部重装已同步）
└─ 其余 → handleResponse()：仅当 m.nonce === session.nonce 才处理（原逻辑）
```

**修复的缺陷**：旧代码对一切消息统一 `if (!s || m.nonce !== s.nonce) return`。自主通知 nonce 为 null，永远被丢弃——MAIN 自主退出后控制器仍认为 ACTIVE，双栏 CSS 残留。新协议下自主通知走独立通道，`HEALTH_ERROR` 到达的同一微任务即移除 `#peek-lad-style`、摘除 `data-peek-lad`、置 `failed` 状态（测试 A2 断言了这一拍内的一致性）。

## 附加加固

1. **ACTIVE 完整性校验**：MAIN 在回答 ACTIVE 前已给焦点文章打标。控制器收到 ACTIVE 后验证 `focalCellByStatusId(focusUrlId)` 的单元内确实存在 `article[data-peek-lad-focal]`，否则视同异常——发送定向 UNINSTALL 并 failSession（`active-without-focal-marker`）。这同时挡住"伪造 ACTIVE"与"标记失败却报告 ACTIVE"两种错位。
2. **UNINSTALL 携带焦点**：`UNINSTALL { focusUrlId }`。MAIN 侧 `uninstall()` 在 ACTIVE 且焦点不匹配时拒绝执行（`focus-mismatch-ignored`）——旧会话的迟到释放命令永远不会误杀新会话的包装。
3. **迟到的 ACTIVE**（会话已失败后到达）：仍按原逻辑发送定向 UNINSTALL 后保持休眠。

## 时序保证

- postMessage 单窗口 FIFO：同一发送方的命令按序到达。
- MAIN 的自主通知在状态变更**之后**发出（`doUninstall` 已完成恢复动作），因此控制器收到 `HEALTH_ERROR` 时，MAIN 侧方法已恢复——双方状态在通知处理完成时收敛一致。
- 路由切换乱序（旧 ERROR 迟到、旧 ACTIVE 迟到）均被 gen/focus/nonce 三重关联挡下（测试 A8）。

## 无法证明的边界（如实披露）

- 真实跨 world 传输（浏览器 postMessage 管线）在离线 jsdom 测试中以合成 MessageEvent 替代（`event.source/origin` 由测试填充）；真实管线行为由真实 MV3 装载验证（`world: "MAIN"` 注册 + 结构失配实机回退 `mv3r-checks.json mismatch` 佐证了双 world 全链路）。
- 同源页面脚本可以伪造 `HEALTH_ERROR` 迫使布局降级为原生单栏——这是无害方向的伪造（fail-closed），且伪造者本就拥有整个页面。
