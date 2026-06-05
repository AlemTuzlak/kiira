<div align="center">

# Typedown

**Type-check the code in your Markdown.**

Typedown extracts TypeScript and JavaScript code fences from your Markdown docs, type-checks
them against your real project API, and reports any errors right back on the Markdown line —
in your editor, on the command line, and in CI.

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/CodeForge.typedown-vscode?label=VS%20Code%20Marketplace&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=CodeForge.typedown-vscode)
[![npm](https://img.shields.io/npm/v/@alemtuzlak/typedown-cli?label=@alemtuzlak/typedown-cli&logo=npm)](https://www.npmjs.com/package/@alemtuzlak/typedown-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

</div>

---

## Why

Docs are increasingly written and updated by agents, and agents hallucinate APIs. Typedown
catches the things that make a copy-pasted example fail:

- invalid imports and missing exports
- wrong package subpaths
- wrong function, option, or prop names
- invalid TypeScript / JavaScript (with `checkJs`)
- non-copy-pasteable examples — unless explicitly marked partial or ignored

## Packages

| Package                                     | Description                                            |
| ------------------------------------------- | ------------------------------------------------------ |
| [`@alemtuzlak/typedown`](packages/core)           | Extraction, virtual files, type-checking, diagnostics. |
| [`@alemtuzlak/typedown-cli`](packages/cli)             | `typedown check` for local and CI validation.          |
| [`typedown-vscode`](packages/vscode)        | Live squiggles inside Markdown code fences.            |
| [`typedown-action`](packages/github-action) | GitHub composite action for CI.                        |

## Quick start

```bash
pnpm add -D @alemtuzlak/typedown-cli
```

Create a `tsconfig.docs.json` and (optionally) a `typedown.config.ts`, then run:

```bash
typedown check
```

### Fence format

````md
```ts
import { createAgent } from "@tanstack/ai"
```
````

Add metadata to control validation:

````md
```tsx fixture=react validate=type name=basic-chat
import { useChat } from "@tanstack/ai/react"

export function Chat() {
  const chat = useChat()
  return <div>{chat.messages.length}</div>
}
```
````

Supported metadata: `ignore`, `validate=type|runtime|none`, `fixture=<name>`, `name=<id>`,
`package=workspace|packed`, `group=<id>`.

### Grouping snippets

By default each fence is checked as an isolated module. When a walkthrough is split across
several fences (a later fence uses a `const` declared in an earlier one), tag them with the
same `group`:

````md
```ts group=quickstart
const client = createClient()
```

```ts group=quickstart
await client.send("hi")   // resolves: same group as the snippet above
```
````

Typedown also **detects** ungrouped continuations automatically — if grouping a document's
snippets would resolve "cannot find name" errors, it warns and `typedown check --fix` adds the
`group=` tags for you.

## Monorepos

In `packageMode: "workspace"` (the default) Typedown discovers your pnpm/npm/yarn workspace,
maps every package name to its source, and adds each package's `node_modules` as a resolution
fallback. So in a monorepo, docs that import `@your-scope/*` **and** third-party libs resolve
out of the box — no hand-written `tsconfig` `paths` required.

## Per-glob overrides

When a docs set spans multiple frameworks, a single `jsx`/`jsxImportSource` can't serve all of
them. Use `overrides` to set compiler options for matching files:

```ts
export default defineConfig({
  include: ["docs/**/*.md"],
  overrides: [
    { include: ["**/*solid*"], jsxImportSource: "solid-js" },
    { include: ["**/*preact*"], jsxImportSource: "preact" },
  ],
})
```

Each override's non-`include` fields are merged onto the base compiler options for matching
files (Typedown runs a separate TypeScript program per distinct option set). Typedown also
**detects** the framework from the file path: if a file's JSX fails for lack of the right
runtime types (TS7026), it suggests a `jsxImportSource` override and `typedown check --fix`
writes it into a JSON config for you.

## Language-tag checking

Typedown warns when a `ts` fence actually contains JSX (it should be `tsx`), checks it as `tsx`
anyway so you get real type errors instead of a syntax-error cascade, and can rewrite the tag
for you:

```bash
typedown check --fix    # rewrites mistagged fences (ts/typescript -> tsx)
```

## CLI

```bash
typedown check                     # validate everything in your include globs
typedown check --entry docs        # check a directory (repeatable)
typedown check --entry docs --ignore docs/api   # ...excluding a subdirectory
typedown check "docs/**/*.md"      # validate specific files/globs
typedown check --reporter json     # machine-readable output
typedown check --reporter github   # GitHub Actions annotations
typedown check --fix               # rewrite mistagged code fences (ts -> tsx)
typedown check --verbose           # full messages + code frames (default is compact)
typedown init                      # scaffold typedown.config.ts + tsconfig.docs.json
```

### Flags

| Flag | Description |
| --- | --- |
| `--entry <path>` | Directory, file, or glob to check. Repeatable. Overrides `include`. |
| `--ignore <path>` | Directory, file, or glob to exclude. Repeatable (e.g. `--ignore docs/api`). |
| `--config <path>` | Path to a Typedown config file. |
| `--reporter <name>` | Output format: `pretty` (default), `json`, or `github` (Actions annotations). |
| `--fix` | Apply auto-fixes: rewrite mistagged fences (`ts`→`tsx`), add `group=` tags, write framework `jsxImportSource` overrides. |
| `--verbose` | Full error messages and code frames (default output is compact). |
| `--raw` | Plain text — disable colored output. |
| `--static` | Disable the loading spinner. |
| `-h, --help` | Show help. |
| `-v, --version` | Show the version. |

Exit codes: `0` clean, `1` validation errors, `2` config/runtime failure.

### Configuration

`typedown.config.ts` (or `.js`/`.json`); all fields are optional except `include`:

```ts
import { defineConfig } from "@alemtuzlak/typedown"

export default defineConfig({
  include: ["docs/**/*.md", "README.md"],
  exclude: ["**/node_modules/**"],
  tsconfig: "tsconfig.docs.json",   // defaults to tsconfig.docs.json, then tsconfig.json
  packageMode: "workspace",          // "workspace" (default) | "packed"
  defaultValidate: "type",           // "type" (default) | "runtime" | "none"
  checkUnusedSymbols: false,          // report TS6133 unused locals/params/imports
  checkRelativeImports: false,        // report unresolved ./ and ../ imports
  overrides: [
    { include: ["**/*solid*"], jsxImportSource: "solid-js" },
  ],
  fixtures: {
    react: { type: "wrap", before: "import React from 'react'", after: "" },
  },
  defaultFixture: undefined,
  languages: ["ts", "tsx", "js", "jsx"],
})
```

| Option | Default | Description |
| --- | --- | --- |
| `include` | — | Markdown globs to check (required). |
| `exclude` | `[]` | Globs to skip. |
| `tsconfig` | auto | tsconfig to source compiler options from. |
| `packageMode` | `workspace` | Resolve monorepo packages (`workspace`) or rely on installed packages (`packed`). |
| `defaultValidate` | `type` | Default validation mode for fences without a `validate=` tag. |
| `checkUnusedSymbols` | `false` | Report unused locals/params/imports (TS6133). |
| `checkRelativeImports` | `false` | Report unresolved relative imports. |
| `overrides` | `[]` | Per-glob `compilerOptions` (e.g. `jsxImportSource`). |
| `fixtures` | `{}` | Named code to prepend/wrap around snippets. |
| `defaultFixture` | — | Fixture applied to fences without a `fixture=` tag. |
| `languages` | all | Fence languages to check. |

### Fence metadata

Add tokens after the language on the fence info string:

````md
```tsx fixture=react validate=type name=basic-chat group=quickstart
````

| Token | Description |
| --- | --- |
| `ignore` | Skip this fence entirely. |
| `validate=type\|runtime\|none` | Override the validation mode for this fence. |
| `fixture=<name>` | Wrap the snippet with a named fixture from config. |
| `name=<id>` | A stable label for the snippet (shown in tooling). |
| `group=<id>` | Type-check fences sharing an id together, in document order. |
| `package=workspace\|packed` | Override the package resolution mode for this fence. |

Unused locals/parameters/imports (TS6133) are **ignored by default** — doc snippets
routinely declare things they don't use. Set `checkUnusedSymbols: true` in your config to
enforce them.

Unresolved **relative** imports (`./x`, `../x`) are also **ignored by default** — snippets
often "import" from an imaginary sibling file standing in for an earlier snippet or the
reader's project. Bare package imports (`@scope/pkg`, `react`) are always checked. Set
`checkRelativeImports: true` to enforce relative imports too.

## Editor (VS Code)

Install **Typedown** from the
[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=CodeForge.typedown-vscode)
(or `ext install CodeForge.typedown-vscode`). It also publishes to
[Open VSX](https://open-vsx.org/extension/CodeForge/typedown-vscode).

It type-checks your Markdown code fences against your real project, live:

- **Live diagnostics** — type errors appear as you type (debounced) and on save,
  mapped to the exact line inside the fence.
- **Quick fixes** (`Ctrl+.` / `Cmd+.`):
  - TypeScript's own fixes inside fences — **auto-import a missing symbol**, fix a
    misspelled name, add a missing `await`, implement an interface, …
  - Typedown's fixes — change a mistagged `` ```ts `` fence to `` ```tsx `` for JSX,
    or tag continuation snippets with `group=…`.
- **Inspect** the generated virtual file for any snippet.

### Commands

| Command | Description |
| --- | --- |
| `Typedown: Check Current File` | Re-check the active Markdown document. |
| `Typedown: Check Workspace` | Check every Markdown file in the workspace. |
| `Typedown: Open Virtual File For Snippet` | Inspect the generated code for a fence. |
| `Typedown: Restart Typedown Server` | Clear and re-check all open documents. |

### Settings

| Setting | Default | Description |
| --- | --- | --- |
| `typedown.enable` | `true` | Enable Typedown diagnostics in Markdown files. |
| `typedown.configPath` | `typedown.config.ts` | Path to the Typedown config, relative to the workspace root. |
| `typedown.debounceMs` | `300` | Delay before re-checking after a change. |
| `typedown.checkOnChange` | `true` | Re-check as the document changes (debounced). |
| `typedown.checkOnSave` | `true` | Re-check when the document is saved. |
| `typedown.showGeneratedDiagnostics` | `false` | Show diagnostics from generated fixture code (debugging). |

## CI

Use the [composite action](packages/github-action):

```yaml
- uses: AlemTuzlak/typedown/packages/github-action@v1
  with:
    command: pnpm typedown check
    reporter: github
```

## Examples

| Example                                | Shows                                              |
| -------------------------------------- | -------------------------------------------------- |
| [`examples/basic`](examples/basic)     | Plain TypeScript snippets against the `node` types. |
| [`examples/react`](examples/react)     | `tsx` snippets with `react` and wrap fixtures.      |
| [`examples/monorepo`](examples/monorepo) | One config validating docs across many packages.  |

## Development

This is a pnpm + Nx monorepo.

```bash
pnpm install
pnpm build:all   # build every package
pnpm test        # check + typecheck + unit tests + build
```

## License

MIT © AlemTuzlak
