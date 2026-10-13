# M1-R CI 记录

## Draft PR

- PR #1（Draft，未合并）：https://github.com/devon-kong/peek-exploration/pull/1
- 分支：`fix/peek-native-m1-r` ← `76568a3`（M1 验收基线）

## CI 运行

| 运行 | 结果 | 备注 |
|---|---|---|
| [38328673151](https://github.com/devon-kong/peek-exploration/actions/runs/38328673151) | ❌ | M1 分支首次 CI：Node 20 + jsdom 30 不兼容（`webidl.util.markAsUncloneable`，jsdom 结构化克隆 API 需 Node 22 的 undici）。环境漂移，非代码回归（Legacy 无 jsdom，照常通过） |
| [38328803076](https://github.com/devon-kong/peek-exploration/actions/runs/38328803076) | ❌ | CI 的 Node 22 不接受 `node --test <目录>` 裸目录参数（模块解析错误）；本地 Node 26 可接受 |
| [38329050362](https://github.com/devon-kong/peek-exploration/actions/runs/38329050362) | ✅ | **三 job 全绿**：Exploration (23s) / Legacy (21s) / Native (31s)，commit `2513450` |

修复内容：

1. `.github/workflows/ci.yml`：node-version 20 → 22（三个 job）。
2. `package.json`：`test:native` / `test:r3-r` 改为显式 shell 展开 glob（`tests/native/*.test.mjs` 等），跨 Node 版本稳定。

本地复跑命令（Node ≥22）：

```bash
npm ci && npm test && npm run test:r3-r && npm run test:native
```

## 附注

- Actions 平台提示 checkout/setup-node@v4 目标 Node 20 已弃用（runner 强制用 24 跑 action 本体），不影响本仓库测试；后续可将 action 升 v5。
- 本分支提交未携带 SSH 签名（执行环境 1Password agent 锁定，签名与推送通道相互独立；推送经 gh HTTPS 凭据完成）。
