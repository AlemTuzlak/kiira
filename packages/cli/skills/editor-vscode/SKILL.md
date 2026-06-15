---
name: editor-vscode
description: >
  Use Kiira's live type-checking in VS Code. Load when setting up the editor
  experience, configuring extension settings, or debugging why diagnostics
  don't update. Covers on-change/on-save diagnostics mapped to the fence line,
  the four commands (Check Current File, Check Workspace, Open Virtual File For
  Snippet, Restart Kiira Server), settings (enable, configPath, debounceMs,
  checkOnChange, checkOnSave, showGeneratedDiagnostics), quick fixes, and that
  the extension reads the same kiira.config.ts as the CLI.
type: lifecycle
library: kiira
library_version: "0.4.0"
sources:
  - "AlemTuzlak/kiira:docs/content/07-vscode/01-overview.mdx"
  - "AlemTuzlak/kiira:packages/vscode/src/extension.ts"
  - "AlemTuzlak/kiira:packages/vscode/src/diagnostics.ts"
---

# Kiira — Editor (VS Code)

The Kiira extension (`CodeForge.kiira-vscode`) type-checks Markdown code fences as you
type and on save, mapping squiggles to the exact line inside the fence. It reads the
same `kiira.config.ts` as the CLI, so the editor and CI check the same way.

## Setup

Install **Kiira** from the VS Code Marketplace (or `ext install CodeForge.kiira-vscode`);
it also publishes to Open VSX. With a `kiira.config.ts` present, it activates on
Markdown files automatically. Settings (defaults shown):

```jsonc
{
  "kiira.enable": true,
  "kiira.configPath": "kiira.config.ts",   // relative to workspace root
  "kiira.debounceMs": 300,
  "kiira.checkOnChange": true,
  "kiira.checkOnSave": true,
  "kiira.showGeneratedDiagnostics": false
}
```

## Core Patterns

### Commands (Command Palette)

- `Kiira: Check Current File` — re-check the active Markdown document.
- `Kiira: Check Workspace` — check every Markdown file in the workspace.
- `Kiira: Open Virtual File For Snippet` — inspect the generated TS file a fence compiles to.
- `Kiira: Restart Kiira Server` — clear caches and re-check all open documents.

### Quick fixes (Ctrl+. / Cmd+.)

Because Kiira checks with the real compiler, TypeScript's own fixes work inside fences
(auto-import a missing symbol, fix a name, add `await`, implement an interface). Kiira
adds its own: rewrite a mistagged `ts` fence to `tsx`, or tag continuation snippets
with `group=`.

### Debug a confusing error

Run `Kiira: Open Virtual File For Snippet` to see exactly what the compiler sees, with
fixtures and grouping applied.

## Common Mistakes

### MEDIUM Editing config without restarting the server

Wrong:

```jsonc
// edit kiira.config.ts and expect diagnostics to update immediately — they don't
```

Correct:

```text
Command Palette -> "Kiira: Restart Kiira Server" after changing kiira.config.ts
```

The extension caches the resolved config; changes don't take effect until the server restarts.

Source: docs/content/07-vscode/01-overview.mdx; packages/vscode/src/extension.ts

### MEDIUM Pointing `kiira.configPath` at the wrong file

Wrong:

```jsonc
{ "kiira.configPath": "config/kiira.ts" }   // actual file is ./kiira.config.ts
```

Correct:

```jsonc
{ "kiira.configPath": "kiira.config.ts" }   // default; matches the real path
```

`configPath` is resolved relative to the workspace root; a wrong path means the extension behaves as if unconfigured.

Source: docs/content/07-vscode/01-overview.mdx; packages/vscode/src/extension.ts

### LOW Enabling `showGeneratedDiagnostics` for clarity

Wrong:

```jsonc
{ "kiira.showGeneratedDiagnostics": true }   // adds confusing generated-code errors
```

Correct:

```jsonc
// leave it false (default); use "Kiira: Open Virtual File For Snippet" to debug
```

Diagnostics map to the fence line by default; this setting also surfaces errors from generated fixture/wrapper code, which is noisier, not clearer.

Source: docs/content/07-vscode/01-overview.mdx; packages/vscode/src/diagnostics.ts (selectDiagnostics)

## See also

- `getting-started/SKILL.md` — the extension reads the `kiira.config.ts` produced during setup.
- `authoring-and-debugging-fences/SKILL.md` — the quick fixes are the interactive form of `ts`->`tsx` / `group=`.
- `ci-integration/SKILL.md` — editor and CI share one config, so they check the same way.
