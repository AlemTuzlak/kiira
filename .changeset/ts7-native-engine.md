---
"kiira-core": minor
"kiira": minor
---

Add TypeScript 7 support via a new `engine` config option (`"auto" | "classic" | "native"`, default `"auto"`).

When your project has `typescript@>=7` installed, `"auto"` type-checks doc snippets with TypeScript 7's native (Go) compiler through its `unstable/sync` API; otherwise it uses Kiira's bundled TypeScript. Diagnostics are identical across engines. Editor code-fixes continue to use the bundled TypeScript (the native compiler has no code-fix API yet).
