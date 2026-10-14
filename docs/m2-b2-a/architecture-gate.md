# M2-B2-A 架构准入（独立 Reviewer）

## 独立 Reviewer 复核（G1–G14）

Reviewer 为独立 Agent：逐行阅读 `9dd18a8..HEAD` 全部差异与新增文件全文，自建 10 个
对抗性探针针对真实构建产物，自行重建双产物并重跑三套测试（native 190/190、r3-r
75/75、主 119/119——与声称一致），并独立复算了 S0 报告引用的 M2-B1-R 原始中位数。
复核基线：`9dd18a8`（M2-B1-R GO）；复核时点 HEAD 的 docs 提交经核实无源码差异。

| Gate | 结论 | 要点 |
|---|---|---|
| G1 M2-B1-R 核心适配器无回归 | **PASS** | `adapter-core.js` 零修改（diff 为空）；差异限定于 preview-layer（新）、route-observer 两个调用点、controller（预览钩子 + 收养移除）、重试常量、main.js 测试钩子；B1-R 全系列 A/B/C/D/E/G 测试绿 |
| G2 预览身份始终正确 | **PASS** | 捕获期单次同步判定（链接 id == cell 自有时间戳 id == 提取 statusId）；路由确认与 handoff 双重身份核对，不匹配即清除；探针 B/F 证实 detail→detail 与 traverse 循环无错位浮层 |
| G3 接管不出现两份原帖 | **PASS（离线）** | `handleResponse(ACTIVE)`：核验标记 → mountLayout → 清预览在同一同步任务，浏览器无法在中间绘帧；预览 z-index 58 < 钉住帖 59 兜底；实测 `dupFrames` 待操作员数据 |
| G4 无错误内容与长期残留 | **PASS（离线）** | 全部退出路径（mismatch/leave/超时/替换点击/handoff/fail/dormant/teardown/卸载）代码+探针双验证，无孤儿浮层/计时器残留；引用卡与详情页 fail-open；视频节点零克隆 |
| G5 T1a 改善、T1b 不退化 | **INCONCLUSIVE** | 扩展模式数据 PENDING-OPERATOR；机制论证成立（同 M1-R 快路径提取器、更早触发），但无数值不宣称 |
| G6 T2 无持续回归 | **INCONCLUSIVE** | 评论路径本轮未触碰；数值门槛待同日配对 |
| G7 T4 不退化 | **INCONCLUSIVE** | 关闭路径未触碰；待操作员数据 |
| G8 视频/图片/评论正常 | **PASS（离线）** | P11/P14/P15 + B1-R G 系列绿；m2a 真机媒体检查 NOT_TESTED |
| G9 零扩展主动私有 API | **PASS** | 双产物扫描无 fetch/XHR/queryId/csrf/凭据/webpack 标记；构建时扫描 + isolation 测试复扫双把守；预览 `<img>` 为已显示 pbs.twimg.com URL 的页面子资源（与 M1-R 同级） |
| G10 未扩大 React 内部修改 | **PASS** | preview-layer 零 fiber/webpack 引用（grep 验证）；仅自建浮层/样式节点；adapter-core 未动 |
| G11 MAIN/ISOLATED 通信与异常回退（含 S6） | **PASS** | Q1–Q6 + A11 重写全过；**伪造消息含真实 ns/from 字段，非空真测试**（Reviewer 专查此点）；收养移除安全性经路径分析：内部重装仅在 phase=active 时发生（continuesSession 必然保持 gen），重装中途失败以旧 gen 上报 HEALTH_ERROR，严格相等仍采信——无合法搁浅路径；探针 D/I 补证 installing 期伪造与无标记 ACTIVE 均 inert |
| G12 默认 M1-R 与 Legacy 可用 | **PASS** | 默认产物 `adapterEnabled === false`、manifest 原样、预览仅存在于死门后（P12 真实产物验证）；Legacy 119/119、r3-r 75/75、Legacy 文件零触碰 |
| G13 真实 MV3 核心验证 | **NOT_TESTED** | M2-B2-A 产物待操作员（OPERATOR.md；harness 内置产物身份守卫）；B1-R 的真机 GO 覆盖未变的适配器核心 |
| G14 感知速度收益与代价如实 | **PASS** | S0 逐轮数据复核一致；未测列无数值宣称；字号差/毫秒级同帧重叠/无关点击清除均如实列为取舍 |

## Reviewer 综合结论

**CONDITIONAL GO**。离线工程质量扎实（对抗探针未能打破预览状态机与协议收敛），
条件如下：

1. **操作员真机跑**（OPERATOR.md：m2a/b1r/m1r + performance-comparison.md §2 预注册
   门槛）。强制项：`dupFrames = 0`、`leftoverPreviewFrames = 0`；T1b/T2/T4 在各自
   非回归门槛内；T1a 对 ≤100ms 目标如实报告。
2. **重试节奏预注册回退**：若 T1b 超门槛退化，或 `data-peek-lad-failed="reinstall-failed:*"`
   显著多于 b1r 基线（60ms 重试可能相对 X 水合更早落包装；重装预算仅 2，耗尽即
   fail-closed），回退 `LAD_INSTALL_RETRY_MS/MAX_ATTEMPTS` 为 250/12（两常量 + E5
   同步回退）。
3. （非阻塞）P3 清理——**已于本轮内完成**（见下）。

## Reviewer 发现与整改（本轮内完成）

| 发现 | 级别 | 整改 | 验证 |
|---|---|---|---|
| `mountPreview` 若在 appendChild 与 `P = {...}` 之间抛异常会留下不可清除的孤儿浮层 | P3 | `P` 先于 DOM 挂载武装（preview-layer.js 重排） | 代码审查；P 系列全绿 |
| 迟到 ACTIVE 分支对 phase=active 也触发释放——同源脚本回放一条真实 ACTIVE 即可令活动包装被释放（B1-R 遗留面） | P3 | 分支收紧为 `phase === "failed" || "dormant"`；active 回放直接忽略 | 新增 R1（回放 ACTIVE → 零释放、会话保持、CSS 保持）、R2（failed/dormant 语义保留） |
| 预览无 <980px resize 退出、主题翻转不跟随（≤1.2s 窗口的边缘可见性） | P3 | 记录为已知取舍（resize 中途窗口极小；加监听器扩大驻留面，收益不匹配）；随手修正 waiting 守卫注释（防御性保留） | handoff-lifecycle / experience-qa 取舍清单 |

整改后全套回归：**native 192/192**（190 + R1 + R2）、r3-r 75/75、主 119/119。

## 十二个交付问题的回答

1. **是否找回 M1-R 的快速首显能力？** 机制上找回且优于 M1-R：同一提取器在捕获期
   （比 M1-R 的路由触发更早、且确定而非 25% 竞态）。数值（T1a ≤100ms 目标）待操作员
   实测落表。
2. **预览与原生 React 是否能真正无感接管？** 离线证明成立：handoff 与分栏挂载同一
   同步任务（无中间帧）、身份三重核对、z 序兜底。真视口的 dupFrames/blankLeftFrames/
   articleJumpPx 待实测复核。
3. **是否仍然只有一个真正的原生焦点帖？** 是。适配器核心零修改；markedArticles=1
   贯穿 P3/P9/P14；预览层自身不产生任何"焦点帖"。
4. **视频播放和深滚存活是否保持？** 预览绝不克隆播放器（P11）；深滚存活机制未触碰
   （M2-B1-R 实测 lab 4/4 优于裸 X 的结论待 m2a 列复验）。
5. **评论首读是否改善或至少不退化？** 本轮无触碰评论路径的任何机制；T2 数值门槛
   待同日配对实测；T2net 分段将归因瓶颈（若在 X 网络，如实报告，不重引内部接口）。
6. **关闭返回是否改善？** 关闭路径未触碰（M2-B1-R 语义原样）；预览在关闭场景经
   route-left 即时退出、零残留。T4a/T4b 数值待实测。
7. **是否增加额外网络、CPU 和内存成本？** 网络：零新请求（仅已显示图片 URL 的子
   资源加载）；CPU：每次合格点击一次同步 DOM 提取 + 一个 ≤1.2s 的计时器；内存：一个
   浮层节点 + 一个样式节点，随任一退出路径同拍回收。空闲长任务 0（三套件与 native
   参照一致）。
8. **是否保持零扩展主动私有 API 调用？** 是（构建扫描 + isolation 测试 + Reviewer
   复扫三重验证）。
9. **是否扩大 X 未公开内部结构依赖？** 否。预览层零 fiber/webpack 依赖；唯一新增的
   X DOM 假设是被点 cell 的自有时间戳链接（与 focalCellByStatusId 同一既有规则）。
10. **是否达到 M2-B2-A 产品体验 Gate？** 离线部分达标（Reviewer CONDITIONAL GO）；
    在线 Gate（T1a/T1b/T1c/T2/T4 数值）待操作员实测后按预注册门槛判定。
11. **若未达到，继续有限修复还是放弃预览方案？** 已预注册：重试节奏问题 → 两常量
    回退；预览层若出现无法安全解决的重复/闪烁/错误内容/生命周期问题 → 判预览方案
    NO-GO，回退 M2-B1-R（任务原文约束，不保留不稳定预览层）。其余普通缺陷按有限
    修复处理。
12. **下一包是否可以进入正式 UI 与完整阅读功能开发？** 建议在操作员实测通过在线
    Gate（条件 1）后进入；当前离线底座（预览层 + 协议收敛 + 192 项回归）已为正式
    UI 就绪。

## 最终结论

离线准入完成；**在线准入悬置于操作员真机数据**（唯一的 open item）。按条件 1/2
完成后，本 Gate 可转 GO 或按预注册回退执行。
