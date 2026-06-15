---
name: getting-started
description: >
  Set up Kiira on a project's docs. Load when installing kiira, running the
  first `kiira check`, scaffolding with `kiira init`, or deciding whether a
  `kiira.config.ts` is needed. Covers installing where the API types resolve,
  the only required option (`include`), the ts/tsx/js/jsx fence format in
  .md/.mdx, and the automatic `tsconfig.docs.json` preference.
type: lifecycle
library: kiira
library_version: "0.4.0"
sources:
  - "AlemTuzlak/kiira:docs/content/01-getting-started.mdx"
  - "AlemTuzlak/kiira:docs/content/03-configuration/01-config-file.mdx"
  - "AlemTuzlak/kiira:packages/core/src/config.ts"
---

# Kiira — Getting Started

Kiira extracts `ts`/`tsx`/`js`/`jsx` code fences from Markdown and MDX, type-checks
them against the project's real API, and reports errors on the source line.

## Setup

Install the CLI as a dev dependency **in the project (or monorepo) whose types the
docs reference** — Kiira runs `tsc` against those types:

```bash
pnpm add -D kiira
```

Run it. `check` is the default command, and no config file is required — `include`
defaults to `["**/*.{md,mdx}"]`:

```bash
pnpm kiira check
```

Exit code `0` means every fence type-checked; `1` means at least one fence has errors.

## Core Patterns

### Scaffold a starter config and docs tsconfig

```bash
pnpm kiira init
```

Creates `kiira.config.ts` and `tsconfig.docs.json`. Kiira automatically prefers
`tsconfig.docs.json` over `tsconfig.json`, so docs can relax/tighten rules without
touching the app's config.

### Write a minimal config (only when defaults aren't enough)

`include` is the only required option; everything else has a sensible default.

```ts
import { defineConfig } from "kiira-core"

export default defineConfig({
  include: ["docs/**/*.{md,mdx}", "README.md"],
})
```

### The fence format

Kiira checks fenced blocks whose language is `ts`, `tsx`, `js`, or `jsx`, in both
`.md` and `.mdx` (fences inside MDX components like `<Tabs>` are extracted too):

````md
```ts
import { defineConfig } from "kiira-core"

const config = defineConfig({ include: ["docs/**/*.md"] })
```
````

## Common Mistakes

### HIGH Installing Kiira where the API types don't resolve

Wrong:

```bash
# in a standalone docs/ package that does NOT depend on the library
pnpm add -D kiira
pnpm kiira check   # every `import { x } from "@my/lib"` fails to resolve
```

Correct:

```bash
# install at the package (or monorepo root) whose types the docs import
pnpm add -D kiira
pnpm kiira check
```

Kiira type-checks against the installed project's types; if it can't see the API package, every bare import "fails".

Source: docs/content/01-getting-started.mdx (InfoAlert: "Install it where your types live")

### MEDIUM Assuming a config file is required

Wrong:

```ts
// agent insists nothing works without a fully-specified config
export default defineConfig({
  include: ["**/*.md"],
  exclude: [],
  tsconfig: "tsconfig.json",
  packageMode: "workspace",
  defaultValidate: "type",
})
```

Correct:

```ts
// nothing is required to start; add config only to narrow or tune
export default defineConfig({ include: ["docs/**/*.{md,mdx}", "README.md"] })
```

`include` defaults to `["**/*.{md,mdx}"]` and every other option has a default, so `kiira check` runs with no config at all.

Source: packages/core/src/config.ts (resolveConfig defaults)

### MEDIUM Letting the default include scan the whole repo

Wrong:

```ts
export default defineConfig({})   // checks every .md/.mdx anywhere in the repo
```

Correct:

```ts
export default defineConfig({
  include: ["docs/**/*.{md,mdx}", "README.md"],
  exclude: ["**/CHANGELOG.md", "**/fixtures/**"],
})
```

`node_modules`, `dist`, and `.kiira` are always ignored, but other vendored/generated Markdown is checked unless excluded.

Source: packages/core/src/config.ts (default include); packages/core/src/discover.ts (ALWAYS_IGNORE)

### MEDIUM Tension: lenient defaults vs strict validation

Kiira ignores unused symbols (TS6133) and unresolved relative imports by default so
illustrative snippets don't fail. Agents that assume "a passing run means everything
is checked" trust it too much; teams wanting strict docs must opt in
(`checkUnusedSymbols`, `checkRelativeImports`). See `authoring-and-debugging-fences/SKILL.md` § Common Mistakes.

## See also

- `authoring-and-debugging-fences/SKILL.md` — the next step: making fences pass (metadata, grouping, fixtures).
- `ci-integration/SKILL.md` — gate CI on the same check.
- `editor-vscode/SKILL.md` — the VS Code extension reads this same `kiira.config.ts`.
