# ThreadLume extension

This is the maintained Manifest V3 product source. See the [project README](../README.md) for installation and [Architecture](../docs/architecture.md) for module boundaries.

`npm run build`, `npm run build:current` and `npm run build:native` all produce `dist-extension-native/`. `npm test` builds that artifact and runs the Native regression suite.

MAIN owns the bounded native layout adapter. ISOLATED owns source extraction and reader controls. The extension worker owns provider bindings, trusted key storage, network requests, cancellation and bounded cache. Settings alone can edit API configuration; the reader may persist only a validated output-language enum.
