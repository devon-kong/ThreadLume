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

The account below records the original release captures. The current image files were refreshed on 22 October 2026; see [follow-up screenshot provenance](showcase-validation.md#screenshot-provenance) for their current build, crop and source conditions. This does not change the release acceptance results above.

All five README images are real screenshots of the v0.12.0 product, captured through browser interaction. The English reading examples and captioned-video image were refreshed in a documentation-only follow-up on 21 October 2026; the release code and package are unchanged. Capture viewports were 1341 × 814 CSS pixels for the English post and 1329 × 802 for the video. The summary image is a direct crop of the AI card; map branches were interactively collapsed for readability. No generated interface or fabricated model output is used.

- Reader / summary / mind map: [public English post by @karpathy](https://x.com/karpathy/status/2109361546505966046), with English output from the existing configured service.
- Video screenshot: [public captioned video by @PromptWizard](https://x.com/PromptWizard/status/2053112760381436066). Native English captions were explicitly enabled through the player UI; the screenshot shows those captions alongside completed AI chapters. This is a separate showcase sample from the release acceptance video below.
- Original release video acceptance: [public captioned video by @GoSailGlobal](https://x.com/GoSailGlobal/status/2111665973891854815).
- Settings: real configured service, with diagnostics closed and no API-key value displayed.

Source posts and images belong to their respective authors. Public handles appearing in the screenshots identify the quoted content; no private conversation is shown.

## Repository and release scope

The maintained branch contains current product code, tests, documentation and selected assets. Complete recovery backups and old-to-new commit mappings are kept outside the public repository. The 11 historical closed PRs are retained, so their old discussions/diffs and some historical images may remain accessible. History cleanup does not claim to erase all GitHub copies or caches.

The ZIP is built from the accepted release commit and distributed as an unpacked Chromium preview. Website, store listing and portfolio video are outside this release.

## Setup diagnostics and caption parsing follow-up — 25 October 2026

This follow-up is separate from the preview-release observations above. `npm test` passed **657/657 Native tests**, including the build isolation checks, after the implementation and review fixes. `git diff --check` passed. Coverage adds bounded/redacted diagnostics, blocked diagnostic persistence, startup-pending settings, stale diagnostic reads, native cue markup normalization and separate local/server length errors.

Fresh extension installation was exercised twice in the existing Ego Lite profile, using one configured Chat Completions provider. Both a prompt accepted promptly and a prompt accepted after about one minute reproduced the setup failure. The host grant succeeded, the permission-change restore finished, and the session-rule read returned; the subsequent rule-install call did not return before the existing 15-second deadline. No model probe began. An already-granted retry remained blocked by the uncertain rule mutation. Denying permission retained the form draft and did not grant access.

Reloading the extension alone, followed by re-entering and checking the same service, completed the model probe and saved the service. A full browser restart was not needed in this sample. This is **diagnostic evidence and a recovery observation, not a fix for first-install setup**. It does not establish why the browser's rule-install operation stalls, or establish behavior in other browsers/providers or a fresh browser profile. Rule scheduling, uncertain-mutation ownership, permissions and automatic-retry policy are unchanged.

The trusted settings diagnostic panel was read successfully across worker reloads, then cleared and read back empty. Logs are local, capped at 200 events with a 24-hour retention window, and exclude keys and content. The diagnostic evidence was saved outside the public repository before clearing. Clipboard behavior was covered by deterministic tests; live clipboard copying was not repeated.

For the [reported video by @huxlab](https://x.com/huxlab/status/2113993371039814011), 895 currently available native English cues contained word-level markup. The timestamped input was 132,498 characters before native cue parsing and 36,135 afterward. The existing request limits were not raised. Source search no longer matched `X-word-ms`, while plain caption text remained searchable. Cue timing and order were retained; these observations cover the available-caption snapshot, not completeness of the original speech.

Actual generation through the configured service completed an English summary with eight chapters. A chapter button sought the original video to 247.394 seconds without changing its playing state. The first mind-map request passed the local length checks and received a service response but timed out at the existing 120-second deadline. One explicit UI retry completed and rendered the interactive mind map; this was not a first-attempt success. Both successful generations reached the success-cache stage. No automatic retry or fallback was added. Visibility interruptions invalidate continuous foreground timing, so these samples are not used for a speed claim.

## First-connection initialization fix — 25 October 2026

This later fix supersedes the setup limitation in the diagnostic-only follow-up above. A minimal extension reproduced the runtime optional-DNR grant failure in Ego Lite and Google Chrome 155.0.8059.85. The same rule completed after extension reload, or on first authorization when `declarativeNetRequestWithHostAccess` was declared at installation. Chromium's rule-monitor initialization and API queue code explains this boundary. The product now declares that API at installation, while service-host grants remain optional and specific to the configured host. Settings reject an old in-memory optional-DNR manifest rather than attempting the problematic first runtime API grant.

`npm test` passed **658/658 Native tests**, including build isolation. An independent read-only review found no Critical, Important or Minor issues. Regression checks cover the required API declaration without required host grants, synchronous host-only permission requests, old-manifest rejection and draft preservation. The exact endpoint rule, key-binding transaction, uncertain-write protection and no-automatic-retry policy are unchanged.

Two fresh installations of the complete build were tested in the existing Ego Lite profile. Each used a separate extension identity and changed only the display name; the existing everyday installation was preserved. Before either test, the service list was empty, the service-host grant was absent and DNR permission was present. Both used the same explicitly configured Yuanjing service and a session-only key:

- First installation: denying the host grant retained the draft and sent no model probe. An explicit retry and Allow completed rule installation, a real non-streaming model probe, configuration commit and activation.
- Second installation: the first host prompt remained open for about 52 seconds. Allow then completed rule installation, a real streaming model probe, configuration commit and activation. No manual extension reload or browser restart occurred between either installation and its successful save.
- Existing installation update: loading the corrected artifact and reloading the extension preserved provider metadata and reading/language preferences. A real connection test using the existing saved key completed successfully without re-entering it.

These are bounded live observations, not a claim for every browser or provider. Complete-product fresh-install checks in Chrome, a fresh browser profile, other live providers and browser-store update migration were not exercised in this fix session. Temporary verification extensions were removed after evidence capture; private keys were not logged or exported.

## Configurable context and long-content follow-up — 30 October 2026

Automated checks: **688/688 Native tests passed**, including build isolation and the original-source size protections. New coverage includes legacy configuration/binding compatibility, context version changes, local token accounting, bounded and balanced segmentation, overlap, global references, reducer budgets, complete-note reuse/expiry, cancellation and deadline guards, incomplete UI state, and named-caption lazy loading. A fresh independent review found a lazy-loading selection gap and contradictory stopped-progress copy; both have regression coverage and were corrected.

The actual Andy video (`https://x.com/AndyL5cc/status/2115133828650213693`) exposed 1,570 native English cues, a 3,423.666-second player duration, a last cue ending at 3,423.909 seconds, and 64,725 timestamped transcript characters. This is the available native snapshot, not proof of complete speech transcription. The new planner accepts this source; local measurement at 65,536 selects a direct request, and at the restored 32,768 selects two balanced segments plus integration. Original-source search found the final phrase and sought to 3,422.909 seconds without replacing the video or changing its playing state.

Live provider validation is **BLOCKED: not yet a successful long-video generation acceptance**. The initial 2,048-token map output was truncated. After separating visible-note limits from total output reserve, the 65,536 direct request and the first map requests in the 32,768 greedy/balanced plans reached the existing 120-second deadline. Later requests were not dispatched, partial output was marked incomplete, and no final success result was cached. The user then approved a 300-second request deadline (the segmented-task deadline remains 600 seconds). The next map failed stream validation at about 157 seconds; the old aggregate diagnostic cannot establish its exact cause. Stream wire traffic now has an independent 8 MiB bound, with the visible completion limit unchanged at 60,000 characters, and fixed diagnostic phases distinguish future stream failures. The following map returned an explicit truncated-output finish at about 196 seconds with an 8,192-token output allowance. Longer waiting alone therefore does not resolve this sample. No provider-specific thinking parameter has been sent. Live success of summary integration, mind map, and final chapter interactions remains blocked by service output completion. API keys were neither read nor re-entered, and the temporary context setting was restored to 32,768 through Settings. These observations do not establish the provider's reasoning-token behavior or the accuracy of generic token estimates for that model.

This follow-up used **6 of 12 generation requests and 2 of 2 connection probes**. The user then ended further live calls and retained the implementation; no new service or thinking-mode setting was configured. Later stages were never dispatched after a failure. Truncated-output feedback now links to service editing rather than offering only an unchanged retry. The available-caption search/time mapping passed live; semantic preservation across segment boundaries, successful final chapter focus/scroll behavior, and notes-reused mind-map generation are **NOT_TESTED live** because no complete note set was produced. Automated fixtures cover these orchestration and mapping paths; they are not substitutes for live model quality checks.
