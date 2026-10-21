# Contributing

Use Node.js 22.12+ and `npm ci`. Run `npm test` before submitting a change. All build aliases produce `dist-extension-native/`.

Keep changes scoped and include a reproducer for behavior fixes. Preserve native DOM ownership, cancellation, versioned key bindings and fail-closed permission behavior. Do not add X private API requests, credential capture, automatic model retries, hidden pages or new network capabilities without an explicitly reviewed design.

UI copy must cover English and Simplified Chinese. Test language changes without translating source/model content or restarting generation. Never include keys, cookies, full browser dumps or private account screenshots in an issue or pull request.

Describe what changed, its user impact, how it was verified and anything still untested. See [Architecture](docs/architecture.md) and [Security](SECURITY.md).
