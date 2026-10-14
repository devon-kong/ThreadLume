# M2-B2-A 体验验收（录屏帧、闪烁、操作与返回）

状态：离线验收 ✅ 完成；真实 MV3 体验清单 ⏳ PENDING-OPERATOR（执行浏览器无法由
Agent 自主加载未打包扩展——操作步骤见 `evidence/OPERATOR.md`）。

## 1. 离线验收（真实构建产物，jsdom 双 world）

### 1.1 交互与生命周期（16 个预览测试，全部通过）

- 普通短帖/图片帖点击 → 预览立即挂载，身份=所点帖（P1/P3）；
- 视频帖 → 海报 + 明确"静态预览"标注，**无任何 video 节点克隆**，X 自己的播放器
  节点数不变（P11）；
- 引用卡时间戳点击 → fail-open 不预览（P8）；
- 详情页任何点击 → 不预览（原生阅读器拥有详情页）（P9）；
- 连续 A→B → 单实例替换、身份跟随、gen 递增（P7）；
- 打开后立即返回 → popstate traverse 清除，无残留（P5）；
- 无导航超时 → 清除且推进 3s 无复活（P6）；
- 适配器失败/休眠/MAIN 缺失 → 预览与分栏一致退出，回退 X 原生单栏，绝不回退
  M1 阅读副本（P10）；
- 交接后虚拟列表分页行为不变（P14）；
- 预览期间 X 原生节点零改动：无标记、无样式写入、无分栏（P15）。

### 1.2 非互动与无障碍（S1-C 5/10 条）

- `pointer-events: none`（样式文本断言）——预览永不拦截输入；
- `aria-hidden="true"` + `role="presentation"` + 零 button/a/input/textarea——
  屏幕阅读器不重复朗读、焦点序不变（P1 构造断言）。

### 1.3 视觉连续性（结构层）

- 预览几何 = 最终左栏几何（fixed、left 0、top=横幅高、宽 52vw）——接管换内容不换布局；
- handoff 与 mountLayout 同步任务（代码顺序 + P3 终态断言）；
- "未钉住详情帖 → 钉住"的横向跳动由 T1c `articleJumpPx` 在实测中量化
  （performance-comparison.md §2，PENDING-OPERATOR）。

## 2. 真实 MV3 体验清单（操作员加载后逐项执行）

| # | 场景 | 判定方式 | 状态 |
|---|---|---|---|
| 1 | 真实 Chrome MV3 加载（chrome://extensions 开发者模式） | OPERATOR.md 步骤 | PENDING |
| 2 | 信息流点击 → 即时预览出现且内容正确 | harness t1a + 目视 | PENDING |
| 3 | 原生详情无感接管（无双原帖/无白屏/无明显跳动） | t1c dupFrames/blankLeftFrames=0 + 目视 | PENDING |
| 4 | 视频在左栏播放（hls.js 路径） | video 指标 + 目视 | PENDING |
| 5 | 右栏深度滚动 5000px | harness 深滚段 | PENDING |
| 6 | 视频深滚后同元素持续播放 | sameElement/playableNow（必须保持 lab 4/4 优势） | PENDING |
| 7 | 评论加载与分页 | t2a/t2b 候选指标 | PENDING |
| 8 | 图片查看器（X 原生 lightbox）在分栏下正常 | 目视 + Esc 关闭 lightbox 不关阅读 | PENDING |
| 9 | 连续切帖 A→B→C | 生命周期 + 目视 | PENDING |
| 10 | 浏览器前进/后退 | harness traverse + 目视 | PENDING |
| 11 | 关闭恢复信息流（T4a/T4b） | harness t4 段 | PENDING |
| 12 | 扩展重载后状态干净 | 重载后开新详情页验证 | PENDING |
| 13 | 适配器失配退出（真实 X 结构变化注入） | 状态属性 failed + 回退单栏 | PENDING |
| 14 | 预览残留清理（各退出路径后 DOM 无 overlay） | harness leftoverPreviewFrames=0 | PENDING |
| 15 | 物理 Esc | **需用户配合**（CDP 按键派发在多窗口会话下不可靠——沿用 M2-B1-R L4 的处理：如无法由 Agent 完成，独立标注，不伪装） | PENDING-USER |

真实账号写入（点赞/关注/收藏/回复/转推）继续由用户亲自执行或明确授权后另行安排，
Agent 不自动执行（任务硬性规则）。

## 3. 已知体验取舍（如实记录）

1. 预览文字为时间线密度 15px/20px；X 详情焦点帖短帖可能渲染更大字号——接管瞬间
   字号有可见变化（内容升级，非布局跳动）。如需消除需依赖 X 内部排版启发式，
   本轮按约束未做（implementation-report.md §5.1）。
2. 预览不显示互动按钮（非互动阅读视图）——原生接管后互动控件在左栏原生动作行出现。
3. 预览不覆盖 X 的加载转场动画（右栏 Spinner 属 X 自身）。
