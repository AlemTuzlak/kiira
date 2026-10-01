---
"kiira-core": patch
"kiira": patch
---

Document the rule and plugin API: a new Plugins section with a reference for rules and presets, a guide to writing a plugin, and a map of the extension points that cover TanStack Intent's skill validation. `TypescriptHookContext` also gets `frontmatter`, the same value document rules get, so a TypeScript hook can read a page's frontmatter. The agent skills now cover `--rule`, `--fix --dry-run`, and the JSON `schemaVersion`.
