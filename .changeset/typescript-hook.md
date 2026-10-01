---
"kiira-core": minor
"kiira": minor
---

Add an experimental per-file TypeScript hook for plugins and presets. A `typescript(file, ctx)` hook can return `compilerOptions`, `paths`, `replaceTsconfig`, and a `filterDiagnostic` function for each Markdown file. Files whose resulting options differ are checked in separate programs, and editor quick fixes use the same options. `getCodeFixes` takes an optional `text` for the document.
