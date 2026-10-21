# ThreadLume repository conventions

## Product
- Maintain only the Native Chromium extension, a single-window reader with the original X post on the left and native comments on the right.
- `npm run build`, `build:current`, and `build:native` produce only `dist-extension-native/`; never recreate the retired Legacy output.
- Public brand: ThreadLume — AI Reader for X. English UI and output defaults; Simplified Chinese remains available independently.
- Preserve internal storage keys, versioned API-key ownership, message namespaces and DOM identifiers during branding changes.

## Data and permissions
- X content/MAIN scripts must not initiate private HTTP API requests, capture credentials, or access AI secrets. MAIN remains layout-only.
- AI requests use an explicitly configured HTTPS Chat Completions service with `credentials: omit` and `redirect: error`.
- Only trusted settings may edit provider configuration or keys. The reader may update only its strictly validated output-language preference.
- Keep local/session storage restricted to TRUSTED_CONTEXTS. Never log, export or return API keys.
- Preserve the existing exact-endpoint Origin-removal policy, optional host grants, atomic binding and no automatic retries/fallback.
- Doubao's extension bridge is retired. Preserve legacy data and compatibility helpers, but never initialize, probe, restore or execute a Doubao network route. No hidden pages, offscreen documents or keepalive.

## UI and lifecycle
- Preserve native React ownership, media continuity, focus, comment scrolling and return position. Follow the layout-adapter contract.
- Native reader chrome stays minimal: product name and functional controls; no decorative brand avatar.
- Partial AI output is visibly incomplete and must not enter the success cache. Stop remains stopped across focus/visibility changes.
- UI-language changes must not trigger generation. Output-language changes are explicit and caches remain language-separated.

## Development and evidence
- Run Native tests and build isolation checks for behavior changes; exercise real browser flows before claiming live acceptance.
- Distinguish verified behavior, offline fixtures, BLOCKED and NOT_TESTED. Do not claim percentage improvements without comparable measurements.
- Keep current documentation in docs; execution logs and historical experiments belong in the private external archive.
- Public docs cover installation, architecture, validation, limitations, privacy and engineering highlights. Retain copyright and applicable licenses.
- Use isolated worktrees for substantial changes. Preserve other work and inspect the current diff before integrating.
- The approved ThreadLume launch plan authorizes private baseline backup, historical-data cleanup, lease-protected history replacement, old-tag cleanup, repository rename/publication and a preview Release after verification.
