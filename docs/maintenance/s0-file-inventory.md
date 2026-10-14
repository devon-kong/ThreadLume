# S0 文件清单与分类（2026-10-14）

清理前 Git 树共 42.2 MiB（跟踪文件）。本轮按 S0-F 分类审计，处置原则：**收敛工作目录，不为数字最小而破坏可复现性与历史证据**。

## 1. 处置汇总

| 分类 | 对象 | 处置 |
|---|---|---|
| GENERATED | `dist-extension-native-lab/`（9 个跟踪文件，128 KB） | **取消跟踪**（`git rm --cached`，磁盘保留）+ `.gitignore`；随时 `npm run build:native:lab` 重建 |
| GENERATED | `dist-extension-native-lab-b1r-baseline/`（9 个跟踪文件，116 KB） | **取消跟踪**（磁盘保留）+ `.gitignore`；可从 `archive/peek-m2b1r-20261014` 逐字节一致地重建（已实证，见归档索引 §6） |
| KEEP | `native-extension/src/`、`extension/`、`tests/native/`、`src/`、`scripts/`、`public/assets/`、`worker/`、`.github/` | 产品与工程本体，未改动 |
| KEEP | `exploration-poc/r3-r/`、`exploration-poc/r3/`（测试代码）、`exploration-poc/r3/r3-poc-units.test.mjs` | CI exploration job 依赖（`npm run test:r3-r`，75 用例） |
| KEEP | `docs/m2-b2-a-l4/` | 当前 L4 验收原始数据（6 份文档 + evidence/ + shots/），S0 明确保留 |
| KEEP | `docs/branding/peek-avatar-v5-transparent.png`、`public/assets/tuzai-icon-source.png`、`public/assets/peek-composer-avatar.png` | 现行品牌/图标源与演示头像（AGENTS.md 2026-09-16/09-17 决策；S0-G 明确安装包图标后续单独设计，本轮不动） |
| ARCHIVED（留在树内） | `docs/m1/`、`docs/m2-a/`、`docs/m2-b0/`、`docs/m2-b1/`、`docs/m2-b2-a/`、`docs/c1/` 等历史阶段文档与截图 | 由稳定/归档标签保存；截图被各阶段文档相对路径引用，删除会破坏证据链，保留 |
| ARCHIVED（留在树内） | `exploration-poc/r4/`（6.1 MiB）、`exploration-poc/evidence/`（4.1 MiB）、`exploration-poc/native-split/`（1.6 MiB）、`exploration-poc/m1/`、`exploration-poc/mv3-poc/` | 历史实验证据（探针、截图、报告）；有历史价值且部分被文档引用，保留 |
| ARCHIVED（留在树内） | `docs/branding/peek-avatar-v1~v4*.png`（约 7 MiB） | AGENTS.md 品牌决策明确"保留早期图片版本作为参考" |
| UNUSED | 未发现可确认无用途且无未保存成果的源文件 | 无删除 |

## 2. 逐项核实记录

- **CI 依赖核查**：`.github/workflows/ci.yml` 三个 job 分别执行 `npm test`（legacy，自建 preview+extension）、`npm run test:r3-r`（exploration）、`npm run test:native`（native，自建 native+lab 后跑 `tests/native/`）。三个 job **均不引用**被取消跟踪的两个 dist 目录。
- **`b1r-baseline` 引用核查**：代码/测试/CI 中仅 `scripts/stamp-artifact.mjs:5` 注释提及；文档引用（`docs/m2-b2-a/performance-comparison.md`、`docs/m2-b2-a/evidence/OPERATOR.md`、`docs/m2-b2-a-l4/environment-and-install.md`）描述的是当时测量所用的本地目录，工作树上该目录仍存在，历史文档相对语境不失效；全新 clone 的复现走归档索引 §6 的重建流程。
- **浏览器加载核查**：ego lite（未运行）Profile 注册的未打包扩展路径为 `dist-extension-native/` 与 `dist-extension-native-lab/`（均在主仓库内、磁盘保留）；取消跟踪只改 Git 索引，不改磁盘，扩展加载不受影响。另有指向 `/Users/devon/.codex/worktrees/peek-native-m2b0-left-carrier/...` 的失效注册（该路径已不存在于磁盘，仅为浏览器残留记录，无仓库风险）。
- **破坏性重建隔离**：验证构建全部在 `/private/tmp` 临时 worktree 中进行，未触碰主仓库 `dist-extension-native-lab/`（浏览器监视目录）的现有内容。
- **docs/qa-layout-reference-normalized.png**：被 `design-qa.md` 引用，KEEP。
- **`exploration-poc/` 大目录**：构成全部为证据截图/探针/测试/报告，无提交进仓库的构建产物，无 UNUSED 删除对象。

## 3. 清理前后体积

| 项 | 清理前 | 清理后 |
|---|---|---|
| 跟踪文件总体积 | 42.2 MiB | ≈41.9 MiB（移出 18 个生成文件，约 244 KB） |
| 被跟踪的生成产物 | 18 文件 / 2 目录 | 0 |
| `docs/` | 21.8 MiB | 21.8 MiB（历史证据整体保留） |
| `exploration-poc/` | 16.1 MiB | 16.1 MiB（CI 依赖 + 历史证据保留） |

> 说明：本轮体积收益有限是**有意为之**——docs/exploration-poc 的主体是历史证据截图，均被文档相对路径引用；S0 的收敛目标是"生成文件不再被无谓跟踪 + 分支/工作区收敛"，不是压榨体积。若未来需要进一步压缩，候选是 `docs/branding/` 早期版本（~7 MiB，受 AGENTS.md 品牌决策保护）与 `exploration-poc/r4`、`evidence` 截图（需先为引用文档改写指向固定标签的链接），列入待办而非本轮执行。

## 4. 未执行/待办（保守保留项）

1. `docs/branding/` 早期版本 PNG（~7 MiB）：受品牌决策保护，本轮仅审计。
2. 历史阶段证据截图压缩或外移：需改写文档链接，风险大于收益，未执行。
3. ego lite 浏览器中指向已删除 codex worktree 的失效扩展注册：浏览器侧残留，无法从仓库侧清理，无风险。
