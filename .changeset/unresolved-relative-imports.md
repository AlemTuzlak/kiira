---
"kiira-core": patch
---

Unresolved relative imports no longer hide type errors in the code that uses them. With `relative-imports` off (the default), an import like `import { tools } from './tools'` now resolves to an earlier fence in the same Markdown file that exports those names, or else to an `any` stub, so the rest of the call is still checked.
