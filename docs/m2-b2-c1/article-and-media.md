# M2-B2-C1：原帖、Article 与媒体

测试环境是已登录的真实 Chromium/MV3，使用公开状态链接，只做阅读、播放、滚动、导航和查看器操作。C1 实机受测产物标记为 `m2a-202610150341-cec9a4db35`；后续引用归属修正只经生产构建离线测试，尚无新版实机样本。`RO` 只说明本次样本行为；没有样本的能力仍列 NOT_TESTED。图片和视频由 X 原生 React 管理，Peek 不复制媒体节点。

## 普通帖子与引用归属

- 2 轮 × 4 种帖子在 B2-B/C1 配对中均进入目标详情并得到唯一焦点；本轮 C1 的真实引用帖 `/wangray/status/2109869791431508001` 在左卡有唯一焦点，焦点自己的时间链接与 URL 一致。引用文字和媒体留在嵌套卡：主帖图片 2、引用图片 1；点击引用正文后路由进入 `/wangray/status/2109860553657328047`，随后焦点身份再次与 URL 匹配。
- 普通长帖、Emoji、链接和互动动作栏由 X 原生节点呈现；预览只复制已渲染的可见字段。Premium 极长帖的实际“显示更多”以及空格、全部链接类型未得到 C1 活样本，属于 **NOT_TESTED**，不能用 362 字普通帖代替。
- 焦点标记只给具备自身时间链接的帖子。引用卡内的时间链接不构成外层焦点证据；`tests/native/native-extraction.test.mjs` 用实际生产构建覆盖这条身份规则。
- 独立审查用引用卡内投票反例确认了主帖预览归属错误；最终源码对已识别的单层语义引用排除投票、视频、网站卡、Article 正文和普通正文候选。含网站卡的引用反例也纳入生产构建测试并通过；真实引用投票/引用 Article 以及多层引用仍为 **NOT_TESTED**。

## 真实 X Article

公开样本：`/wlzh/status/2109433207318081885`。C1 原生水合完成后，`twitterArticleRichTextView.innerText.length=4749`，`article[data-peek-lad-focal]` 恰有 1 个且包含该富文本节点。正文实际 DOM 含 9 个 `H2`、4 个有序列表、19 个列表项、1 个无序列表、21 个链接、7 张正文图片、3 个引用块；标题、作者及封面可见。左卡的 `scrollTop` 达到 `8045/8045`，正文最后一个元素进入视口，长度仍为 4749；没有观察到正文无故截断。证据：`evidence/article-c1-bottom.png`、`evidence/article-c1.png`（后者是安装阶段的早期帧，不能拿来证明最终布局）、`article-active-baseline.png`。

正文图片点击进入 X 原生 `/article/.../media/...` 查看器，Esc 返回原状态页，阅读器仍为 `active`。切换“原生视图”后可进入 X 的“专注模式”；专注模式退出会返回相同 status URL。一次带有先前深滚/图片导航历史的返回落在 `window.scrollY=16899`，X 的虚拟列表暂未渲染焦点，Peek 按既有保护退出为 `failed:focal-cell-not-found`；向上滚回顶端后 X 原生全文 4749 字再次可读。此路径为 **PARTIAL**：内容和原生返回 URL 没丢失，但返回位置与双栏重建不稳定。本轮未据此改动 `adapter-core.js`、通信或虚拟列表，也未添加持续滚动校正。

该样本没有 `strong`/`em` 或文章内视频元素，故这些格式与嵌入媒体单项为 **NOT_TESTED**。Article 保留的是 X 的富文本 React 树；把 `innerText` 再绘制到 Peek 不满足本 Gate。

## 图片、视频、GIF、投票、网站卡

| 类别 | 本轮观察 | 判定 |
|---|---|---|
| 多图与长图 | `/KinGao476942/status/2099877465795735861` 左卡有 3 张图，原始尺寸分别为 1054×2048、1082×2048、1070×2048；渲染矩形约 366×713、376×713、372×713，比例相符。X 灯箱打开后顶栏最终 `display:none`，原生关闭按钮在视口内；Esc 关闭后路由和 `active` 恢复。见 `evidence/photos-lightbox-c1.png`。 | **FULL**（该三图/长图样本）；图片加载失败样本 **NOT_TESTED** |
| 视频 | B2-B 装载构建的实机视频在右栏 `scrollY≈5794` 后同一 video 元素仍连接、`readyState=4`、播放时间推进（23.30→24.05s）；C1 最终配对 2/2 视频样本 `sameElement=true`。X 原生播放器负责播放/暂停/进度/全屏。普通视频路径有证；评论视频与原帖视频共存、重复打开、加载异常未得到 C1 真样本。 | **PARTIAL** |
| GIF | 历史资料把 GIF 归到原生 video 路径；本轮没有独立 GIF 帖，不用普通视频替代。 | **NOT_TESTED** |
| 投票 | `/kokosn_5656/status/2109948231660818805` 有 X 原生 `role="radiogroup"` 和 3 个 `role="radio"` 选项，剩余时间/票数可见。当前 X 不给旧 `poll`/`vote` testid，故 C1 将即时预览的投票提示识别改为实际 DOM 结构；生产构建测试红→绿。未点击任何选项；结果态无样本。 | 展示 **PARTIAL**；投票写入 **DEFERRED** |
| 网站卡 | `card.wrapper` 与媒体排除规则有生产模块测试；M2-B1 历史实机见过标题/来源卡。C1 没有新的稳定卡片样本。 | **NOT_TESTED**（C1 活体验） |

本轮没有为上述媒体加入播放器、请求客户端或 React 节点迁移。页面上偶发图片/Article 水合未完成时，早期快照和稳定快照必须分别解释；`evidence/live-media-initial-baseline.json` 保留了这种早期状态，其中部分 `focal-cell-not-found` 记录不代表最终内容缺失。
