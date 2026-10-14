# S0 归档索引（2026-10-14）

S0 仓库收敛后的全部恢复锚点。任何被归档/删除的对象都可经本索引定位并恢复。

## 1. 稳定标签（产品化基线冻结点）

| 标签 | 指向提交 | 含义 |
|---|---|---|
| `stable/peek-native-m2b2a-l4-20261014` | `97c70ea94aae042b150f89afafd3294e2bcd3ca9` | M2-B2-A-L4 真实 MV3 验收完成（Reviewer GO）；即时预览中位约 34ms、原生双栏、视频深滚挂载均已验证；进入 UI 产品化（M2-B2-B）前的稳定恢复点 |

- 标签对象 SHA（远端已验证）：`404c1b373abc1041775f92cd5068ba5a8ff6ac56`；`^{}` 解析为 `97c70ea`（已用 `git ls-remote` 核对）。
- 恢复方法：`git worktree add --detach <dir> stable/peek-native-m2b2a-l4-20261014 && npm ci`，构建与测试步骤见 `s0-cleanup-report.md` §5（B2 已实证可完整恢复）。

## 2. 归档标签（已删除的中间分支检查点）

| 标签 | 指向提交 | 归档对象 | 后续继承 |
|---|---|---|---|
| `archive/peek-m2b1-20261014` | `5d438301b93a2f30b15f3348149a740a1276d6d7` | `feat/peek-native-m2b1-layout-adapter`（M2-B1 布局适配器） | 全部提交包含于稳定标签 |
| `archive/peek-m2b1r-20261014` | `9dd18a85f396dd1c7b80e260e5cd56729a1d8365` | `fix/peek-native-m2b1-r`（M2-B1-R 修复与复测） | 全部提交包含于稳定标签 |
| `archive/peek-m2b2a-20261014` | `92e0207aedf2aa728a2d55d5a502f96a5bb75a01` | `feat/peek-native-m2b2a-fast-reading`（M2-B2-A 即时预览） | 全部提交包含于稳定标签 |

## 3. 既有归档标签（S0 之前已存在，未改动）

| 标签 | 指向提交 | 阶段 |
|---|---|---|
| `archive/peek-m2a-nogo-20261013` | `1e6cc72c3cf39925276c9fe055c7b40b640bddfd` | M2-A 评论优先布局（性能准入 NO-GO，PR #2 已关闭） |
| `archive/peek-m2b0-nogo-20261013` | `27ad2b144928aa346e7c0f57ba5683e68fb6ca68` | M2-B0 CSS 载体实验（NO-GO，PR #3 已关闭） |
| `archive/peek-c1-rejected-20261013` | `d1d433fcdc48a0c1d950d4f16df26be830f2f00c` | C1 双原生页实验（否决，PR #4 已关闭） |

## 4. 分支终态（远端 6 → 3）

| 分支 | HEAD | 用途 |
|---|---|---|
| `main` | `b496c54bcf6b4431001c4a24e437e4c0a557d49f` | R4/Legacy 主线（S0 未改动，未合并任何 Native 提交） |
| `fix/peek-native-m1-r` | `f4d7b6c1a82a2de7fc7508e21b9a6d2b8818f84e` | M1-R 回退基线（长期保留，PR #1 继续 Draft） |
| `fix/peek-native-m2b2a-l4` | `97c70ea` → S0 后含维护提交 | **产品化基线**，累计候选 PR #8 |

已删除（远端+本地，`git branch -d` 安全删除）：`feat/peek-native-m2b1-layout-adapter`、`fix/peek-native-m2b1-r`、`feat/peek-native-m2b2a-fast-reading`。三者删除前均验证为 `fix/peek-native-m2b2a-l4` 的祖先（`git merge-base --is-ancestor`），且远端 SHA 与删除时逐条复核一致。

## 5. PR 终态

| PR | 状态 | head → base | 说明 |
|---|---|---|---|
| #1 M1-R | OPEN（Draft） | `fix/peek-native-m1-r` → `main` | 保留，回退基线路线 |
| #2 M2-A | CLOSED（此前已关） | — | NO-GO，标签已归档 |
| #3 M2-B0 | CLOSED（此前已关） | — | NO-GO，标签已归档 |
| #4 C1 | CLOSED（此前已关） | — | 否决，标签已归档 |
| #5 M2-B1 | CLOSED（S0 关闭） | `feat/peek-native-m2b1-layout-adapter` → `main` | 附归档说明评论；未合并 |
| #6 M2-B1-R | CLOSED（S0 关闭） | `fix/peek-native-m2b1-r` → `feat/peek-native-m2b1-layout-adapter` | 附归档说明评论；未合并 |
| #7 M2-B2-A | CLOSED（S0 关闭） | `feat/peek-native-m2b2a-fast-reading` → `main` | 附归档说明评论；未合并 |
| #8 M2-B2-A-L4 | OPEN（Draft） | `fix/peek-native-m2b2a-l4` → **`fix/peek-native-m1-r`**（S0 由 `feat/peek-native-m2b2a-fast-reading` 调整） | **累计产品化候选**：包含 M1-R 之后 17 个提交（M2-B1 → M2-B1-R → M2-B2-A → L4），MERGEABLE/CLEAN，CI 三 job PASS |

## 6. 生成产物恢复方法

- **`dist-extension-native-lab/`（浏览器监视目录）**：随时由 `npm run build:native:lab` 从当前源码重建。
- **`dist-extension-native-lab-b1r-baseline/`（B1-R 基线产物）**：已实证可从精确提交重建——
  ```bash
  git worktree add --detach /tmp/peek-b1r-rebuild archive/peek-m2b1r-20261014
  cd /tmp/peek-b1r-rebuild && npm ci && npm run build:native:lab
  # dist-extension-native-lab/ 即 B1-R 基线内容
  ```
  2026-10-14 实测：重建产物与 S0 前被跟踪副本逐字节一致（content.js / content.css / layout-adapter-main.js / manifest.json / icons / vendor/brand/icon.js 全部 IDENTICAL）。
