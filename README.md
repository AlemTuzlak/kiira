<div align="center">

# Typedown

**Type-check the code in your Markdown.**

Typedown extracts TypeScript and JavaScript code fences from your Markdown docs, type-checks
them against your real project API, and reports any errors right back on the Markdown line —
in your editor, on the command line, and in CI.

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
| [`@typedown/core`](packages/core)           | Extraction, virtual files, type-checking, diagnostics. |
| [`@typedown/cli`](packages/cli)             | `typedown check` for local and CI validation.          |
| [`typedown-vscode`](packages/vscode)        | Live squiggles inside Markdown code fences.            |
| [`typedown-action`](packages/github-action) | GitHub composite action for CI.                        |

## Quick start

```bash
pnpm add -D @typedown/cli
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
typedown check "docs/**/*.md"      # validate specific files/globs
typedown check --reporter json     # machine-readable output
typedown check --reporter github   # GitHub Actions annotations
typedown check --fix               # rewrite mistagged code fences (ts -> tsx)
typedown check --verbose           # full messages + code frames (default is compact)
typedown init                      # scaffold typedown.config.ts + tsconfig.docs.json
```

Exit codes: `0` clean, `1` validation errors, `2` config/runtime failure.

## Editor

The [`typedown-vscode`](packages/vscode) extension shows squiggles inside Markdown code
fences as you type, with commands to check the current file or the whole workspace and to
open the generated virtual file for any snippet.

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
