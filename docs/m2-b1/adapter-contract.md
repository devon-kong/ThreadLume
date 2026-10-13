# M2-B1 适配合同 — X 虚拟列表焦点保留适配器

来源：`exploration-poc/native-split/probe.mjs` 的 `installRetentionProbe()`（f4d7b6c 实验基线）。
本文档是把探针提炼为可构建工程模块的**规范合同**：S1 实现必须逐条满足，S2/S7 按此验收。

## 0. 探针行为的逐点分析（S0 十项核查）

以下行号均指 `exploration-poc/native-split/probe.mjs`。

1. **如何从焦点 cell 找到对应 Fiber**（L28–29）
   取 `cell` 自有属性中第一个以 `__reactFiber` 开头的键（React 17+ 命名；React 16 为 `__reactInternalInstance$`，探针未兼容——工程版需同时兼容两种前缀并记录失败）。随后沿 `fiber.return` 向上走，直到 `fiber.stateNode._getFinalRenderedItems` 存在。走链到 `fiber === null` 即失败。前提认知：被包装的虚拟列表组件是 cell 的**渲染祖先**，因此向上必达（若 X 改为不经过该组件渲染 cell，则此路径失效）。

2. **如何确认目标属于当前详情页**（L4–6，间接）
   探针自身不做 URL 复核：焦点 cell 由 `installSplitProbe` 用「URL status id ↔ cell 内带 `<time>` 的 `/status/<id>` 链接」匹配得出（且排除 `div[role="link"]` 引用卡内的匹配），再把该 cell 传给 `installRetentionProbe`。即“属于当前详情页”靠**安装时的构造**保证；运行期的路径复核由包装函数内的 `location.pathname` 比对（L37）承担。工程版必须把两者都变成显式合同条款（见 §3、§5）。

3. **如何确认实例拥有预期的 `_getFinalRenderedItems`**（L29–31，隐式）
   探针只做两个真值检查：`fiber.stateNode?._getFinalRenderedItems` 存在、`Array.isArray(v.props.list)`。`_cells`（L32）被直接使用但**未校验**（`v._cells.get(...)?.getElement()` 靠可选链兜底）。工程版必须显式校验：`_getFinalRenderedItems` 是 function、`props.list` 是数组、`_cells` 是 Map、返回值是数组且元素含 `item.id`。任一不满足 → UNSUPPORTED，不包装。

4. **如何识别焦点 item ID**（L32–33）
   **不通过 id 与 URL 匹配**，而是通过 DOM 身份：`entry = v._getFinalRenderedItems().find(x => v._cells.get(x.item.id)?.getElement() === cell)`——即“注册的 cell DOM 元素就是焦点 cell”的那个条目。`entry.item.id` 是 X 内部列表键（对详情页通常是 status id，但合同**不得依赖**这一巧合）。工程版同时持有两个身份：`focusUrlId`（URL 派生，用于路由守卫）与 `focusItemKey`（列表键，用于保留注入），二者各自独立使用、不做相等假设。

5. **如何找到 item 在最新列表数据中的位置**（L39）
   每次包装函数被调用时实时 `this.props.list.find(x => x.id === focusItemKey)`——不缓存 item 对象。这保证注入的永远是 X 当前数据里的最新 item 引用。

6. **如何避免返回过期 item**（L39–40）
   同上：注入 `{...entry, item: currentItem, ...}`，item 字段每次现取。若 `currentItem` 不存在（item 已被 X 从列表数据移除），**放弃注入并原样返回**——下次渲染焦点 cell 即被自然回收，不需要强制 React 渲染。这是优雅降级，不是错误。

7. **包装函数返回结构与原函数是否一致**（L35–41）
   - 焦点已在返回集合中 → 返回**原数组引用**，零拷贝。
   - 注入时 → 返回新数组 `[注入条目, ...原数组]`：元素对象引用不变、顺序保持、注入条目插在最前。原数组与其中对象**不被修改**。
   - 注入条目为 `{...entry, item: currentItem, offset: 0, visible: true}`：沿用安装时 entry 的其余字段（含 X 的 key、height 等），仅替换 item 引用、强制 offset 0、标记 visible。
   - 风险（合同明确记录）：每次调用注入条目都是**新对象**（`{...entry}` 展开）。React 调和依赖 entry 的 `key`（被 spread 保留），证据显示视频 DOM 身份保持，但这依赖“X 用 key 而非对象身份调和”这一未承诺行为。`offset:0` / `visible:true` 的完整语义（对列表总高、排序、测量、滚动边界的影响）**未经证明**——探针只证明了“深滚后焦点存活且视频持续播放”，见 §7。

8. **多次进入详情是否会重复包装**（L25）
   探针在入口处 `window.__peekSplitProbe?.undo()` 防叠层。工程版：适配器为**单例状态机**；INSTALL 到已 ACTIVE 的适配器时，先对旧目标执行完整 UNINSTALL（含方法恢复）再安装新目标；包装函数内断言 `this` 是当前受管实例，杜绝包装叠层与跨实例泄漏。

9. **X 更新后内部形状不匹配时如何退出**（L31，仅安装期）
   探针只在安装期 throw；运行期形状变化（如方法被 X 自身替换、`_cells` 消失）无退出路径。工程版补齐：运行期健康检查（§6）发现失配 → 安全退出并恢复方法，见 §8。

10. **恢复原始方法是否真正恢复对象属性结构**（L43，不足）
    `v._getFinalRenderedItems = original` **只做赋值**，永远产生/覆盖一个实例级 own property。若原方法来自 prototype（React class 组件方法的常态），赋值恢复后实例上仍留有一个 own property 遮蔽层：当前行为等价，但 (a) X 后续对 prototype 方法的补丁会被遮蔽；(b) 属性描述符（enumerable/writable/configurable）与原型态不一致；(c) 结构审计无法证明“无残留”。工程版必须按 §8 的所有权感知恢复实现，这是本轮的硬性验收点（G2）。

## 1. 输入

MAIN world 适配器（S1-A）接收的控制输入：

| 输入 | 类型 | 含义 |
|---|---|---|
| `INSTALL` | `{ focusUrlId: string, nonce: string }` | 对当前详情页的焦点帖启用保留适配 |
| `UNINSTALL` | `{ nonce: string }` | 恢复原方法、停机 |
| `QUERY` | `{ nonce: string }` | 只读状态查询（诊断用） |

适配器自己从共享 DOM 派生的输入（不经消息传递）：

- 当前 URL 的 status id（路由守卫）；
- 焦点 cell DOM（与 M1 `focalCellByStatusId` 同源选择器：带 `<time>` 的 `/status/<id>` 链接且不在 `div[role="link"]` 引用卡内）；
- React Fiber 链与虚拟列表实例。

禁止输入：认证信息、GraphQL/REST 元数据、React 对象引用、Fiber 引用。跨 world 消息只允许上表三种类型，载荷只含字符串。

## 2. 输出

- 包装后：焦点条目在 `_getFinalRenderedItems()` 返回集合中持续存在（右栏深滚不被回收）。
- 状态回报（MAIN → ISOLATED，单向通知 + 应答）：

| 状态 | 含义 |
|---|---|
| `ACTIVE` | 已安装并包装，含 `focusUrlId` / `focusItemKey` / 实例标识 |
| `UNSUPPORTED` | 前置条件或形状校验失败（含原因码），未产生任何修改 |
| `ERROR` | 运行期失配，已安全退出（方法已恢复） |
| `UNINSTALLED` | 卸载完成，方法已恢复 |

- 对 X 列表的输出边界：仅在合同成立时向返回集合**前置一个**焦点条目；其他一切（原数组、元素对象、其他列表）零改动。

## 3. 作用域（硬边界）

- 只作用于**一个**明确识别的虚拟列表实例（当前详情页 primary 列表的渲染祖先）与**一个**焦点条目。
- 不遍历页面所有虚拟列表；不包装原型；不修改其他实例；对信息流/搜索/通知列表零影响（由“焦点 cell 必须匹配 URL status id”的安装条件保证——信息流里根本没有该 cell）。
- 不负责：UI、账号交互、认证、网络、翻译、路由劫持。适配器不做任何 `history` / `pushState` 操作。

## 4. 安装前置条件（全部满足才允许包装）

1. 构建/运行开关开启（默认关闭的实验构建）。
2. 当前 URL 是 `/status/<id>` 详情页，`focusUrlId` 与 URL 一致。
3. 焦点 cell 可用 DOM 身份定位（§1 选择器），且 `cell.isConnected`。
4. 从 cell 沿 Fiber 向上找到唯一实例，且形状校验全过（§0.3）：
   `_getFinalRenderedItems` 为 function；`props.list` 为 Array；`_cells` 为 Map；`_getFinalRenderedItems()` 返回 Array 且元素具有 `item.id`。
5. 能通过 DOM 身份把焦点 cell 映射到渲染条目（§0.4）。
6. `Object.getOwnPropertyDescriptor(instance, "_getFinalRenderedItems")`：
   - 无 own descriptor（方法来自 prototype）→ 可包装，记录 `ownership: "prototype"`；
   - own **data** descriptor 且 `configurable: true` → 可包装，记录完整 descriptor；
   - own descriptor 且 `configurable: false` → **拒绝安装**（无法保证恢复）；
   - own **accessor** descriptor → 拒绝安装（非合同形状）。
7. 适配器当前处于 IDLE / UNSUPPORTED(可清理) 状态；ACTIVE 时先卸载。

任一不满足 → 返回 `UNSUPPORTED` + 原因码，且**必须零副作用**（不得留下样式、监听器、计时器）。

## 5. 生命周期

状态机：`IDLE → INSTALLING → ACTIVE → (ERROR | UNINSTALLING) → IDLE`。

- **INSTALL**（ISOLATED 控制器在每个详情路由入口驱动）：
  1. 校验前置条件 → 保存 ownership/descriptor 与原始方法引用；
  2. 安装包装函数（own property，`Object.defineProperty` 按需用与原 own descriptor 相同的 enumerable/writable/configurable，prototype 情形用默认可配置描述符）；
  3. 启动运行期健康检查（有界间隔，默认 1500ms）；
  4. 回报 `ACTIVE`。
- **运行期守卫**（每次包装函数调用，全部为廉价同步检查）：
  URL status id ≠ `focusUrlId` → 原样返回；焦点已在集合中 → 原样返回；`this.props.list` 找不到 `focusItemKey` → 原样返回（自然回收）；实例身份不符（经 `this` 判断）→ 原样返回。
- **健康检查**（MAIN world 自持 interval，非消息轮询）：
  焦点 cell `isConnected === false`、包装方法被替换（`instance._getFinalRenderedItems !== 包装函数`）、`_cells`/`props.list` 形状失配、URL 离开详情页 → 触发安全退出（§8），回报 `ERROR`/`UNINSTALLED`。
- **UNINSTALL**（控制器驱动或健康检查触发）：见 §8。
- **页面卸载/刷新**：无需清理（页面即边界）；合同不依赖 `beforeunload`。

15 项生命周期场景（任务书 S2 清单）的逐项落点见 `lifecycle-and-rollback.md`。

## 6. 不变量

- I1 原方法合同保持：`this`、参数、返回类型一致；非注入路径返回原数组引用。
- I2 不修改原返回数组及其元素对象。
- I3 每次渲染至多注入一个焦点条目；焦点已在集合中绝不重复注入。
- I4 注入的 item 永远来自调用时刻的 `props.list`（无过期 item）。
- I5 URL / 焦点身份不一致时零注入。
- I6 结构失配即终止，不无限重试、不强制 React 渲染、不反复 forceUpdate。
- I7 只影响当前受管实例；其他列表、其他会话零包装。
- I8 卸载后不留实例级方法覆盖（所有权感知恢复，§8）。
- I9 适配器不发起任何网络请求、不读取任何凭据、不调用 X 私有 HTTP API。
- I10 探测、包装、健康检查全部为读操作 + 单实例方法包装；无 DOM 节点搬移/克隆。

## 7. 已知内部依赖与失效模式（必须披露，G13）

| 依赖 | 性质 | 失效表现 | 兜底 |
|---|---|---|---|
| `_getFinalRenderedItems` 方法名与签名 | 未公开内部 API | UNSUPPORTED → 原生单栏 | 安全退出 |
| `_cells: Map<itemId, {getElement()}>` | 未公开内部结构 | 无法映射焦点 → UNSUPPORTED | 安全退出 |
| `props.list`（数组、item.id 键） | 组件 props 形状 | 注入停用，焦点自然回收 | 优雅降级 |
| Fiber `__reactFiber*` / `__reactInternalInstance*` 键 | React 内部 | 找不到实例 → UNSUPPORTED | 安全退出 |
| entry 的 `{item, offset, visible, key…}` 结构 | 虚拟化条目形状 | 注入语义失真（不可静默） | 观测与门禁 |
| “X 按 key 而非对象身份调和” | 未承诺行为 | 焦点 cell 重建、视频重挂 | 健康检查 + 验收观测 |

`{offset: 0, visible: true}` 注入语义的**未验证面**（本轮必须显式验收，不允许以“视频还活着”代替）：

- 右栏内容总高 / 滚动边界是否出现持续的幻影高度或塌缩（对比同一回复数下包装开/关的 scrollHeight）；
- 焦点 cell 高度因 article 移出文档流而塌缩（实测 ~85px）后，X 的偏移测量是否稳定收敛（不持续累积漂移）；
- 渲染集合顺序/去重是否引起可见抖动；
- 长时间深滚后多次注入/回收循环是否产生重复焦点条目（S3 验收项）。

## 8. 回滚策略（所有权感知恢复）

卸载时按安装期记录执行，**不得仅凭赋值**：

```
cur = instance[key]（当前值）
1. cur === 包装函数：
   ownership === "prototype"      → delete instance[key]         // 恢复原型查找
   ownership === "own-data"       → Object.defineProperty(instance, key, 保存的 descriptor)
2. cur !== 包装函数（X 已自行替换/移除包装）：
   → 不触碰当前值（避免覆盖 X 的新方法），仅记录 "already-replaced"
3. delete/defineProperty 抛异常（理论不可达，configurable 已校验）：
   → 记录 ERROR，状态置 UNSUPPORTED-RESIDUE，要求页面刷新（不伪装成功）
```

卸载同时：停止健康检查 interval、移除本模块全部 DOM 标记/样式/监听器/计时器；**不清理** X 自身管理的任何对象与监听器。卸载后以只读断言复核：`instance[key]` 的值/来源与安装前一致，结果写入诊断记录。

## 9. 不兼容情况（预期 UNSUPPORTED 清单）

- X 更名/重构 `_getFinalRenderedItems`、`_cells`、`props.list`；
- Fiber 键前缀变化且未引入新可识别前缀；
- 焦点 cell 不再由带该方法的组件渲染（渲染树重构）；
- own descriptor `configurable: false` 或 accessor 形状；
- `_getFinalRenderedItems()` 返回非数组或元素缺 `item.id`；
- 页面不在 `/status/` 路由（此时控制器根本不应 INSTALL）。

以上全部走 `UNSUPPORTED`/`ERROR` → 控制器拆除自有布局 CSS → **X 原生单栏详情页**。禁止静默退回 M1 复制式双栏，禁止任何形式的重试风暴。

## 10. 与既有模块的关系

- M1-R 阅读副本（`reader-lifecycle`/`reader-view`）：在实验构建中**不启动**（`buildReader` 于适配模式短路到控制器）；默认构建行为与 M1-R 完全一致。
- 路由观察（`route-observer`）：复用其路由事件作为控制器驱动信号；适配器自身不做路由监听（包装函数内的 URL 复核是守卫，不是监听）。
- Legacy 扩展（`extension/`）：零接触；其构建产物与测试不受本模块影响。
