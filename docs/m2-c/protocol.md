# Candidate C protocol — 2026-10-13

User approved researching two visible native X pages, left from original post and right from below it. This explicitly relaxes the earlier no-extra-page-instance constraint; no private requests/auth/React internals/account writes/iframe security bypass. Source checkout and B0 evidence stay intact. New branch codex/peek-native-m2c-dual-page starts at B0 27ad2b1 (production source still M1-R dfb94f7).

Bounded spike: (1) verify current official public tab/window APIs; (2) use two visible task-owned native pages, no DOM reparenting; (3) one fixed video sample and one Article sample, deep right scroll and left identity/media controls, viewport/visibility recorded; (4) assess duplicated resources and one-shot comment positioning; (5) independent review and report. At most one minimal optional CSS/positioning probe; no broad UI implementation, no browser upgrade, no private API workaround. Current Ego Chromium UA 152; official split-creation API says 155+. Manual native Split View UI may exist earlier. Do not call a manual UI split an automated MV3 pass.

Current TaskSpace 20, exactly one for this follow-up; prior TaskSpace19 was finished. Temporarily disable the existing Peek Native 0.9.0 through extension UI and restore it at completion. Public source text only in durable docs; strip account identity, full network URLs, headers and bodies. Network metrics are passive PerformanceResourceTiming categories/counts, not complete byte or request attribution. Keep limitations explicit.

Fixed samples: thinkszyg/2109309251533570509 (video); wlzh/2109433207318081885 (Article); KinGao476942/2109792240776421482 (images if time permits). Deep-right steps 800,1600,2800,4200,5800,8000; no rerun to manufacture PASS. Left navigation deliberately independent: investigate route drift rather than auto-syncing each right reply navigation.

## Delivery state

Research and independent review finished; browser probes cleaned and original Peek restored. Two signed commit attempts failed with `1Password: agent returned an error`. Signing remains enabled. New files are staged locally, not committed or pushed. Remote branch codex/peek-native-m2c-dual-page was created at the unchanged B0 commit27ad2b1; it does not yet contain this research. No C PR created. Resume by resolving the local signing-agent availability, then commit and push this staged research; do not disable signing silently. Product/Legacy source unchanged.

## C1 交付更新（2026-10-13）

此前签名阻塞已解除：C1代码与研究提交 `e22f84d` 已推送至 `codex/peek-native-m2c-dual-page`，Draft PR #4：https://github.com/devon-kong/peek-exploration/pull/4 。保留签名配置，没有关闭签名。详细验证见 `c1-verification.md`。

浏览器TaskSpace21中的临时注入已清理；原有 Peek Native (M1) 扩展已恢复启用，1Password未改变。已点击扩展管理页Load unpacked并handOff给用户；当前空间保留p1公开视频样本、p2扩展管理页，等待用户在原生目录选择器选择 `dist-extension-native-dual/`。未调用finish，因为等待用户操作；下轮经用户确认后resume同一space21，先确认C1安装再暂停M1做实际MV3验收。不要把当前handOff状态写成已安装。
