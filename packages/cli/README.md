<div align="center">

<picture>
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/AlemTuzlak/kiira/main/assets/cover-light.png" />
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/AlemTuzlak/kiira/main/assets/cover-dark.png" />
  <img alt="Kiira — type-check the code in your Markdown" src="https://raw.githubusercontent.com/AlemTuzlak/kiira/main/assets/cover-dark.png" width="860" />
</picture>

# kiira

**The Kiira command line — type-check the code in your Markdown.**

[![npm](https://img.shields.io/npm/v/kiira?label=kiira&logo=npm)](https://www.npmjs.com/package/kiira)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/AlemTuzlak/kiira/blob/main/LICENSE)

</div>

---

`kiira` installs the `kiira` binary. It extracts the TypeScript and JavaScript
code fences from your Markdown, type-checks them against your **real project API** — the same
`tsconfig`, the same workspace packages, the same dependency types — and reports any errors
back on the exact Markdown line, locally and in CI.

> Looking for live squiggles while you write? Install the **Kiira** VS Code extension
> ([Marketplace](https://marketplace.visualstudio.com/items?itemName=CodeForge.kiira-vscode)).
> Full documentation lives in [`/docs`](https://github.com/AlemTuzlak/kiira/tree/main/docs).

## Why

Docs are increasingly written and updated by agents, and agents hallucinate APIs. Kiira
catches the things that make a copy-pasted example fail:

- invalid imports and missing exports
- wrong package subpaths
- wrong function, option, or prop names
- invalid TypeScript / JavaScript (with `checkJs`)
- non-copy-pasteable examples — unless explicitly marked partial or ignored

## Install

```bash
pnpm add -D kiira      # npm i -D / yarn add -D / bun add -d
```

The package ships the `kiira` bin, so `pnpm kiira …` (or `npx kiira …`) just works.

## Quick start

Scaffold a config and a docs `tsconfig`, then run a check:

```bash
kiira init      # writes kiira.config.ts + tsconfig.docs.json (skips existing files)
kiira check     # validate everything in your include globs
```

### How it works

For every Markdown file Kiira:

1. **Extracts** each ` ```ts ` / ` ```tsx ` / ` ```js ` / ` ```jsx ` fence and parses its
   info string for metadata (`validate=`, `fixture=`, `group=`, …).
2. **Builds an in-memory virtual file** per snippet (nothing is written to disk), applying
   any fixtures and, for `group=` snippets, concatenating them in document order so a later
   fence can use a `const` declared in an earlier one.
3. **Type-checks** the virtual files with a TypeScript program seeded from your `tsconfig` and
   your workspace's module resolution.
4. **Maps diagnostics** from the virtual file back to the precise line and column inside the
   Markdown fence and prints them with your chosen reporter.

## Fence format

````md
```ts
import { createAgent } from "@tanstack/ai"
```
````

Add metadata after the language to control validation:

````md
```tsx fixture=react validate=type name=basic-chat
import { useChat } from "@tanstack/ai/react"

export function Chat() {
  const chat = useChat()
  return <div>{chat.messages.length}</div>
}
```
````

| Token | Description |
| --- | --- |
| `ignore` | Skip this fence entirely. |
| `validate=type\|runtime\|none` | Override the validation mode for this fence. |
| `fixture=<name>` | Wrap/prepend the snippet with a named fixture from config. |
| `name=<id>` | A stable label for the snippet (shown in tooling). |
| `group=<id>` | Type-check fences sharing an id together, in document order. |
| `group=none` | Detach a fence from its group (e.g. under `defaultGroup: "file"`). |
| `package=workspace\|packed` | Override the package-resolution mode for this fence. |

Unused locals/parameters/imports (TS6133) are **ignored by default** — doc snippets routinely
declare things they don't use (`checkUnusedSymbols: true` to enforce). Unresolved **relative**
imports (`./x`, `../x`) are also **ignored by default** — snippets often "import" from an
imaginary sibling file (`checkRelativeImports: true` to enforce). Bare package imports
(`@scope/pkg`, `react`) are always checked.

## Commands

```bash
kiira check                     # validate everything in your include globs
kiira check --entry docs        # check a directory (repeatable)
kiira check --entry docs --ignore docs/api   # ...excluding a subdirectory
kiira check "docs/**/*.md"      # validate specific files/globs
kiira check --reporter json     # machine-readable output
kiira check --reporter github   # GitHub Actions annotations
kiira check --fix               # rewrite mistagged fences, add group= tags, write overrides
kiira check --verbose           # full messages + code frames (default is compact)
kiira init                      # scaffold kiira.config.ts + tsconfig.docs.json
```

### Flags

| Flag | Description |
| --- | --- |
| `--entry <path>` | Directory, file, or glob to check. Repeatable. Overrides `include`. |
| `--ignore <path>` | Directory, file, or glob to exclude. Repeatable (e.g. `--ignore docs/api`). |
| `--config <path>` | Path to a Kiira config file. |
| `--reporter <name>` | Output format: `pretty` (default), `json`, or `github` (Actions annotations). |
| `--fix` | Apply auto-fixes: rewrite mistagged fences (`ts`→`tsx`), add `group=` tags, write framework `jsxImportSource` overrides. |
| `--verbose` | Full error messages and code frames (default output is compact). |
| `--raw` | Plain text — disable colored output. |
| `--static` | Disable the loading spinner. |
| `-h, --help` | Show help. |
| `-v, --version` | Show the version. |

**Exit codes:** `0` clean · `1` validation errors · `2` config/runtime failure. The non-zero
codes are what make Kiira a CI gate.

### Reporters

- **`pretty`** (default) — human output, compact by default; add `--verbose` for full TypeScript
  messages and code frames.
- **`json`** — a machine-readable report you can post-process.
- **`github`** — `::error`/`::warning` workflow commands that surface as inline annotations on
  the Markdown file in a GitHub Actions run.

## Configuration

`kiira.config.ts` (or `.mts`/`.mjs`/`.js`/`.cjs`/`.json`); all fields are optional except
`include`:

```ts
import { defineConfig } from "kiira-core"

export default defineConfig({
  include: ["docs/**/*.md", "README.md"],
  exclude: ["**/node_modules/**"],
  tsconfig: "tsconfig.docs.json",    // defaults to tsconfig.docs.json, then tsconfig.json
  packageMode: "workspace",           // "workspace" (default) | "packed"
  defaultValidate: "type",            // "type" (default) | "runtime" | "none"
  checkUnusedSymbols: false,           // report TS6133 unused locals/params/imports
  checkRelativeImports: false,         // report unresolved ./ and ../ imports
  overrides: [
    { include: ["**/*solid*"], jsxImportSource: "solid-js" },
  ],
  fixtures: {
    react: { type: "prepend", content: 'import * as React from "react"' },
  },
  defaultFixture: undefined,
  languages: ["ts", "tsx", "js", "jsx"],
})
```

| Option | Default | Description |
| --- | --- | --- |
| `include` | — | Markdown/MDX globs to check (required). `.md` and `.mdx` are both checked. |
| `exclude` | `[]` | Globs to skip. |
| `tsconfig` | auto | tsconfig to source compiler options from. |
| `packageMode` | `workspace` | Resolve monorepo packages (`workspace`) or rely on installed packages (`packed`). |
| `defaultValidate` | `type` | Default validation mode for fences without a `validate=` tag. |
| `defaultGroup` | `none` | `file` implicitly groups every fence in a file (literate docs). |
| `checkUnusedSymbols` | `false` | Report unused locals/params/imports (TS6133). |
| `checkRelativeImports` | `false` | Report unresolved relative imports. |
| `overrides` | `[]` | Per-glob `compilerOptions` (e.g. `jsxImportSource`). |
| `fixtures` | `{}` | Named code to prepend/wrap around snippets. |
| `defaultFixture` | — | Fixture applied to fences without a `fixture=` tag. |
| `languages` | all | Fence languages to check. |

## Grouping snippets

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

Kiira also **detects** ungrouped continuations automatically — if grouping a document's
snippets would resolve "cannot find name" errors, it warns and `kiira check --fix` adds the
`group=` tags for you.

For **literate docs**, set `defaultGroup: "file"` to implicitly group every fence in a file
(in document order) without tagging any of them. An explicit `group=` still wins, and
`group=none` detaches a fence. Also settable per-glob via `overrides`.

## Monorepos

In `packageMode: "workspace"` (the default) Kiira discovers your pnpm/npm/yarn workspace,
maps every package name to its source, and adds each package's `node_modules` as a resolution
fallback. So docs that import `@your-scope/*` **and** third-party libs resolve out of the box —
no hand-written `tsconfig` `paths` required.

## Per-glob overrides & language detection

When a docs set spans multiple frameworks, a single `jsx`/`jsxImportSource` can't serve all of
them. Use `overrides` to set compiler options for matching files (Kiira runs a separate
TypeScript program per distinct option set). Kiira also **detects** the framework from the file
path: if a file's JSX fails for lack of the right runtime types (TS7026), it suggests a
`jsxImportSource` override and `kiira check --fix` writes it for you.

Likewise, Kiira warns when a ` ```ts ` fence actually contains JSX (it should be ` ```tsx `),
checks it as `tsx` anyway so you get real type errors instead of a syntax-error cascade, and
`kiira check --fix` rewrites the tag.

## CI

Use the [composite action](https://github.com/AlemTuzlak/kiira/blob/main/action.yml):

```yaml
- uses: AlemTuzlak/kiira@v1
  with:
    command: pnpm kiira check
    reporter: github
```

…or run it directly in any CI runner and let the exit code gate the job:

```bash
kiira check --reporter github
```

## Documentation

Full, browsable docs (every CLI feature, CI recipes, and the VS Code extension) live in
[`/docs`](https://github.com/AlemTuzlak/kiira/tree/main/docs).

## License

MIT © AlemTuzlak
