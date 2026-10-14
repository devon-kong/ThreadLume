# M2-B2-A 实测操作员手册（扩展模式加载）

执行环境限制：Agent 无法向浏览器自主加载未打包扩展（CDP Extensions 域不可用，
`chrome://extensions` 的 loadUnpacked 需要原生文件对话框）。以下每模式一次人工加载，
其余全部由 harness 自动完成（同一脚本、同一账号、同一样本、同一视口）。

## 四个待测产物（已构建、互相隔离、目录即身份）

| 模式 | 目录（加载这个） | 说明 |
|---|---|---|
| `m2a` | `dist-extension-native-lab/` | M2-B2-A 候选（预览 + 60ms 重试 + 严格 gen） |
| `b1r` | `dist-extension-native-lab-b1r-baseline/` | M2-B1-R 验收基线（9dd18a8 原产物，无预览代码） |
| `m1r` | `dist-extension-native/` | M1-R 稳定版（默认构建，适配器编译在外） |
| `native` | （无扩展） | 裸 X 参照；无需加载，Agent 已自主完成 |

## 操作步骤（每模式 ~4 分钟）

1. `chrome://extensions` → 开启右上角「开发者模式」。
2. 若已加载过其他 Peek 构建先移除（避免旧 Peek 与新实验同时注入——任务硬性规则）。
3. 「加载已解压的扩展程序」→ 选择上表对应目录。
4. 告知 Agent 模式已就绪；其余（点击→采样→记录→落盘
   `docs/m2-b2-a/evidence/perf-results-<mode>.json`）自动执行。
5. 完成后该模式结果立即写入 evidence；切换下一模式回到第 2 步。

## harness 已内置的防呆

- 产物身份守卫：m2a 必须存在 `preview` 测试钩子；b1r/m1r 必须没有——加载错产物
  的轮次自动作废并在结果中记录 `skipped: "loaded artifact does not match MODE"`；
- 分栏完整性：每轮校验 `article[data-peek-lad-focal]` 数量 = 1、状态属性、预览残留；
- 视频深滚 5000px 后同元素 + 持续播放校验；
- 零账号写入：全部为被动 DOM/rAF 读取 + 真实指针点击时间戳链接；评论口径保持
  "原生评论候选"（同 M2-B1-R）。
