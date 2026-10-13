# Candidate C research probes

Not integrated into Native or Legacy. `observe.mjs` only reads DOM identity,
media state and sanitized passive resource categories. `run-isolation.mjs`
records two independent X documents in Ego TaskSpace20; it does NOT create
Split View. Tests showed right-list eviction did not evict left media, while
ordinary tab switching hid/paused the left video. Do not relabel that as a
simultaneously visible playback pass.

The script contains this investigation's explicit workspace path/space ID.
Establish the authorized task space before any reuse, use only owned pages,
disable/restore conflicting Peek through extension UI, and never copy headers,
cookies, API bodies or private React properties. Each bounded timer clears after
40 samples or explicit stop; reload clears probe references. The original
absolute Article steps are retained; the one relative-scroll correction has a
separate evidence file. `docs/m2-c/research.md` is the delivery report.


Article correction reproduction (not an additional candidate implementation):
After `run-isolation.mjs` leaves both pages on wlzh/2109433207318081885,
keep its `window.__m2c` references. On p2 compute
`base = focal.getBoundingClientRect().bottom + scrollY - 54`.
For offsets `[0, 800, 2400, 4800]`, call native `scrollTo(0, base + offset)`,
wait a bounded 800ms for native virtualization, then record `__m2c.sample()`.
Read p1's sample last (this may activate it, so do not infer simultaneous
visibility). Persist `{reason, base, rows, leftAfter}` separately in
`article-relative-scroll.json`, retaining the first dataset. This was run once;
base was 8676.796875, final right scroll 13477, left scroll 10.

C1补充探针：`hide-probe.mjs`直接测试article折叠；`content-probe.mjs`测试实际构建content.js配合mock runtime。它们绑定本次space21及本机worktree绝对路径，重跑需显式修改到当前授权空间/路径；不能重新接管已结束空间。全部是CSS/内容脚本注入证据，不是安装MV3。
