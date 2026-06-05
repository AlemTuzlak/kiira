# Typedown for VS Code

**Live type-checking for TypeScript & JavaScript code fences inside Markdown.**

Typedown extracts the ` ```ts ` / ` ```tsx ` / ` ```js ` / ` ```jsx ` code blocks from
your Markdown and type-checks them against your **real project** — the same
`tsconfig`, the same workspace packages, the same dependency types. Broken example
code in your docs gets a red squiggle the moment you write it, mapped back to the
exact line inside the fence.

> Powered by [`typedown`](https://github.com/AlemTuzlak/typedown). For CI and
> command-line use, see the [`typedown` CLI](https://github.com/AlemTuzlak/typedown).

## Features

- **Live diagnostics in Markdown** — type errors in fenced code appear as you type
  (debounced) and on save, with messages mapped to the correct line and column.
- **TypeScript quick fixes inside fences** — the lightbulb (`Ctrl+.` / `Cmd+.`)
  offers TypeScript's own fixes: **auto-import a missing symbol**, fix a misspelled
  name, add a missing `await`, implement an interface, and more — with the edit
  applied back into the Markdown.
- **Typedown quick fixes** — one-click to change a mistagged ` ```ts ` fence to
  ` ```tsx ` when it contains JSX, or to tag continuation snippets with `group=…`
  so they type-check together.
- **Workspace-aware** — resolves your monorepo's packages and their types, so
  `import { x } from "@your/pkg"` checks just like it does in your editor.
- **Inspect the generated file** — *Typedown: Open Virtual File For Snippet* shows
  the synthesized `.ts`/`.tsx` a fence is checked as, including grouped snippets.

## Commands

| Command | Description |
| --- | --- |
| `Typedown: Check Current File` | Re-check the active Markdown document. |
| `Typedown: Check Workspace` | Check every Markdown file in the workspace. |
| `Typedown: Open Virtual File For Snippet` | Inspect the generated code for a fence. |
| `Typedown: Restart Typedown Server` | Clear and re-check all open documents. |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `typedown.enable` | `true` | Enable Typedown diagnostics in Markdown files. |
| `typedown.configPath` | `typedown.config.ts` | Path to the Typedown config, relative to the workspace root. |
| `typedown.debounceMs` | `300` | Delay before re-checking after a change. |
| `typedown.checkOnChange` | `true` | Re-check as the document changes (debounced). |
| `typedown.checkOnSave` | `true` | Re-check when the document is saved. |
| `typedown.showGeneratedDiagnostics` | `false` | Show diagnostics from generated fixture code (for debugging). |

## How it works

Each code fence becomes an in-memory "virtual file" that is type-checked with your
project's compiler options and module resolution — nothing is written to disk.
Diagnostics are mapped from the virtual file back to the Markdown source. Snippets
that continue an earlier one can be tagged `group=<name>` to share scope, and
Typedown will suggest grouping when it detects a continuation.

See the [project README](https://github.com/AlemTuzlak/typedown#readme) for
configuration, the CLI, and the GitHub Action.

## License

MIT
