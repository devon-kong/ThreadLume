# Showcase and usability checks — 22 October 2026

This follow-up covers the clearer README and ZIP-first installation guide, refreshed screenshots, removal of unavailable UI actions, and a small source-fidelity review. It is not a new release or a broad model-quality benchmark.

## Scope and environment

- Source baseline: `fd0d68f`, plus the changes accompanying this document.
- Runtime: macOS Apple Silicon, Ego Lite / Chromium 154.0.0.0, 1329 × 802 CSS-pixel viewport.
- Existing unpacked installation and configured `deepseek / deepseek-v4-flash` service. The installation directory and extension identity were preserved; credentials were not read or copied.
- English UI and output. Existing caches were not cleared. Article summary/map and video summary were inspected as displayed results, not claimed as fresh generations. The video map was explicitly selected and observed moving from **Generating** to **Complete**.
- AI output was compared with the rendered source post and available standard TextTrack cues. This checks faithfulness to those sources, not whether an author's claims are objectively true.

## Automated and browser checks

| Check | Result and boundary |
| --- | --- |
| Baseline `npm test` | PASS: 641 tests, no failures or skips. |
| Updated `npm test` | PASS: 643 tests, no failures or skips; includes the sole Native build and network/permission isolation checks. Node.js 26.9.0. |
| New/unconfigured, configured and retired-service settings | PASS offline: only usable services appear in the selector; empty configurations show the add-service action without an empty selector; retired state retains its migration guidance; no automatic legacy connection or permission request. |
| Live configured-service menu after extension reload | PASS: configured services remain available, no retired Doubao option, active service still connected. This does not establish new-profile setup. |
| Reader action cleanup | PASS live: no Lark placeholder on the long-post reader. Offline checks also cover repeated entry/exit, narrow width, disabled AI modes and preservation of native reply/like nodes. |
| Article summary and expanded map | PASS for rendering and interaction; output caveats below. |
| Video chapter click | PASS: clicking `00:00:54` moved the original player to 54.043 seconds, with playback continuing. |
| Video map | PASS for completed rendering; one source-detail omission noted below. |
| Native layout recovery | One reload fell back to X with `focal-cell-not-found`. After inspecting the failure, one explicit reload restored the reader. This observation remains a preview limitation; no layout-adapter change was made in this follow-up. |
| Fresh browser-profile installation and first AI setup | **NOT_TESTED**: a separate empty profile with user-completed X login and provider setup was not available. No account/session/key data was copied to manufacture a fresh-profile result. |

## Downloaded release package

The current published preview is [`v0.12.0`](https://github.com/devon-kong/ThreadLume/releases/tag/v0.12.0), marked as a prerelease. Installation links point to the releases list, which includes prereleases.

The actual public `ThreadLume-v0.12.0-preview.zip` was downloaded and inspected:

- SHA-256: `ba0a4e57e8c659324cf66c18792ade592e68633e2cb8f92b49ed7300ac709052`, matching GitHub's asset digest.
- 25 ZIP entries, with `dist-extension-native/manifest.json` as the single manifest; Manifest V3, version `0.12.0`.
- Extraction completed; no absolute or parent-traversal ZIP paths.

This is **package integrity verification**, not a browser installation result. The published ZIP still contains its tagged source; it does not include the UI changes in this follow-up.

To close the fresh-profile gap: download that package in an empty browser profile, load the extracted manifest directory, complete X login manually, verify basic reading before AI setup, enter a dedicated service key through Settings, approve the requested host permission, run the connection test, and verify the first summary and a reload. Record the exact package, browser version and outcome of each step. Never put credentials in the record.

## Output quality samples

### A. Long English post

Source: [Andrej Karpathy's post about the widening LLM understanding gap](https://x.com/karpathy/status/2109361546505966046). The rendered source contained 3,301 characters; the displayed English summary contained 1,081 characters. These lengths are descriptive, not an accuracy metric.

| Source checkpoint | Observed output | Assessment |
| --- | --- | --- |
| Four audience/access tiers: roughly 6B, 1–2B, 20M and 5,000 people | Summary retains all four tiers and their approximate numbers. | Matches the source's stated figures; these were not independently fact-checked. |
| Three drivers: ambition/problem horizon, domain jaggedness, access | Summary includes all three; map separates them under “Drivers of the funnel.” | Main explanatory structure retained. |
| Capability peaks in digital, verifiable, economically valuable domains | Present in both summary and expanded map. | Matches source. |
| “Napkin math” qualification on population estimates | Summary uses “about”/“roughly” but drops the explicit rough-estimate qualification; map also presents the figures compactly. | **Caveat:** attribution and uncertainty are weaker than in the source. Do not reuse the numbers as verified statistics. |
| Supporting explanations of why executives/non-technical users experience less direct benefit | Compressed in the summary; more detail retained in the map. | Expected summarization loss; consult the source for the full argument. |

The [summary](assets/summary.png) and [expanded branch detail](assets/mindmap.png) show the actual inspected outputs. No model text was rewritten for the images.

### B. English captioned video

Source: [Prompt Wizard, “Colonist 47-B — Episode 1: Right on Schedule”](https://x.com/PromptWizard/status/2053112760381436066). This is a fictional narrative, not a factual technology report.

The video duration was 150.033 seconds. There were 25 available English subtitle cues, from 24.300 to 110.433 seconds, with gaps. That range is not a claim of continuous coverage, and the opening/ending outside it are not covered by these cues.

| Source checkpoint | Observed output | Assessment |
| --- | --- | --- |
| Impact warning and ejection at 24.3–29.166 s | “Emergency Ejection” chapter at `00:00:24`. | Supported by captions. |
| Vesper, unresponsive captain and autopilot fault at 54.033–62.933 s | Summary and map retain the cause discussed in the dialogue; chapter at `00:00:54`. | Supported; timestamp jump was also exercised. |
| Reentry, battery charging, 67% → 84% → complete | Summary and map retain the charging sequence and thruster countdown. | Supported by cues at 67.866–92.233 s. |
| Arrival on Surface 47B and first-day warning | Chapter at `00:01:45`, summary and map contain both ideas. | Supported by cues at 105.5–110.433 s. |
| Summary phrase “faulty ejection” | Captions identify a faulty autopilot and an emergency ejection; they do not explicitly say the ejection system is faulty. | **Caveat:** compressed causal wording is ambiguous; use the more precise autopilot explanation in the source. |
| Post credits Grok, ElevenLabs, Suno and CapCut | Map's production node lists the first three and omits CapCut. | **Omission:** do not use the generated node as a complete production-credit list. |

The map completed with 18 rendered nodes. Node count is not a quality score. The [video screenshot](assets/video-captions.png) shows the chapter interaction and available English captions.

## Screenshot provenance

All five assets were captured from the installed follow-up build on 22 October 2026, in the viewport stated above. No synthetic interface, rewritten result or composited model output is used.

- `reader.png`: original long post, summary and native comments.
- `summary.png`: a direct capture of the expanded summary card (approximately 620 × 550 CSS pixels).
- `mindmap.png`: a direct 445 × 570 CSS-pixel detail capture of the “Drivers of the funnel” branch, after using the product's expand/collapse and zoom controls. Other branches are outside this crop; it is not a full-map overview.
- `video-captions.png`: the original video after clicking the 54-second chapter, with its English captions visible.
- `settings.png`: a direct 830 × 530 CSS-pixel capture of service status and language settings. No key input or key value is shown.

The images are displayed separately in the README to preserve readability. Settings imagery is in the installation guide. Source content belongs to its respective authors.

## What these checks do not establish

These two selected sources do not establish a general accuracy rate, time savings, complete caption coverage, universal provider compatibility or successful first-time installation. They demonstrate inspectable inputs and outputs, working interactions in the existing environment, and specific limitations that a reader can verify.
