# S4 — 独立滚动与虚拟化

**FAIL：可以产生两个可滚动表面，无法保证左侧原生组件持续存活。**

| 路线/视口 | 深滚观测 | 结论 |
|---|---|---|
| A 1440×900，window右滚 | 0/800/1600保留；目标2800时实际2732，article/cell/video断开 | FAIL |
| A修复 1440×900，section右滚 | window=0；section=0/800/1600保留；目标2800卸载、撤销后section归0 | FAIL |
| A 1280×800 | 0保留；800时同一article断开 | FAIL |
| A 1000×800 | 0保留；目标800后实际864，同一article断开 | FAIL |
| B 1440×900 | 0/800/1600同一video；2800卸载 | FAIL |

真实数据：`a-video-deep.json`、`a-layout-matrix.json`、`b-media-deep.json`。窗口滚动位置可能因X的cell重测和撤销样式发生改变，因此同时保留target与实际值；不把2800精确说成卸载阈值。采样间隔700ms只用于有界生命周期观测，不用于T1/T2性能。

`content-matrix.json`记录浅层左滚及scrollHeight/clientHeight；只证明浅层几何独立，不证明分页与生命周期。A初期原帖仅一份，右侧composer/后续cell；后续内容仍可能包含广告/推荐，不能把所有cell称为评论。焦点缩小带来的列表测量变化可见，不伪造占位高度。

## 10项验收边界

1–3 左长帖独立滚动、右独立滚动、互不带动：浅层 PARTIAL；长时整体失败。
4 视频不因右深滚卸载：FAIL，直接证据。
5–7 分页、可见集合持续正确、上下文/祖先链：PARTIAL/NOT_TESTED；核心阻断后不继续刷深分页。
8 Esc/关闭/前进后退：图片Esc真实通过；实验显式撤销与route离开离线通过；完整浏览器历史/MV3未验。
9 菜单/全屏：局部见media-verification，不整体PASS。
10 撤销：matrix所有cleanup styles=0、markers=0，active=false；探针断开观察器并移除监听，无定时器。测试观察状态对象保留节点引用直到reload，仅为检测，不能声称内存绝对零残留。

本轮没有永久保留条目、扩大virtualizer可见窗口、冻结React渲染或制造第二播放器。对公开CSS的探索限额已耗尽，停止路线。
