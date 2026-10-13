# S3 — 媒体与交互

**局部能力已测；整体完整媒体承载失败。** 所有 X 操作来自同一可见 EgoBrowser 页面，没有真实点赞、收藏、关注、回复发送、投票或转发。

| 类型 | 本次真实证据 | 状态 / 边界 |
|---|---|---|
| 短帖 | 113字符、原生动作、两个语义link容器 | PARTIAL，引用卡关系还需具体导航验收 |
| 多图 | 357字符、两图，保留原 DOM 顺序；第一图原生查看器打开/Esc返回，carrier仍 active | PARTIAL，未完成第二图切换/深滚后恢复 |
| 视频 | 同实例暂停/恢复、静音/取消静音、全屏进入、原生按钮退出 | FAIL 完整要求：右栏深滚卸载；拖进度未证实成功 |
| GIF | 固定样本中未发现独立GIF | NOT_TESTED，不从视频类推 |
| Article | 原生结构4662字符、7正文图+封面；左区有独立滚动空间 | PARTIAL，未逐段/链接/末尾/所有图片做完整验收 |
| 投票 | 固定样本中未发现投票 | NOT_TESTED，未投票 |
| 引用 | 短帖出现两个semantic link容器 | PARTIAL，不能以容器数量推断层级正确 |
| 高评论量 | 固定公开样本原生详情及性能探针 | PARTIAL，DOM候选不等于已证明真实回复，持续分页/祖先链未完整验收 |

## 视频的逐项记录

`a-video-controls.json`：pause paused=true 24.367s；resume paused=false；muted=true/false确实切换；fullscreen-enter=true。标为 fullscreen-exit 的 Escape 尝试结果**仍是true**，不能当退出成功。

`a-video-seek-exit.json`：之后明确点击原生“退出全屏”，等待 fullscreenElement 清空，确实 false。拖条前27.274s、后27.486s，没有达到拖动目标的证据；自动化坐标或原生控件命中仍可能有问题，记 NOT_CONFIRMED，而非断言播放器本身必坏。标签切换只短暂切到扩展管理页后返回，未覆盖长时间后台恢复。

`a-video-deep.json`：播放中右滚0→800→1600时currentTime持续增长；实际2732时video disconnected、paused=true、time=0、ready=0。初期nativeVideos=1，未建立第二视频；远处回复出现的其他视频不能算焦点复制播放器。

没有调用未公开播放器接口。未完成“切换另一帖旧视频停止”的完整真实验收；卸载失败后的旧视频确实已暂停不能代替切帖测试。

## 弹层与交互

`photo-overlays.json`：图片dialog在独立overlay祖先分支；Esc关闭查看器，没有误关carrier。原生caret菜单位于article外，但记录为动画初态高度0，不能判菜单定位通过。HoverCard等待2500ms未见，NOT_CONFIRMED。仅检查动作存在并打开只读菜单；不点真实写入项。

离线fixture验证同节点的原生事件监听仍被调用、原parent未变化、移除时不重插、route退出清理、photo子路由不误清理；不替代真实X/真实MV3事件验收。

有界补充发现记录：`bounded-discovery.json`。一次公开GIF+video搜索返回5个article，但未观察到video或可确认GIF；一次poll搜索未返回article且页面显示错误。未为了凑覆盖继续搜索，GIF/投票维持NOT_TESTED。
