<div align="center">

<picture>
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/AlemTuzlak/kiira/main/assets/cover-light.png" />
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/AlemTuzlak/kiira/main/assets/cover-dark.png" />
  <img alt="Kiira — type-check the code in your Markdown" src="https://raw.githubusercontent.com/AlemTuzlak/kiira/main/assets/cover-dark.png" width="860" />
</picture>

# Kiira

**Type-check the code in your Markdown.**

Kiira extracts TypeScript and JavaScript code fences from your Markdown and MDX docs,
type-checks them against your real project API, and reports any errors right back on the
source line — in your editor, on the command line, and in CI.

<p align="center">
  <a href="https://www.npmjs.com/package/kiira"><img alt="npm version" src="https://shieldcn.dev/npm/kiira.svg?split=true&labelColor=0d0e12&color=7bac42&size=xs" /></a>
  <a href="https://www.npmjs.com/package/kiira"><img alt="npm downloads" src="https://shieldcn.dev/npm/dw/kiira.svg?split=true&labelColor=0d0e12&color=7bac42&size=xs" /></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=CodeForge.kiira-vscode"><img alt="VS Code installs" src="https://shieldcn.dev/vscode/installs/CodeForge/kiira-vscode.svg?split=true&labelColor=0d0e12&color=7bac42&size=xs" /></a>
  <a href="https://github.com/AlemTuzlak/kiira/stargazers"><img alt="GitHub stars" src="https://shieldcn.dev/github/stars/AlemTuzlak/kiira.svg?split=true&labelColor=0d0e12&color=7bac42&size=xs" /></a>
  <a href="https://github.com/AlemTuzlak/kiira/actions"><img alt="CI status" src="https://shieldcn.dev/github/ci/AlemTuzlak/kiira.svg?split=true&labelColor=0d0e12&color=7bac42&size=xs" /></a>
  <a href="https://github.com/AlemTuzlak/kiira/blob/main/LICENSE"><img alt="License: MIT" src="https://shieldcn.dev/github/license/AlemTuzlak/kiira.svg?split=true&labelColor=0d0e12&color=7bac42&size=xs" /></a>
  <a href="https://github.com/AlemTuzlak/kiira/commits/main"><img alt="Last commit" src="https://shieldcn.dev/github/last-commit/AlemTuzlak/kiira.svg?split=true&labelColor=0d0e12&color=7bac42&size=xs" /></a>
</p>

</div>

---

## Documentation

📚 **Full documentation lives in [`/docs`](docs)** — a browsable site covering every CLI
feature, configuration, CI recipes, and the VS Code extension. Run it locally with
`pnpm install && pnpm run dev` from inside `docs/`, or deploy it (Docker / Fly.io configs are
included).

## Why

Docs are increasingly written and updated by agents, and agents hallucinate APIs. Kiira
catches the things that make a copy-pasted example fail:

- invalid imports and missing exports
- wrong package subpaths
- wrong function, option, or prop names
- invalid TypeScript / JavaScript (with `checkJs`)
- non-copy-pasteable examples — unless explicitly marked partial or ignored

## Packages

| Package                                     | Description                                            |
| ------------------------------------------- | ------------------------------------------------------ |
| [`kiira-core`](packages/core)           | Extraction, virtual files, type-checking, diagnostics. |
| [`kiira`](packages/cli)             | `kiira check` for local and CI validation.          |
| [`kiira-vscode`](packages/vscode)        | Live squiggles inside Markdown code fences.            |
| [`AlemTuzlak/kiira@v1`](action.yml)       | GitHub composite action for CI.                        |

## Quick start

```bash
pnpm add -D kiira
```

Create a `tsconfig.docs.json` and (optionally) a `kiira.config.ts`, then run:

```bash
kiira check
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
`package=workspace|packed`, `group=<id>` (use `group=none` to detach a fence).

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

Kiira also **detects** ungrouped continuations automatically — if grouping a document's
snippets would resolve "cannot find name" errors, it warns and `kiira check --fix` adds the
`group=` tags for you.

For **literate docs** where most fences build on earlier ones, set `defaultGroup: "file"` in
your config to implicitly group every fence in a file (in document order) without tagging any
of them. An explicit `group=` still wins, and `group=none` detaches a fence. `defaultGroup` is
also settable per-glob via `overrides`.

## Monorepos

In `packageMode: "workspace"` (the default) Kiira discovers your pnpm/npm/yarn workspace,
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
files (Kiira runs a separate TypeScript program per distinct option set). Kiira also
**detects** the framework from the file path: if a file's JSX fails for lack of the right
runtime types (TS7026), it suggests a `jsxImportSource` override and `kiira check --fix`
writes it into a JSON config for you.

## Language-tag checking

Kiira warns when a `ts` fence actually contains JSX (it should be `tsx`), checks it as `tsx`
anyway so you get real type errors instead of a syntax-error cascade, and can rewrite the tag
for you:

```bash
kiira check --fix    # rewrites mistagged fences (ts/typescript -> tsx)
```

## CLI

```bash
kiira check                     # validate everything in your include globs
kiira check --entry docs        # check a directory (repeatable)
kiira check --entry docs --ignore docs/api   # ...excluding a subdirectory
kiira check "docs/**/*.md"      # validate specific files/globs
kiira check --reporter json     # machine-readable output
kiira check --reporter github   # GitHub Actions annotations
kiira check --fix               # rewrite mistagged code fences (ts -> tsx)
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

Exit codes: `0` clean, `1` validation errors, `2` config/runtime failure.

### Configuration

`kiira.config.ts` (or `.js`/`.json`); all fields are optional except `include`:

```ts
import { defineConfig } from "kiira-core"

export default defineConfig({
  include: ["docs/**/*.{md,mdx}", "README.md"],
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
| `group=none` | Detach a fence from its group (e.g. under `defaultGroup: "file"`). |
| `package=workspace\|packed` | Override the package resolution mode for this fence. |

Unused locals/parameters/imports (TS6133) are **ignored by default** — doc snippets
routinely declare things they don't use. Set `checkUnusedSymbols: true` in your config to
enforce them.

Unresolved **relative** imports (`./x`, `../x`) are also **ignored by default** — snippets
often "import" from an imaginary sibling file standing in for an earlier snippet or the
reader's project. Bare package imports (`@scope/pkg`, `react`) are always checked. Set
`checkRelativeImports: true` to enforce relative imports too.

## Editor (VS Code)

Install **Kiira** from the
[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=CodeForge.kiira-vscode)
(or `ext install CodeForge.kiira-vscode`). It also publishes to
[Open VSX](https://open-vsx.org/extension/CodeForge/kiira-vscode).

It type-checks your Markdown code fences against your real project, live:

- **Live diagnostics** — type errors appear as you type (debounced) and on save,
  mapped to the exact line inside the fence.
- **Quick fixes** (`Ctrl+.` / `Cmd+.`):
  - TypeScript's own fixes inside fences — **auto-import a missing symbol**, fix a
    misspelled name, add a missing `await`, implement an interface, …
  - Kiira's fixes — change a mistagged `` ```ts `` fence to `` ```tsx `` for JSX,
    or tag continuation snippets with `group=…`.
- **Inspect** the generated virtual file for any snippet.

### Commands

| Command | Description |
| --- | --- |
| `Kiira: Check Current File` | Re-check the active Markdown document. |
| `Kiira: Check Workspace` | Check every Markdown file in the workspace. |
| `Kiira: Open Virtual File For Snippet` | Inspect the generated code for a fence. |
| `Kiira: Restart Kiira Server` | Clear and re-check all open documents. |

### Settings

| Setting | Default | Description |
| --- | --- | --- |
| `kiira.enable` | `true` | Enable Kiira diagnostics in Markdown files. |
| `kiira.configPath` | `kiira.config.ts` | Path to the Kiira config, relative to the workspace root. |
| `kiira.debounceMs` | `300` | Delay before re-checking after a change. |
| `kiira.checkOnChange` | `true` | Re-check as the document changes (debounced). |
| `kiira.checkOnSave` | `true` | Re-check when the document is saved. |
| `kiira.showGeneratedDiagnostics` | `false` | Show diagnostics from generated fixture code (debugging). |

## CI

Use the [composite action](action.yml):

```yaml
- uses: AlemTuzlak/kiira@v1
  with:
    command: pnpm kiira check
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
