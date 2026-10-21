<p align="center"><img src="public/brand/logo-light.svg" alt="ThreadLume" width="420"></p>
<p align="center"><strong>Read Beyond the Post.</strong><br>A native two-column reader for X, with AI summaries, video chapters and interactive mind maps.</p>

[Installation](#installation) · [Architecture](docs/architecture.md) · [Engineering case study](docs/case-study.md) · [Validation](docs/validation.md) · [Privacy](PRIVACY.md)

ThreadLume keeps the original post and its media beside the conversation. Read an article, watch a captioned video, explore a mind map, and return to the timeline without losing your place.

**Preview release:** desktop Chromium extension, installed unpacked. AI requires your own compatible API service; basic reading works without it. ThreadLume is an independent project and is not affiliated with or endorsed by X Corp.

## See it in use

![Native two-column reading](docs/assets/reader.png)

| Article summary | Interactive mind map |
| --- | --- |
| ![Article summary](docs/assets/summary.png) | ![Interactive mind map](docs/assets/mindmap.png) |

![AI service settings](docs/assets/settings.png)

Screenshots and their validation conditions are documented in [Validation](docs/validation.md). A video walkthrough is planned separately.

## What it does

- **Native reading:** the original X post, video and comments keep their native interactions in a focused two-column layout.
- **AI summaries and chapters:** summarize eligible articles and available video captions; jump to a chapter in the original player.
- **Interactive mind maps:** expand branches, pan, zoom, fit the map and copy a structured outline.
- **Progressive results:** optionally read streamed summaries and validated map previews before the full response completes.
- **Control over requests:** generate the current view first, stop a task, retry explicitly and reuse cached results. Incomplete output is never a successful cache entry.
- **Bring your own service:** configure HTTPS Chat Completions APIs, models and API keys. No provider account is bundled.
- **Independent languages:** English and Simplified Chinese UI; separately choose and remember the AI output language.
- **Light and dark themes:** match X or choose a separate reader theme.

## Installation

Use Node.js 22.12+ and npm with a current desktop Chromium browser.

```sh
git clone https://github.com/devon-kong/ThreadLume.git
cd ThreadLume
npm ci
npm run build
```

1. Open `chrome://extensions/` and enable **Developer mode**.
2. Choose **Load unpacked** and select `dist-extension-native/`.
3. Refresh your X tabs and open a post.

You can also download the unpacked extension ZIP from [Releases](https://github.com/devon-kong/ThreadLume/releases), extract it and load the extracted directory containing `manifest.json`.

To update, rebuild, reload the extension and refresh X. Keep the same unpacked installation directory to preserve the browser's extension identity and local settings. A fresh checkout or a different browser profile does not automatically receive your saved API configuration.

## Connect AI

Open ThreadLume Settings and select **Add AI service**. Enter a service name, HTTPS Base URL, model and API key. **Save, test & enable** requests access only to that host and runs a minimal compatibility test. Your current article is not sent during that test.

After connection, opening eligible content automatically generates the selected view. The other view is generated when selected. Provider charges and usage limits apply. Streaming is opt-in and verified when saving; unsupported streaming does not trigger an automatic fallback.

The former Doubao extension bridge is unavailable. Previous data is retained locally, but no Doubao connection or generation is attempted. Select a configured API service to continue.

## Engineering highlights

- **Native page lifecycle:** layout adaptation with bounded ownership and restoration, preserving X's virtualized content rather than rebuilding comments.
- **Asynchronous reliability:** scoped request ownership, cancellation, stale-response rejection, worker recovery and explicit failure states.
- **Provider binding:** versioned configuration and key records, atomic publication after a successful test, and endpoint-scoped permission handling.
- **Progressive visualization:** validated partial results, readable initial map depth, stable rendering and independent view caches.
- **Verification:** behavioral tests, build-time isolation checks and separately labelled browser evidence.

The [case study](docs/case-study.md) explains the problem, design decisions and tradeoffs. [Architecture](docs/architecture.md) documents the runtime boundaries.

## Development

```sh
npm test              # builds the only artifact and runs the Native suite
npm run build:current # same output as npm run build
npm run build:native  # same output as npm run build
```

`native-extension/` contains the product, `tests/native/` the regression suite, `scripts/` the build tools, and `docs/` current technical and release documentation. Build output and dependencies are not committed.

## Supported scope and limitations

- Designed for desktop windows. AI panels are hidden below 980 CSS pixels; X's native view remains available.
- Video AI uses currently available native caption cues, which may not cover an entire video. There is no video download, speech recognition or automatic caption-button activation.
- Short posts and videos without usable captions do not generate AI content.
- The reader depends on X's DOM and a bounded internal React layout adapter. X changes can make it unavailable; it then returns control to the native view.
- Native replies, likes, bookmarks and other account actions remain X interactions. ThreadLume does not issue X private HTTP API requests.
- Lark saving is a disabled future feature, not part of the preview's supported capabilities.
- Model quality, format compliance, latency and availability depend on the selected service. See [tested and untested scenarios](docs/validation.md).

## Project information

[Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Privacy](PRIVACY.md) · [Changelog](CHANGELOG.md)

Code is distributed under the [MIT License](LICENSE). Copyright notices are retained; dependency and source acknowledgements are in [Third-party notices](THIRD_PARTY_NOTICES.md). X and Twitter are trademarks of their respective owners.
