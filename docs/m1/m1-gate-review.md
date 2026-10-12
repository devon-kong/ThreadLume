# M1-F 独立 Reviewer 结论与准入判定

日期：2026-10-13。分支 `feat/peek-native-m1`（审查时 HEAD `b4476ff` + 本文档提交）。
Reviewer 由与执行者零共享结论的独立上下文担任：直接阅读全部源码、亲跑三套测试、
双向构建互斥验证、独立复算全部性能/网络数字、对判定器 FAIL 项独立归因评估。
以下为 Reviewer 报告原文（§1），执行者对缺陷的处置（§2），以及任务书要求的十问直答（§3）。

## 1. Reviewer 报告原文

### 一、Gate 逐项判定

**G1 Legacy 原版保持可用 — PASS**
- `git diff b496c54 -- extension/ scripts/build-extension.mjs` = 0 字节。
- `npm test` 亲跑：119 pass / 0 fail（exit 0），构建产物 `dist/client/index.html`、`dist/server/index.js`、`dist/.openai/hosting.json` 齐全。
- 更强的证据：全仓库对基线仅 2 个修改文件（`package.json`、`.github/workflows/ci.yml`，均为纯新增性修改），没有任何测试文件被修改或删除。抽查 `tests/extension-core.test.mjs`（325 处 assert）、`tests/bookmark-folders.test.mjs`（17）、`tests/acceptance-media.test.mjs`（27）断言实质有效。不存在删断言换绿灯。

**G2 Native 不加载私有 GraphQL/认证桥接 — PASS**
- 通读 `native-extension/src/` 全部源文件：纯 DOM 读取/渲染/导航簿记，无任何网络面。
- 源码与产物 grep `fetch/XHR/webpack/queryId/csrf/bearer/cookie/page-bridge/chrome.*` 全部 0 命中；manifest 无 `world:"MAIN"`、无 `permissions`、无 `background`、无 `web_accessible_resources`。
- 亲跑 `npm run build:native` 成功。门禁实测（/tmp 副本，仓库零改动）：注入活体 `fetch("https://x.com/i/api/graphql/PROBE")` → 构建失败 exit 1，报错点名 `/\bfetch\s*\(/`。（注入为未使用导出时会被 tree-shaking 消除而"通过"——门禁扫描的是最终产物，被消除的代码本就不上线，不构成漏洞；复验门禁必须注入活代码。）

**G3 R4 首显性能无回退 — PASS**
- 亲跑 `perf-compare.mjs`，再用 python 从 12 个原始 JSON 独立复算：T1 中位 M1 75.2/75.0/76.0/77.9ms vs R4（`spa-r1-*`，语义同为点击相对值）78/80/84/78ms，Δ = −2.8/−5.0/−8.0/−0.1ms，全部 ≤ max(50ms,10%)。
- `t1Rel = t1 − clickAt`、`t2Rel = t2 − clickAt` 在全部 12 个 M1 文件自洽。12/12 窗口全量入库（r1-r3 × 4 样本），无挑选。`anchorB3.finalDelta` 复算 max 1.828px。

**G4 生命周期、关闭和导航正确 — PASS**
- 亲跑 `npm run test:native`：73 pass / 0 fail，且套件通过 `tests/native/native-env.mjs` 以 `new Function` 执行真实构建产物（非源码）。
- 逐项核对：生成号取消、有界恢复只武装一次、`safeBackTarget` 先查 Navigation API `entries()` 再回退轨迹、绝不无条件后退、Esc 捕获 + 三级守卫链（X 浮层 → 输入中 → 关闭）、B3 单次调整 + 四类用户输入取消 + 2.5s 窗口过期放弃。未发现 P0/P1 缺陷。

**G5 返回信息流体验 — PASS**
- t4.feedAt 中位复算 M1 201/188/198/193ms vs R4 215/178/196/205ms（Δ −12~+10ms，采样量化内）。
- `anchorB3.finalDelta` 12 窗口 ∈ [−0.17, 1.83]px，12/12 ≤ 60px 目标。
- `anchor-restore.js` 无"持续滚动"路径：轮询只读 → 连续 2 次同值 settle → 至多一次 `scrollBy` → finish；用户输入立即取消；过期放弃。测试明确验证 120s 后不再滚动。无与虚拟化器竞争的代码路径。

**G6 内容提取正确 — PASS**
- 审读 + 14 项提取测试对照任务清单：引用卡不误配焦点、计数 0/未知区分（绝不伪造 0）、照片归属（引用图与卡片图均不入主帖）、Article、位置式回退、半水合 src 跳过、unlike 翻转、过期提取放弃。全部对构建产物执行，全绿。

**G7 真实 MV3 核心流程 — PASS-with-L3-evidence（部分 NOT_TESTED，非 BLOCKED）**
- `m1-mv3-acceptance.md` 如实标注：全部在线检查明确写为 L3（CDP 等效注入），逐点说明 L3 与 L4 的差距（manifest 注入时序、chrome://extensions 重载），从未冒充 L4；未验证项全部标 ⏳/HUMAN_WRITE NOT_TESTED，用户步骤清单具体可执行。
- 记 PASS-with-L3 而非 BLOCKED 的理由：环境限制（品牌版 Chrome 禁 `--load-extension`、CFT 不可启动）是已披露事实；L3 机制与 R4 验证轮完全同机制；L4 缺口收窄为两个明确点且已排给用户。

**G8 网络与私有接口 — PASS（判定器字面 FAIL 如实留档，处置可接受）**
- 亲跑判定器复现：V1=0、V3=0；总量裸 X 212 vs M1 206（M1 少 6）；revisit/spa PASS；first-nav 唯一 V2 = `rest:/i/api/1.1/promoted_content/log.json:POST`（M1 [2,1,1,1] vs 原生 [1,1,1,1]——轮次分布亲算一致）。
- 普查无挑选：`ROUNDS=4` × 3 场景 × 2 条件 = 24/24 文件在库，无 skipped；抽查 JSON，requests 数组与 summary 完全一致。
- V2 独立评估：(a) 产物静态零 fetch/XHR + 零权限——扩展不可能构造该请求，决定性证据；(b) 归因方向成立——同操作在 spa 场景被判定器自己的 F2 规则归为 X 原生时序波动，3/4 轮次完全一致；(c) 处置诚实——文档保留"总体按判定器字面 FAIL"，未改工具口径、未把 FAIL 说成 PASS。

**G9 双构建独立可测 — PASS**
- 双向 hash 实测：`build:native` 后 Legacy 产物 md5 不变；`build:extension` 后 Native 产物 md5 不变。
- manifest 可区分（0.8.10 浮层版 vs 0.9.0 Native 版）；目录互斥且构建脚本有显式拒写守卫。

**G10 原版 83 项功能合同 — PASS（无静默降低）**
- 对照 R4/R3-R 矩阵：M1 维持同样 7 项 PARTIAL，行不减、口径不重排。两项新增缺口（无 popup、无翻译）均为显式声明而非静默降级，且比 R3-R 口径更保守。Legacy 承载全部 83 项。T2 差距维持用户决策项未改判。

### 二、Reviewer 发现的缺陷清单

| 级别 | 缺陷 | 位置 | 处置（§2） |
|---|---|---|---|
| P2-1 | "发起者为 abs.twimg.com 的 X 自有脚本"无归档证据（普查 JSON 按脱敏约定不含 initiator 字段） | m1-performance-report.md | ✅ 已修复：独立归因探针复跑并归档为 `exploration-poc/m1/evidence/network/initiator-attribution.json`（两条件各 3 次命中，initiatorType=script、scriptHost=abs.twimg.com）；报告引用该归档 |
| P3-1 | 性能报告 closedAt 中位 3/4 样本与证据不符（誊写偏差，方向对 M1 不利、非美化） | m1-performance-report.md §3 | ✅ 已修复：逐样本中位订正为 143.1/126.8/137.0/126.5ms，并加注与 R4 ~70ms 差异的解释（会话历史更长、traverse 稍慢，无判定依赖） |
| P3-2 | 构建门禁只扫描最终产物（tree-shaking 消除的死代码不可见） | scripts/build-extension-native.mjs | ✅ 已留档：不构成上线风险；Reviewer 实测活代码注入路径有效，复验方法写入本文档 |
| P3-3 | "10 个 ES 模块" vs 实为 11 个源文件（计数口径不一致） | 两份文档 | ✅ 已修复：统一为"11 个 ES 模块源文件" |
| P3-4 | `parseCount` 不识别中文"万"格式计数（自 R4 PoC 原样迁入，非 M1 回退） | focal-extractor.js | 📌 留档：M2 用真实账号核实 X 中文 aria-label 计数格式后处理 |
| P3-5 | Esc 守卫 `[role="dialog"][aria-modal="true"]` 若 X 残留隐藏 dialog 会吞掉 Esc（当前 X 实测无此形态） | main.js | 📌 留档：后续轮次复查（MV3 检查单第 6/7 项可复检） |
| P3-6 | 普查中 `other:chrome-extension:GET` 两条件对称各 1 次未解释 | evidence/network | ✅ 已修复：性能报告归为对称伪影说明项，下轮普查归入 F1 |

无 P0、无 P1。

### 三、Reviewer 综合结论

1. **未发现美化**，且有反向例证：判定器字面 FAIL 保留原样；L3/L4 界限逐项显式标注；T2 出现有利波动时主动拒绝据此宣称改善；T1 的 33ms 离群原始值照实展示；证据与文档同提交、24/24 普查全量在库；复算的全部核心数字与报告一致。
2. 缺陷清单见上（1×P2、6×P3，无 P0/P1）。
3. **最终判定：M1 = CONDITIONAL GO**。十个 Gate 中九个以亲手取得的直接证据 PASS；G7 以如实标注的 L3 证据 PASS，真实扩展手载为用户待办；G8 字面 FAIL 经独立评估不构成扩展引入风险且处置诚实；Legacy 零改动、双构建互斥、性能无回退、B3 新能力达标（12/12 ≤2px）。**条件两项：(1) 用户完成 m1-mv3-acceptance.md §3 的 L4 手载清单后升级为完全 GO；(2) 修复 P2-1 与 P3-1 后方可合入主干**。无任何工程阻塞项。

## 2. 执行者对 Reviewer 条件的处置

| 条件 | 处置 | 状态 |
|---|---|---|
| 修复 P2-1 | 归因探针复跑并归档 `initiator-attribution.json`；报告引用 | ✅ 完成 |
| 修复 P3-1 | closedAt 逐样本中位订正 + 解释注记 | ✅ 完成 |
| （顺带）P3-3/P3-6 | 文档计数统一、对称伪影说明 | ✅ 完成 |
| 用户 L4 手载清单 | `m1-mv3-acceptance.md` §3 步骤 1-3 为 GO 升级项 | ⏳ 待用户 |

## 3. 任务书十问直答

1. **是否成功把 R4 PoC 工程化为可构建的 Native 扩展？** 是。`native-extension/src/`（11 个 ES 模块）→ esbuild 打包 → `dist-extension-native/` 可加载（L3 实测全部核心流程）；`npm run build:native` + `npm run test:native`（73 项，执行真实产物）全绿；无新增运行时依赖。
2. **Native 是否完全隔离旧 page-bridge？** 是。构建期门禁 + 测试期双层静态扫描（fetch/XHR/webpack/queryId/csrf/bearer/cookie/page-bridge/chrome.* 全零命中）；manifest 无 MAIN world、零权限；Reviewer 以活代码注入实测门禁生效（G2 PASS）。
3. **Legacy 是否保持原样并随时可回退？** 是。`git diff b496c54 -- extension/` 为空；119 项原版测试全绿且零断言删改；Legacy 构建/活体冒烟通过；两产物路径互斥（双向 hash 验证），停用 Native、启用 Legacy 即回退。
4. **Native 是否保留了 R4 的原帖首显优势？** 是。T1 中位 75/75/76/78ms vs R4 78/80/84/78ms（Δ −8~0ms，容差 max(50ms,10%) 全 PASS）；信息流复用+水合原地刷新机制完整迁入。
5. **评论首次出现与 R4、原版相比有无变化？** 与 R4 无变化（Δ −10~+15ms；short 样本的更快轮次是 X 侧波动，已如实标注不据此宣称改善）；对原版仍慢 ~0.7–1.3s——既定产品差异，维持用户决策项，未改判。
6. **关闭返回信息流的偏移是否改善？** 显著改善。X 自身重锚瞬态 151–153px（=裸 X 行为），B3 单次有界微调后 12/12 窗口终态 ≤2px（目标 ≤60px）；无持续滚动、用户任何输入即取消。
7. **真实 MV3 测试补齐了哪些缺口？** L3 级补齐：Esc 三语义（含 /photo/1 照片视图 dialog 守卫）、五连开合 5/5、返回锚点与上下文、主题机制、快速切换、重注入清理、Legacy 活体冒烟；重载语义对真实扩展验证。仍待用户（L4）：手载 `dist-extension-native/`、chrome://extensions 重载、物理键盘 Esc、真实主题切换、独立 Profile Legacy、可选真实点赞（HUMAN_WRITE NOT_TESTED 维持）。
8. **哪些原版功能仍未等价？** R4 六项用户决策点全部维持（交互模型/评论首读/排序/视频策略/回复位置/翻译），另两项显式声明的新增缺口（Native 无 popup、无翻译能力——M2 范围）；无静默降级（G10 PASS）。
9. **是否满足 M1 ENGINEERING GO？** 满足 **M1 CONDITIONAL GO**（独立 Reviewer 判定）：工程主体全部 PASS、两项条件中文档修复已完成、唯一剩余条件是用户完成 L4 手载清单（约 5 分钟，见 m1-mv3-acceptance.md §3）。工程 GO ≠ 产品全面替换 GO：T2 等 8 项产品待决项保持开放，不得删除 Legacy。
10. **下一包 M2 应优先解决哪些真实体验缺陷？** 按影响排序：(1) 用户 L4 清单闭环后处理遗留观察（Esc 物理键盘、真实主题切换）；(2) P3-4 中文"万"计数格式（真实账号核实）；(3) 左栏与右栏焦点帖双重复制的体验收敛（R4 L4 已记录的用户可感问题）；(4) Native 设置面（popup/翻译开关）最小化重建；(5) P3-5 Esc 守卫对隐藏 dialog 形态的复检机制。

## 4. 判定

**M1 CONDITIONAL GO**（Reviewer 判定；文档条件已闭环，L4 用户清单为升级完全 GO 的唯一剩余条件）。
