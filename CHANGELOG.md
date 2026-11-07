# Changelog

## Unreleased

- Added an API key reveal toggle in the trusted service dialog: an eye button unmasks the saved key on demand and masks it again on the second click. The key is fetched from the background worker only for the settings page, is never logged, traced or exported, and content scripts are rejected.
- Compacted the reader AI chrome into single lines: generation statistics (elapsed, input and output tokens) render in the bottom footer directly after the model name, the cached-result marker moved into the status line, and the footer dropped the AI prefix, the source-check reminder, the caption-snapshot note and the inline Details disclosure. Full request details remain in Settings → Data call history. Narrow panels now truncate the statistics gracefully instead of wrapping.
- Put real reading results and ZIP installation first in the English and Chinese README.
- Refreshed product screenshots, including a readable mind-map branch detail.
- Removed unavailable service and Lark placeholder actions; retained legacy migration guidance and data.
- Added a setup guide and a bounded source-fidelity review, including observed omissions and the remaining fresh-profile validation gap.

## 0.12.0 — ThreadLume preview

- Introduced ThreadLume branding and editable logo assets.
- Added English-first controls with Simplified Chinese support and independent remembered AI output language.
- Made compatible API service setup directly accessible.
- Retired the Doubao extension bridge while preserving old data and disabling old runtime routes.
- Preserved the native two-column reader, progressive AI results, mind maps and versioned provider bindings.
- Consolidated current documentation and Native tests; removed historical experiment material from the maintained tree.

See [Validation](docs/validation.md) for the evidence and limitations of this release.
