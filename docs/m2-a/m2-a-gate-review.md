# M2-A 独立 Gate：NO-GO（严格准入）

审查范围：M1-R `dfb94f7` 至 M2-A 修复提交 `091fd63`。Reviewer为独立只读子代理，亲自读取源码/测试/原始JSON/图片并执行最终Native测试；未参与实现。

**代码修复通过，严格验收NO-GO。** 阻断项是B5高评论量样本T2主对照超过硬门槛，因果尚未解释。允许继续隔离诊断，不合并、不发布，不将后续较快的诊断样本用于覆盖主实验失败。

## H1–H9

| Gate | 结论 | 第一手证据或明确来源 |
|---|---|---|
| H1 设计 | PASS | C方案保留原生承载；旧可见百分比/零开销/无跳动等无充分依据结论已撤回 |
| H2 正确性 | PASS | 详情编辑器标记、同列表、紧邻可读帖子、自有数字status时间链接；未知/推荐/广告/跨列表/旧列表过渡均保守退出 |
| H3 生命周期 | PASS | 路由/generation/拆除守卫；独立监听探针确认超时、路由离开、用户输入、媒体返回后wheel/touchmove/pointerdown监听归零 |
| H4 功能 | PASS，限定范围 | 输入优先与迟到Article回归关闭；同cell迟到Article左栏全文更新仍是已知缺口，右栏原生承载保持 |
| H5 隔离 | PASS | 构建隔离检查及源码：无主动私有接口/认证桥接/代写，新增仅DOM、计时器、滚动、诊断 |
| H6 Legacy | PASS | 父代理亲跑119项Legacy、75项实验；Reviewer核对diff未修改Legacy实现 |
| H7 性能 | **FAIL** | 独立复算主24窗口highReply T2中位数+330.4ms（24.7%），超过133.92ms容差；long无有效T2候选 |
| H8 CI | PASS（代码提交） | 父代理核对精确HEAD `091fd635a43ff0974e3863ce2080252ca33b91ac`，run 38333856233三job成功；最终文档/证据HEAD检查由PR checks记录 |
| H9 互动 | PASS，限定范围 | 原生互动可达、定位不代写；真实账号写入与真实MV3 L4仍未验收 |

CI：[代码提交三job成功](https://github.com/devon-kong/peek-exploration/actions/runs/38333856233)。
Draft：[PR #2及最终HEAD checks](https://github.com/devon-kong/peek-exploration/pull/2/checks)。

## 缺陷整改

Reviewer独立复现并确认关闭四类P2：

1. applied之后拆除输入守卫，迟到媒体把已点击/输入的用户拉回顶部。
2. 任意下一cell被当回复，且过滤cell集合会越过非cell推荐标题。
3. 迟到Article未在媒体复查内，原生文章被滚走而左栏也没有全文。
4. URL先变化、旧列表尚未被详情替换时，把下一条普通信息流帖子当回复。

新增回归均先观察失败再修复通过。最终Native **111/111 PASS**，`git diff --check`通过。生产代码无未关闭的已复现P0/P1/P2；这不等于性能准入通过。

构建产物SHA-256：`a1a591d80dac0cdac92a49cda127193df1cea5b7967cbcc56de0e7c8db35d003`，与隔离浏览器证据一致。

## 性能与视觉证据口径

- 原先真实PoC v5启用导致的污染测量已排除；主证据为禁用冲突扩展后的24窗口，每窗口记录单pane与正确Peek品牌。
- highReply主实验M1-R=[1412.6,1339.2,1219.1]ms，M2-A=[1669.6,1400.5,1987.5]ms，中位数1339.2→1669.6ms。
- 同标签页补充6窗口中位数1379.7→1327.0ms，未复现退化；它不能解释或抵消主实验FAIL。进一步被动网络分段记录见性能报告，独立Gate不因挑选后续较快样本而改变。
- 图片A/B经Reviewer亲自查看：同一回复正文0/40px→40/40px可见，左栏内容与图片保留。只证明该高图片帖收益。
- 返回终态偏差0px，但帧序列出现约152–153px短暂变化；不宣称全程无跳动。

## 接续边界

M1-R仍为CONDITIONAL GO（L4未完成）。M2-A保持Draft和严格NO-GO，先解释并关闭T2性能验收缺口，再决定是否进入M2-B正式集成。未发生合并main、扩展发布、Legacy删除或真实账号写入。

## 独立Reviewer补充：被动CDP时钟

Reviewer再次亲自读取新增 `highreply-diagnostic.json` 与采集脚本：6窗口均单Peek pane、哈希匹配、各捕获1个TweetDetail/HTTP 200；网络字段仅操作名、相对时钟和状态，不含URL、headers、body、queryId、requestId。

本轮T2中位数M1-R/M2-A为1138.3/1185.1ms；请求完成→DOM观测中位数21.63/24.83ms。该阶段包括解析、应用处理、布局与rAF采样等待，不是纯渲染耗时。未发现使该诊断失效的明显采集错误，本轮未观察到数百毫秒的请求完成后额外延迟，但不能追溯解释主24窗口的+330.4ms。因此Reviewer维持严格NO-GO。

最终已通过浏览器扩展管理UI恢复PoC原启用状态；环境状态记录在 `evidence/browser-environment.json`。
