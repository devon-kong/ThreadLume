# S1 — A：完整原生焦点帖视觉左置

**NO-GO。** `exploration-poc/m2-b0/probe.mjs` 的 mode=a 是一次最小实现，innerScroll=true 是唯一针对性修复。未加入正式 Native 构建。

- 给当前焦点 article/cell 加可恢复 attribute，仅插入自有 style；不 append/clone/move 原生节点，不访问 React 对象。
- 原生 article fixed 在 0/54px，宽52vw、独立 overflow；右侧原生 cells 宽48vw。article 外的原生 composer 留右边。原生排序/查看引用随 article 在左侧，未为截图拆组件。
- 原始 node、parent、video 引用用于检查身份；参考不会阻止 React 卸载。MutationObserver 发现身份断开或路由离开时撤销全部实验样式，**不会重插旧节点**。
- 初始左栏可承载原生文字、动作、图片和视频；Article DOM 样本4662字符、7正文图和额外封面仍在原始结构内。Article 左 scrollTop=400，window 不随动的浅层行为有记录。
- 主视频深滚到2732px时原帖与播放器断开，video.readyState=0。独立滚动的表面成立不能覆盖生命周期失败。
- 唯一修复把已有 section 改为内层滚动，window 保持0；section 到1600时仍存在，目标2800时同样卸载。不会修改 X 虚拟列表的可见集合。
- 1280和1000重复身份检测也失败。可能包括响应式/水合替换，未反射内部模型来分辨所有触发路径；无论是哪种，都不满足保留同一原生播放器的 Gate。

退出恢复的是自有 CSS/attribute/listener/observer；**不能逆转已发生的 X 组件卸载或恢复视频进度**。这也是不推荐正式化的重要理由。
