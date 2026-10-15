# C1-R Article 返回：根因与安全降级

## S0 问题清单与构建边界

基线 C1 分支及远端 HEAD 均为 `dd0773084cb7a7543d51cf45dbcaec2b6b50557c`，工作树原先干净；本轮在 `fix/peek-native-m2b2c1-r` 上执行。B2-B 基线为 `57b216fe8f1c86cc4dad01235d4a46f31914d113`。上一轮真实浏览器受测 C1 候选内容 hash 是 `cec9a4db35`，最终 C1 引用归属补丁后的本轮源码构建内容 hash 是 `de549bd02f`；两者不是同一受测产物。B2-B 内容 hash 是 `3abb7ea0aa`。

已确定：公开 Article 在深位置退出专注模式时，X 原生虚拟列表可能不渲染焦点 cell；B2-B/C1-R 的有界安装因此返回 `focal-cell-not-found`。旧性能脚本只有 1/8 有效 T2b 配对，原因不能由旧 JSON 逐轮还原；脚本会在约 0.4 秒看到编辑器后立即深滚，并只检查首个非焦点 `article`，其设计会漏掉后来加载且可读的回复，多级线程还可能把焦点前祖先当候选。样本不足：引用卡内投票/Article/视频、独立 GIF、评论终止态等，均没有新的真实组合样本，不作为推测修复依据。

## Article 根因定位

同一公开 Article `/wlzh/status/2109433207318081885`：

| 对照 | 深位置退出专注模式后的事实 |
|---|---|
| 无 Peek 的 X | 返回 status 后 `scrollY≈17059`，37 个其他 cell 可见，Article 正文节点为 0；滚回页首后 4749 字正文重新出现。见 `evidence/article-no-peek-deep.json`。 |
| B2-B `3abb7ea0aa` | 返回时焦点正文为 0；MAIN 对 50 次 INSTALL 均答 `UNSUPPORTED:focal-cell-not-found`，约 3.2 秒后控制器 failed。布局、皮肤均已移除。 |
| C1-R `de549bd02f` | 同为 50 次有界 INSTALL/UNSUPPORTED，`failed:focal-cell-not-found` 后无布局/皮肤残留；滚回页首，X 原生 4749 字再次可读。 |

时序见 `evidence/article-b2b-deep-return.json`、`article-c1r-deep-return.json`。C1-R 在返回 status 后一度位于 `scrollY≈53`，随后 X 恢复到 `≈17049`；焦点 cell 在整个有界安装窗口都缺席。退出专注模式前 Peek 已按路由卸载，记录为一对 `UNINSTALL/UNINSTALLED`；缺 cell 的 INSTALL 在 `adapter-core.js` 包装虚拟列表方法之前即返回 UNSUPPORTED。没有证据表明存在过期虚拟列表实例或旧包装残留。普通位置的无扩展返回能立即恢复正文；图片查看器 Esc 返回 C1-R 的 active 布局与 4749 字正文。

在同内容 hash 的更新 build ID `m2a-202610151038-de549bd02f` 上又做一次 C1-R 深返与人工恢复：failed 时正文 0、浮层/布局/顶栏/预览全无，累计 50 次 INSTALL；用户一次滚回页首后正文 4749 字、原生单栏可读，3.5 秒后 INSTALL 仍为 50 次。原始记录为 `evidence/article-c1r-recovery.json`。普通位置退出专注模式则恢复 active、唯一焦点和全文，见 `article-normal-return.json`。

先前一次无扩展对照未达到预定深度：当时 X 页面总高仅 9016px，`scrollTo(16899)` 被浏览器夹到 8180px，因此 Article 始终存在；这次无效深度尝试保存在 `evidence/article-no-peek-control.json`，没有当作深返成功或失败样本。

**根因：X 自身的深位置滚动恢复与虚拟列表渲染状态不匹配，导致目标 cell 缺席；Peek 的安装在该窗口内无法成立。** 这是 X 原生缺焦点与 Peek 有界安装的组合；不是把一次暂时缺失误判为永久内容丢失，也不是 C1 引用归属补丁引入。A（X 缺 cell）与 C（路由/滚动恢复时序）有直接证据；B（Peek 过早放弃）未获证实，D（过期实例）与 E（在专注模式本身安装）不符合观测。

## 本轮处理与验收边界

采用用户定义的**路径 B：安全原生降级**。没有修改 `adapter-core.js`、MAIN/ISOLATED 通信、React 内部适配范围或安装预算；没有无条件回页首、持续滚动校正或新建私有请求。新增一项真实构建离线回归：active → X Article 专注模式路由 → 深位置无焦点返回 → 50 次有界尝试 → failed；检查包装恢复、布局/皮肤/顶栏/预览清理，并确认后续路由轮询不循环 INSTALL。

失效边界仍在：深位置返回后，X 原生正文可能需用户滚回页首才重新渲染，双栏不会在同一路由自动重建。浏览器无需重启，X 原生阅读可继续；完整产品体验标记 **PARTIAL**。由于无扩展的 X 也会落在同一深位置且缺正文，本轮不以修改 X 虚拟列表或抢夺滚动作为所谓修复。
