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
`package=workspace|packed`.

## Development

This is a pnpm + Nx monorepo.

```bash
pnpm install
pnpm build:all   # build every package
pnpm test        # check + typecheck + unit tests + build
```

## License

MIT © AlemTuzlak
