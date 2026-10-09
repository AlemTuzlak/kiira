---
"kiira-vscode": patch
---

Minify the extension bundle: its JavaScript drops from 1.17 MB to 672 kB and the `.vsix` from 963 kB to 886 kB. Function and class names are kept, so stack traces in bug reports stay readable.
