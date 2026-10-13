# C1 implementation / acceptance

2026-10-13。用户已授权制作独立实验版和研究右页隐藏原帖。沿用 C 的两个可见页面例外，禁止私有接口、认证读取、React内部补丁、账号代写。

顺序：配对控制器与所有权测试 → MV3独立构建 → 右页一次定位 → 可恢复隐藏article → 浏览器验证 → 独立review。M1-R/Legacy不改动。

- 单个活动pair，公开tabs API能力检测；无split API用两个可见normal windows。失败回滚只关新建且仍处于目标帖的右页。
- storage.session保存pair与恢复bounds；worker串行处理，重复点击幂等。路由漂移解除配对，不同步左右导航、不关闭已另作他用的页。
- 不监听Esc，交给X原生图片/媒体/菜单。关闭配对只操作扩展拥有的右页；左窗只在用户未改尺寸位置时恢复。
- 内容脚本只读找焦点time permalink；右页一次定位到article底部。开始滚动/键盘交互后停止自动定位。10秒等待上限。
- 隐藏默认关闭；独立开关只给确认article加CSS标记，不移节点，不hide cell/composer。路由改变/取消立即恢复，DOM更新有界合并处理。
- 验收分开：离线控制器/DOM测试、真实X的内容脚本注入、真实MV3安装、Chrome155分屏。不能相互替代。
