# S0 仓库收敛报告（2026-10-14）

范围：只执行仓库整理（冻结、归档、PR 收敛、worktree 与生成产物清理、设计决策记录、全量回归）。**无任何新 UI、业务功能或架构开发；无运行时代码改动。**

## 1. Git 状态

### 1.1 远端分支（6 → 3，目标达成）

| 清理前（SHA） | 清理后 |
|---|---|
| `main` @ `b496c54` | **保留** |
| `fix/peek-native-m1-r` @ `f4d7b6c` | **保留** |
| `feat/peek-native-m2b1-layout-adapter` @ `5d43830` | 已删除（归档标签 `archive/peek-m2b1-20261014`） |
| `fix/peek-native-m2b1-r` @ `9dd18a8` | 已删除（归档标签 `archive/peek-m2b1r-20261014`） |
| `feat/peek-native-m2b2a-fast-reading` @ `92e0207` | 已删除（归档标签 `archive/peek-m2b2a-20261014`） |
| `fix/peek-native-m2b2a-l4` @ `97c70ea` | **保留（产品化基线）**，S0 维护提交 fast-forward |

- 删除前逐条门槛：SHA 复核未变（`git ls-remote`）✓；`git merge-base --is-ancestor` 确认为 L4 祖先 ✓；对应 PR 已关闭 ✓；worktree 已移除 ✓；归档标签已推送并 `^{}` 验证 ✓。逐条删除，无通配符。
- 本地分支同步收敛为同名 3 条（`git branch -d` 安全删除，Git 确认均已并入 HEAD）。
- 未发生 force-push、历史重写、main 合并。

### 1.2 标签

- 新增稳定标签：`stable/peek-native-m2b2a-l4-20261014` → `97c70ea94aae042b150f89afafd3294e2bcd3ca9`（标签对象 `404c1b3`，远端 `^{}` 验证一致）。
- 新增归档标签 ×3 与既有归档标签 ×3（M2-A / M2-B0 / C1，未触碰）的完整清单与恢复方法见 `s0-archive-index.md`。

### 1.3 PR

- **PR #8（产品化候选）**：base 由 `feat/peek-native-m2b2a-fast-reading` 调整为 `fix/peek-native-m1-r`（先调 base、后删分支，顺序符合要求）。调整后仍为 OPEN Draft，MERGEABLE/CLEAN，包含 M1-R 之后全部 17 个提交（156 文件，+30421/−37），无提交丢失、无冲突；描述已补充"S0 收敛说明"，明确这是累计产品化候选而非 L4 最后两个提交的补丁。
- **PR #5/#6/#7**：已带归档说明评论关闭（说明阶段被 L4 完整继承、归档标签、未来基线为 `fix/peek-native-m2b2a-l4`、讨论保留、未合并 main）。
- **PR #1（M1-R）**：保留为 OPEN Draft，未改动。
- CI：PR #8 在 base 调整后重跑（run `38548104206`，2026-10-14T12:01:52Z），Legacy / Exploration / Native 三 job 全部 pass。

### 1.4 Worktree（前后状态）

| 清理前 | 清理后 |
|---|---|
| `/Users/devon/claude/peek-main`（L4 分支，干净） | **保留**（主仓库 = L4 开发工作区） |
| `/private/tmp/peek-b1r-baseline`（detached @ `9dd18a8`） | 已 `git worktree remove` 正常移除（移除前核实：工作区干净、无未推送提交、HEAD 已由 `archive/peek-m2b1r-20261014` 保存、无 Agent/浏览器占用） |
| —（B2 验证用临时 worktree） | 已按流程建立→验证→还原生成文件→正常移除 |
| —（F1 基线重建临时 worktree） | 同上 |

- `git worktree prune -n` 结果为空，无过期元数据。stash 全程为空。
- 全程未使用 `git reset --hard`、`git clean -fd`、`git worktree remove --force`、`git stash drop`、`rm -rf` 于任何不明目录；一处 worktree 因被跟踪生成文件差异未能直接移除时，采用"还原生成文件→正常移除"而非 `--force`。
- 独立 clone（`~/.codex/worktrees/...` 旧路径）未做任何操作；经查该路径已不存在于磁盘，仅剩 ego lite 浏览器内一条失效扩展注册，无仓库风险。

### 1.5 未完成清理项及原因

1. `docs/branding/` 早期版本 PNG（~7 MiB）：受 AGENTS.md 品牌决策保护（"保留早期图片版本作为参考"），本轮仅审计，见 `s0-file-inventory.md` §4。
2. 历史证据截图（docs/m1、m2-a、m2-b1、m2-b2-a、exploration-poc）：均为 ARCHIVED 保留项，被历史文档相对路径引用，删除风险大于收益。
3. ego lite 浏览器失效扩展注册：浏览器侧数据，非仓库对象。

## 2. 文件处置

见 `s0-file-inventory.md`（完整分类 KEEP/ARCHIVED/GENERATED/UNUSED、引用核查、体积前后对比）。要点：

- 取消跟踪 18 个被跟踪的生成文件（`dist-extension-native-lab/`、`dist-extension-native-lab-b1r-baseline/` 各 9 个），磁盘文件保留，`.gitignore` 已补 `dist-extension-native-lab-b1r-baseline/`。
- B1-R 基线可恢复性已实证：从 `archive/peek-m2b1r-20261014` 在临时 worktree 执行 `npm ci && npm run build:native:lab`，重建产物与被跟踪副本 **逐字节一致**（content.js / content.css / layout-adapter-main.js / manifest.json / icons / vendor/brand/icon.js 全部 IDENTICAL）。
- CI 三个 job 均不引用被取消跟踪的目录（`test:native` 从源码自建 lab）。
- 浏览器实际加载路径（ego lite Profile 注册）为主仓库 `dist-extension-native/` 与 `dist-extension-native-lab/`，磁盘保留，加载不受影响；本轮所有构建在 `/private/tmp` 隔离 worktree 进行，未触碰浏览器监视目录内容。
- 未删除任何源码、测试、文档或品牌资产；未发现 UNUSED 对象。

## 3. 工程验证

### 3.1 B2 稳定标签恢复验证（清理前，临时 worktree）

从 `stable/peek-native-m2b2a-l4-20261014` 检出 → `npm ci` → Legacy / Native / Lab 三构建成功 → `test:native` 213 通过、`test:r3-r` 75 通过、`npm test` 119 通过、`test:sites` 4 通过；Sites 交付物 `dist/client/index.html`、`dist/server/index.js`、`dist/.openai/hosting.json` 齐备。

### 3.2 S0-H 清理后全量回归（隔离 worktree，含本轮全部维护性变更）

| 项 | 结果 |
|---|---|
| `npm ci` | 成功 |
| `npm run build:extension`（Legacy） | 成功 |
| `npm run build:native`（Native 默认） | 成功（manifest 名 `Peek Native (M1)`） |
| `npm run build:native:lab`（Native Lab） | 成功，含 `layout-adapter-main.js` 与即时预览标记（`data-peek-artifact`、preview 处理器） |
| `test:native`（213 用例，执行构建产物） | **213/213 通过** |
| `test:r3-r` | **75/75 通过** |
| `npm test`（Legacy 全量） | **119/119 通过** |
| `test:sites` | **4/4 通过** |

- MAIN/ISOLATED 通信机制、GraphQL/DOM 提取、路由与媒体实现、虚拟列表适配器、即时预览逻辑、扩展默认模式：**零代码改动**（本提交 diff 仅含 `.gitignore`、`AGENTS.md`、`docs/maintenance/` 与生成文件取消跟踪，见 §4）。
- 未重新引入私有 GraphQL/REST 请求：无任何 `native-extension/`、`extension/`、`scripts/` 改动；Native 测试套件（含网络协议测试）全绿。
- 本地加载中的扩展未损坏：浏览器注册的目录磁盘内容未变。
- GitHub CI：PR #8 base 调整后重跑三 job pass（run `38548104206`）；本 S0 提交推送后由 PR #8 自动触发新一轮 CI，结果在 PR checks 记录。

### 3.3 SHA 追溯

- 原始验收 SHA：`97c70ea94aae042b150f89afafd3294e2bcd3ca9`（由稳定标签永久保存，不移动）。
- S0 完成后新 HEAD：本维护提交（父提交即 `97c70ea`，普通提交 fast-forward，无重写）。

## 4. 提交内容声明

本轮维护提交仅包含：`.gitignore`（+1 行）、`AGENTS.md`（新增 2026-10-14 Native UI 设计要求）、`docs/maintenance/`（本报告等 3 份）、18 个生成文件从索引移除（磁盘保留）。**不含任何运行时代码变更。**

## 5. 后续开发

1. **产品化基线**：`fix/peek-native-m2b2a-l4`（远端唯一开发分支），稳定恢复点为标签 `stable/peek-native-m2b2a-l4-20261014`。
2. **M2-B2-B 起始 SHA**：从 S0 维护提交之后的 `fix/peek-native-m2b2a-l4` HEAD 创建（该 HEAD 的父链包含 `97c70ea` 原始验收提交）；若希望严格从验收态起步，也可用 `97c70ea`，区别仅为本轮非功能性维护提交。
3. **不再参与开发的历史实验**：M2-A（评论优先）、M2-B0（CSS 载体）、C1（双原生页）、`exploration-poc/r4`、`native-split`、`m1`、`mv3-poc` 目录内容——均已归档，仅作证据查询；`fix/peek-native-m1-r` 仅作为回退基线保留，不再前向开发。
4. **剩余冗余**：无源码级冗余；可选待办见 `s0-file-inventory.md` §4（历史品牌 PNG、历史截图外移，均需权衡文档链接修复）。
5. **新 UI 设计约束**：已写入 `AGENTS.md`（2026-10-14 Native 新 UI 设计要求，10 条，含与旧兔子图标约束的优先级声明）。

## 6. 安全红线执行情况

未删除 `native-extension/src/`、`extension/`、`tests/native/`；未修改虚拟列表适配器/即时预览/GraphQL/DOM/路由/媒体实现；未改变扩展默认模式；未合并 main；未发布扩展；未重写历史、未 force-push；未在浏览器加载目录上执行破坏性重建。**本轮所有变更均为非功能性仓库维护。**
