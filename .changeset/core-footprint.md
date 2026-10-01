---
"kiira-core": minor
"kiira": minor
"kiira-vscode": patch
---

`typescript` and `jiti` are now optional peer dependencies of `kiira-core`, and sourcemaps are no longer published. The `kiira` CLI installs both itself, so CLI users change nothing. If you call `kiira-core` programmatically, install `typescript` 5 or newer, and `jiti` to load a `.ts` config.
