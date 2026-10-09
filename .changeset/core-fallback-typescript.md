---
"kiira-core": minor
---

Add `setFallbackTypescriptModule(ts)`. A host such as the VS Code extension uses it to give kiira-core a TypeScript for projects that have no usable TypeScript of their own. The project's own TypeScript still wins. The fallback is tried before the TypeScript that kiira-core resolves itself, and only when its version is 5.4+ or 6.
