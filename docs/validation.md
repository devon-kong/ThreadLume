# v0.12.0 preview validation

This is a bounded preview, verified on 21 October 2026. The release tag identifies the accepted source; the downloadable provenance record contains its full commit SHA and package checksum. Automated results and live observations are reported separately.

## Automated checks — PASS

`npm test` builds the sole `dist-extension-native/` artifact and runs **641 Native tests: 641 passed, 0 failed, 0 skipped** on macOS with Node.js 26.9.0. CI targets Node.js 22. The build also enforces X content/MAIN network isolation and permission boundaries. `git diff --check` passed.

Coverage includes:

- Retired Doubao states, old explicit messages, worker startup and legacy cache/generation blocking; zero bridge connection, Doubao request or automatic setup-page calls in the worker doubles.
- Custom service binding, versioned key storage, interrupted persistence, permission/rule failures, streaming and non-streaming parsing, timeout/cancellation and stale-response rejection.
- Independent language defaults, missing-field migration, enum rejection, settings-only writes and the narrow reader output-language message.
- Language switching during extraction, completed results, pending generation and streaming; UI switching preserves result/node identity and does not start model requests.
- Native ownership, layout fallback, media lifetime, source extraction, comment scrolling, anchors, preview timing classification and build isolation.

Bridge-specific suites were removed with the retired bridge. Still-applicable worker navigation, tab-close, document/focus admission and late-cache rejection tests were migrated to the custom-service suite. The active performance monitor was moved into `tests/native/helpers/reader-performance.mjs`; tests no longer import historical reports. Historical PoC scripts and their separate CI job were retired.

An independent code review found an output-language state-reset gap and lost worker lifecycle coverage; both were corrected and independently rechecked before release.

## Actual browser/service observations

Environment: Ego Lite, Chromium **154.0.0.0**, macOS Apple Silicon, 1329 × 802 CSS-pixel desktop viewport. The existing unpacked extension identity and installation directory were preserved. The existing **DeepSeek / deepseek-v4-flash** service was used through its UI; no API key was read, exported or re-entered.

| Scenario | Result |
| --- | --- |
| Existing service and saved key survive extension reload | PASS |
| Article English summary and interactive mind map | PASS |
| Captioned video summary, chapter output and mind map | PASS; 28 currently available native cues from a 51.5-second video |
| Minimal connection tests and streaming/non-streaming generation | PASS; original streaming preference restored |
| Settings UI English ↔ Simplified Chinese | PASS |
| Independent output language English ↔ Simplified Chinese | PASS; actual Chinese and English results observed |
| Light/default and dark AI theme | PASS |
| Stop, view switches and returning focus | PASS; stopped map did not automatically restart |
| Explicit retry after stop | PASS; video mind map completed |
| Native video continuity during AI view/stop interactions | PASS; playback advanced from 14.53 to 20.10 seconds without pausing |
| Source search, copy feedback, map zoom/branch toggles and Escape | PASS |
| Native comments scroll and explicit reader exit | PASS; owned UI removed, native video retained; exit position observed at y=10 in this sample |
| New service dialog and disclosure | PASS; empty password field, host/model fields and data-sending explanation |
| Live narrow-window resize | BLOCKED by browser automation: requested 900px override left actual viewport at 1329px; offline narrow-width regressions pass |
| Real permission revocation, forced worker termination mid-save, actual provider timeout/authentication failure | NOT_TESTED live; covered with deterministic worker/transport doubles |
| Fresh browser-profile installation, other providers/browsers, physical touchpad gestures, exhaustive deep-scroll restoration | NOT_TESTED in this release session |

Native X menus, comments and source content keep X's own language. AI output depends on the model and must be checked against the source. Native caption metadata can remain visible in search snippets on some X videos.

## Timing observations

The article timing sample is the [public Chinese-language article by @Khazix0918](https://x.com/Khazix0918/status/2112794968981139875), not the English post used in the updated README screenshots. These are individual observations, **not a benchmark or improvement claim**. No previous percentage improvement is reused. Service latency, model output length, source and cache state vary.

| Sample | Mode / cache | First readable in foreground | Complete display | Backend completion |
| --- | --- | --- | --- | --- |
| Article, 5,212 input characters, English map | Streaming / miss; uninterrupted foreground, n=1 | 9.94 s | 10.91 s | 10.71 s |
| Same article, English summary | Non-streaming / miss, n=1 | Not measured: visibility interrupted | Not measured: visibility interrupted | 5.22 s |

Timers start at request admission; source extraction is separately measured. First readable and complete display come from the reader's presentation telemetry, not from HTTP headers. A hidden/changed view invalidates continuous foreground timing. Cache-hit display is not counted as fresh model performance. Native opening-speed comparison was not repeated in this release; no new speed claim is made.

## Screenshot provenance

All five README images are real screenshots of the v0.12.0 product, captured through browser interaction. The English reading examples and captioned-video image were refreshed in a documentation-only follow-up on 21 October 2026; the release code and package are unchanged. Capture viewports were 1341 × 814 CSS pixels for the English post and 1329 × 802 for the video. The summary image is a direct crop of the AI card; map branches were interactively collapsed for readability. No generated interface or fabricated model output is used.

- Reader / summary / mind map: [public English post by @karpathy](https://x.com/karpathy/status/2109361546505966046), with English output from the existing configured service.
- Video screenshot: [public captioned video by @PromptWizard](https://x.com/PromptWizard/status/2053112760381436066). Native English captions were explicitly enabled through the player UI; the screenshot shows those captions alongside completed AI chapters. This is a separate showcase sample from the release acceptance video below.
- Original release video acceptance: [public captioned video by @GoSailGlobal](https://x.com/GoSailGlobal/status/2111665973891854815).
- Settings: real configured service, with diagnostics closed and no API-key value displayed.

Source posts and images belong to their respective authors. Public handles appearing in the screenshots identify the quoted content; no private conversation is shown.

## Repository and release scope

The maintained branch contains current product code, tests, documentation and selected assets. Complete recovery backups and old-to-new commit mappings are kept outside the public repository. The 11 historical closed PRs are retained, so their old discussions/diffs and some historical images may remain accessible. History cleanup does not claim to erase all GitHub copies or caches.

The ZIP is built from the accepted release commit and distributed as an unpacked Chromium preview. Website, store listing and portfolio video are outside this release.
