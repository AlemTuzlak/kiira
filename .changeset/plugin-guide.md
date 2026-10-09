---
"kiira-core": patch
"kiira": patch
---

Document the rule and plugin API: a new Plugins section with a page on what is experimental, a reference for rules and presets, and a guide to writing a plugin, plus an `examples/plugin-basic` project. `TypescriptHookContext` gets a new `frontmatter` field, the same value document rules get, so a TypeScript hook can read a page's frontmatter. It is `undefined` when the document has none or when only the checked fences are known. The agent skills now cover `--rule`, `--fix --dry-run`, and the JSON `schemaVersion`.
