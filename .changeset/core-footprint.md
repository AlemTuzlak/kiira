---
"kiira-core": minor
"kiira": minor
"kiira-vscode": patch
---

`typescript` and `jiti` are now optional peer dependencies of `kiira-core`, and sourcemaps are no longer published. The `kiira` CLI installs both itself, so CLI users change nothing to install. If you call `kiira-core` programmatically, install `typescript` 5.4+ or 6, and `jiti` to load a `.ts` config.

The CLI now uses your project's TypeScript when it is 5.4+ or 6, instead of always using its own copy. If your project has no TypeScript, or has an older version or TypeScript 7, the CLI uses its own copy.

**Breaking for direct `kiira-core` API users:** the MDX parser now loads on demand. If you call `extractSnippetsFromContent` directly on `.mdx` files, `await loadMdxSupport()` first.
