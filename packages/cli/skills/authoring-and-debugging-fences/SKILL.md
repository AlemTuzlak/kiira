---
name: authoring-and-debugging-fences
description: >
  Write Markdown/MDX code fences that type-check, and debug ones that fail when
  they look correct. Load when authoring doc examples or fixing Kiira errors.
  Covers fence metadata (`ignore`, `validate`, `fixture`, `name`, `group`,
  `package`), grouping multi-fence walkthroughs and `defaultGroup: "file"`,
  fixtures for needed scope, `ts`->`tsx` mistags, unused-symbols and relative
  imports ignored by default, and never silencing a valid error with `ignore`.
type: core
library: kiira
library_version: "0.4.0"
sources:
  - "AlemTuzlak/kiira:docs/content/04-fences/01-fence-metadata.mdx"
  - "AlemTuzlak/kiira:docs/content/04-fences/02-grouping-snippets.mdx"
  - "AlemTuzlak/kiira:docs/content/04-fences/03-language-tag-checking.mdx"
  - "AlemTuzlak/kiira:docs/content/03-configuration/02-options.mdx"
  - "AlemTuzlak/kiira:packages/core/src/virtual.ts"
---

# Kiira — Authoring and Debugging Fences

Each fence is type-checked as its own isolated module by default. Metadata tokens
after the language on the info string change how a fence is treated.

## Setup

Add tokens after the language. Supported tokens: `ignore`, `validate=type|runtime|none`,
`fixture=<name>`, `name=<id>`, `group=<id>` (or `group=none`), `package=workspace|packed`.

````md
```tsx fixture=react validate=type name=basic-chat group=quickstart
import { useChat } from "@my/lib/react"

export function Chat() {
  const chat = useChat()
  return <div>{chat.messages.length}</div>
}
```
````

## Core Patterns

### Group fences that build on each other

A later fence that uses a `const` from an earlier one must share its `group`:

````md
```ts group=quickstart
const client = createClient()
```

```ts group=quickstart
await client.send("hi")   // resolves: same group, document order
```
````

For literate docs where most fences continue the previous one, set
`defaultGroup: "file"` in config to group every fence in a file implicitly;
`group=none` detaches a single fence.

### Provide scope with a fixture

Define named setup once, then apply it with `fixture=`:

```ts
// kiira.config.ts
export default defineConfig({
  fixtures: { react: { type: "wrap", before: "import React from 'react'", after: "" } },
})
```

````md
```tsx fixture=react
export function App() { return <div>hi</div> }
```
````

### Auto-fix mechanical issues

```bash
kiira check --fix   # rewrites ts->tsx mistags, adds group= tags, writes jsx overrides
```

## Common Mistakes

### HIGH Continuation fence fails "cannot find name"

Wrong:

````md
```ts
const client = createClient()
```
```ts
await client.send("hi")   // TS2304: Cannot find name 'client'
```
````

Correct:

````md
```ts group=quickstart
const client = createClient()
```
```ts group=quickstart
await client.send("hi")
```
````

Each fence is an isolated module by default (`defaultGroup: "none"`); only fences sharing a group see each other's declarations.

Source: docs/content/04-fences/02-grouping-snippets.mdx; packages/core/src/virtual.ts

### HIGH JSX written in a `ts` fence

Wrong:

````md
```ts
export function Chat() { return <div>hi</div> }   // JSX in a ts fence
```
````

Correct:

````md
```tsx
export function Chat() { return <div>hi</div> }
```
````

A `ts` fence containing JSX is mistagged; Kiira warns and checks it as `tsx`, but the tag stays wrong until fixed (or `kiira check --fix`).

Source: docs/content/04-fences/03-language-tag-checking.mdx; packages/core/src/detect.ts

### HIGH Confusing `ignore` vs `validate=none` vs `group=none`

Wrong:

````md
```ts group=none
const wip = somethingNotReadyYet()   // still type-checked, still fails
```
````

Correct:

````md
```ts ignore
const wip = somethingNotReadyYet()   // skipped entirely
```
````

`group=none` only detaches a fence from file grouping — it is still checked. Use `ignore` or `validate=none` to skip checking.

Source: docs/content/04-fences/01-fence-metadata.mdx, 02-grouping-snippets.mdx; packages/core/src/virtual.ts (isCheckable)

### CRITICAL Silencing a valid error instead of fixing it

Wrong:

````md
```ts ignore
import { renamedAway } from "@my/lib"   // error was real — now hidden, ships broken
```
````

Correct:

````md
```ts
import { currentName } from "@my/lib"   // fix the example to match the real API
```
````

`ignore`/`validate=none`/`group=none` are for intentionally-incomplete or pseudo-code snippets — not for muting a real diagnostic. Suppressing a valid error ships a broken copy-pasteable example, which is exactly what Kiira exists to prevent.

Source: maintainer interview

### MEDIUM Expecting unused imports/locals to error

Wrong:

````md
```ts
import { foo } from "@my/lib"   // never used — agent assumes this fails; it passes
```
````

Correct:

```ts
// opt in only if you want it enforced
export default defineConfig({ checkUnusedSymbols: true })
```

TS6133 (declared but never read) is suppressed by default because doc snippets routinely import for illustration.

Source: docs/content/03-configuration/02-options.mdx; packages/core/src/check.ts

### MEDIUM Expecting broken relative imports to fail

Wrong:

````md
```ts
import { helper } from "./does-not-exist"   // NOT flagged by default
import { real } from "@my/lib"              // always checked
```
````

Correct:

```ts
export default defineConfig({ checkRelativeImports: true })   // enforce relative imports too
```

Unresolved relative imports (`./x`, `../x`) are ignored by default since snippets often reference imaginary sibling files; bare package imports are always checked.

Source: docs/content/03-configuration/02-options.mdx; packages/core/src/check.ts

### MEDIUM Using `validate=runtime`

Wrong:

````md
```ts validate=runtime
await main()   // implies execution — nothing is executed
```
````

Correct:

````md
```ts
await main()   // default validate=type type-checks it
```
````

`validate=runtime` currently behaves identically to `validate=type` (type-checked, never executed). Do not emit it.

Source: packages/core/src/virtual.ts (effectiveValidate); maintainer interview

### MEDIUM Tension: auto-fix convenience vs masking real errors

`kiira check --fix` rewrites tags and adds `group=` tags. Running it to make CI green
can paper over an example that is genuinely wrong (a real API mismatch). Treat `--fix`
as mechanical cleanup, not error resolution. See `ci-integration/SKILL.md` § Common Mistakes.

## See also

- `monorepo-and-frameworks/SKILL.md` — `package=` and framework JSX depend on project resolution.
- `editor-vscode/SKILL.md` — the editor's quick fixes are the interactive form of `ts`->`tsx` / `group=`.
- `getting-started/SKILL.md` — `checkUnusedSymbols` / `checkRelativeImports` are off by default for ergonomic reasons.
