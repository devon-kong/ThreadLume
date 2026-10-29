# Source and third-party notices

## Source attribution

The original project is [tuzai-x-popover](https://github.com/xuntianx/tuzai-x-popover) by xuntianx, distributed under MIT. Its copyright and permission notice remain in [LICENSE](LICENSE). ThreadLume includes subsequent modifications and additions by Devon; the same MIT license applies to those contributions.

## Development dependencies

- [esbuild](https://github.com/evanw/esbuild) — MIT; JavaScript bundler.
- [jsdom](https://github.com/jsdom/jsdom) — MIT; offline DOM testing.
- [Sharp](https://github.com/lovell/sharp) — Apache-2.0; build-time image conversion. Sharp uses libvips under LGPL-2.1-or-later and other image-processing dependencies with their own notices.

These dependencies and their native binaries are development/build tools, not bundled application frameworks in the unpacked extension. Their full notices remain in the installed npm packages. The lockfile records transitive dependencies.

ThreadLume's release ZIP includes its MIT license and this notice. It does not distribute the official Doubao extension or its business modules.

## Bundled tokenizer

[gpt-tokenizer](https://github.com/niieani/gpt-tokenizer), version 4.1.0, supplies the locally bundled cl100k_base tokenizer and vocabulary. It runs only in the extension worker. Its license follows:

```text
MIT License

Copyright (c) 2023-2024 Bazyli Brzoska

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

[Acorn](https://github.com/acornjs/acorn), MIT, is used only during build-time JavaScript inspection and is not bundled into the extension.
