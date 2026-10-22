# Product demo

The 38-second film shows ThreadLume through real browser recordings: reading the original post beside native replies, jumping to a video chapter, watching a summary take shape and expanding a mind-map branch. The README embeds the entire film with its soundtrack in a player. An upload-optimized 1080p encode is used for inline playback; the [original MP4 is available to download](https://github.com/devon-kong/ThreadLume/releases/download/v0.12.0/ThreadLume-demo-38s.mp4). Both versions retain all 38 seconds and the same audio track.

| Time | What is shown |
| --- | --- |
| 0–7 s | Original post and native replies side by side; replies scroll while the video keeps playing. |
| 7–15 s | Click a chapter timestamp to seek in the original video. |
| 15–22 s | A real English summary appears progressively. |
| 22–29 s | Expand one mind-map branch. |
| 29–34 s | Return to the full two-column reader. |
| 34–38 s | ThreadLume and the preview download call to action. |

## What the footage establishes

Recorded on 22 October 2026 in the existing installed follow-up environment. The opening, chapter jump and return to the reader use a new continuous capture; the summary and mind map reuse real recordings from the earlier revision. The installed bundle's exact Git SHA was not established by this recording. The published v0.12.0 ZIP remains its tagged build; this film includes the later UI follow-up documented in [showcase validation](showcase-validation.md).

The opening capture records 288 pixels of right-side comment scrolling while the original video stays in the same position and continues playing. Clicking the real `00:00:54` chapter moves that native player from approximately 37.39 to 54.71 seconds. The summary segment uses actual streaming footage at **0.5× playback**, explicitly labeled on screen; it is not a generation-speed claim. The map segment contains one actual branch expansion. Product controls and AI output are English; some native X text remains in the browser's Chinese locale.

Labels, click rings and transitions are editorial annotations. Brief final-frame holds support reading; no model output or product control was rewritten. The full MP4 is 1920 × 1080 at 30 fps. This is a selected workflow demo, not a benchmark, first-install validation, or claim of universal compatibility. Video chapters depend on available native captions. See the [source-quality and caption-coverage caveats](showcase-validation.md#output-quality-samples).

## Source content

- [Andrej Karpathy — source article](https://x.com/karpathy/status/2105819303471976479).
- [Prompt Wizard — Colonist 47-B, Episode 1: Right on Schedule](https://x.com/PromptWizard/status/2053112760381436066), a fictional narrative.

Source content belongs to its respective authors. ThreadLume is not affiliated with or endorsed by these authors or X Corp.

## Production credits

Made with [huashu-motion](https://github.com/alchaincyf/huashu-motion), with an original score and operation sound effects; no narration or source-video audio. Editorial typography uses Inter; captured browser typography is preserved. Instrument pack attribution is retained in [demo audio credits](assets/demo-audio-credits.txt), including electric-piano samples by Greg Sullivan under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), trimmed, resampled and re-encoded by the tool. These sample credits do not imply the samples' authors endorse the project.

Project code licensing and [third-party notices](../THIRD_PARTY_NOTICES.md) are unchanged.
