# Privacy and data handling

ThreadLume processes the currently opened X post in your browser. It has no analytics backend and does not upload diagnostics to the maintainer.

## Reading without AI

The extension works with content already present in X's page. It does not extract login cookies, authorization tokens or CSRF values, and does not initiate private X API requests. X's own page continues to manage its normal network traffic and account interactions.

## AI requests

After you explicitly configure and test an AI service, eligible article text or available native video caption cues are sent to that active service when its selected view is generated. Requests can include the source title and public URL as part of the source input. Selecting a second view can send another request. A connection test sends only a minimal test prompt, not your current article.

Custom services use HTTPS Chat Completions requests. API keys go only to the configured, validated endpoint. Requests omit website cookies, reject redirects and never automatically switch providers or resend failed model requests. Provider retention, billing and usage policies apply separately.

Streaming displays provisional output. Only fully validated results enter the success cache. Stopping aborts the browser request where possible; it cannot guarantee that the provider stops computing or charging.

## Local storage

- Preferences: theme, enabled AI features, default view, interface and output language.
- Provider configuration: names, endpoints, models, binding versions and test timestamps.
- API keys: password input and fixed saved-key masks; keys are not returned to content scripts, diagnostics, exports or sync storage. Only trusted extension contexts can access local/session storage.
- **Remember on this device** stores the key in browser-local extension storage. This is not system-keychain encryption. With it off, the key is kept in browser-session storage and is lost when that session ends.
- Validated AI output: a bounded local cache, at most 30 entries, approximately 4 MiB and seven days. Cache identity includes provider/configuration, source, view and output language.
- Generation diagnostics: bounded numeric timing and fixed status records in session storage.
- Connection diagnostics: up to 200 fixed stage/timing records in local storage, retained for at most 24 hours of observable use. Expired records are removed on initialization, reading or appending; no background expiry timer keeps the worker alive. They survive browser restart, but not extension removal. Settings can read, copy or clear these records. No API keys, endpoints, source text or raw provider responses are included; there is no automatic upload. Diagnostic reads do not probe the model.

Legacy Doubao data is retained for compatibility. Its bridge and runtime entry points are disabled; old connection state is not restored or used to generate content. ThreadLume does not access or modify an external Doubao installation.

## Permissions

- Required `storage`: preferences, provider bindings, keys and bounded cache.
- Static content scripts: X/Twitter pages, to provide the reader.
- Optional HTTPS host access: requested for the specific configured service by a settings-page gesture. The broad manifest ceiling is not a bulk runtime grant.
- Required `declarativeNetRequestWithHostAccess`: declared at installation so Chromium initializes its rule engine before the first service setup. It does not grant service-host access; that remains optional. The only session rule is for the existing exact Yuanjing compatibility endpoint and removes Origin only for this extension's POST request to that URL. Other endpoints do not use this rule.

No cookies, history, management, webRequest, required all-site network permission, hidden page, iframe, offscreen document or keepalive is added.

## Your controls

Use Settings to change services or languages, stop generation, disable AI views or change key persistence. Removing the extension removes its local data. Browser host permissions can be revoked independently; requests then stop until explicitly restored. Avoid clearing browser storage merely to resolve a connection error, because that also removes saved configuration and keys.
