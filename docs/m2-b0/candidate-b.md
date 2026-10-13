# S2 — B：M1-R 副本 + 同实例原生媒体

**NO-GO。** 仅一轮，不再修复。真实页面注入精确 M1-R 构建到 isolated world，然后 mode=b 将原生 videoPlayer wrapper fixed 到左栏，同时让原生 article 其他部分不可见。没有复制播放器，视频仍为原 parent 的同一实例。

B 与 A 的实际差异：文本/图片继续由 M1-R 的 DOM 字符串提取阅读副本承载，只有复杂媒体试图视觉定位；A 则完整 article 原生承载。B 顶部360px的固定媒体位置仅为生命周期探针，存在文本遮挡/媒体比例/键盘可达性缺口，绝不是产品排版。

`evidence/b-media-deep.json`：0/800/1600px 同一 video 仍连接；2800px 时 article 与 video 均 disconnected，sameVideo=false，自动撤销。B 与 A 共享焦点 cell 的生命周期，并未隔离虚拟化风险。切换文本副本不改变播放器所属 React 子树的回收。

图片可以安全按 DOM 字符串在副本中展示，但原生大图查看器需要原生入口；Article 副本无法据此声称等价富文本/媒体/交互；GIF 视频式实例、投票有状态控件仍受原生 cell 寿命约束。不能用静态封面或隐藏的第二播放器冒充解决。没有继续扩展这些替代承载，因为核心媒体已经失败。
