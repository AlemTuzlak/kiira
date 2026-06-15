---
name: monorepo-and-frameworks
description: >
  Make Kiira resolve the real API in monorepos and multi-framework docs. Load
  when docs import internal `@scope/*` workspace packages, when fences use
  Solid/Preact/Vue JSX, or when seeing TS7026 / unresolved workspace imports.
  Covers `packageMode` workspace vs packed, why hand-written tsconfig `paths`
  are unnecessary, per-glob `overrides` (last match wins), and `jsxImportSource`
  plus `kiira check --fix` writing the override.
type: core
library: kiira
library_version: "0.4.0"
sources:
  - "AlemTuzlak/kiira:docs/content/05-projects/01-monorepos.mdx"
  - "AlemTuzlak/kiira:docs/content/05-projects/02-per-glob-overrides.mdx"
  - "AlemTuzlak/kiira:packages/core/src/workspace.ts"
  - "AlemTuzlak/kiira:packages/core/src/check.ts"
---

# Kiira — Monorepos and Frameworks

In the default `packageMode: "workspace"`, Kiira discovers the workspace, maps every
package name to its source (from each `package.json` `exports`), and adds each
package's `node_modules` as a resolution fallback.

## Setup

No special config is needed in a monorepo — docs importing internal `@scope/*`
packages and third-party libs resolve out of the box:

```ts
import { defineConfig } from "kiira-core"

export default defineConfig({
  include: ["docs/**/*.{md,mdx}"],
  // packageMode: "workspace" is the default
})
```

Workspace discovery reads `pnpm-workspace.yaml` (pnpm) or the `workspaces` field in
the root `package.json` (npm/yarn).

## Core Patterns

### Set the JSX runtime per framework

When one docs set spans frameworks, give each its compiler options via `overrides`:

```ts
export default defineConfig({
  include: ["docs/**/*.{md,mdx}"],
  overrides: [
    { include: ["**/*solid*"], jsxImportSource: "solid-js" },
    { include: ["**/*preact*"], jsxImportSource: "preact" },
  ],
})
```

Each override's non-`include` fields merge onto the base options for matching files;
the **last matching override wins**.

### Let Kiira detect and write the override

A JSX fence failing for lack of the right runtime types (TS7026) makes Kiira suggest a
`jsxImportSource`. `kiira check --fix` writes that override into a JSON config:

```bash
kiira check --fix   # writes the detected jsxImportSource override, then re-checks
```

### Validate against the published shape

`package=packed` checks a fence against the installed/published form instead of source:

````md
```ts package=packed
import { stable } from "@my/published-pkg"
```
````

## Common Mistakes

### MEDIUM Hand-writing tsconfig paths for a monorepo

Wrong:

```json
// tsconfig.docs.json — unnecessary and easily wrong
{ "compilerOptions": { "paths": { "@my/lib": ["../lib/src/index.ts"] } } }
```

Correct:

```ts
// workspace mode (default) already maps packages from package.json exports
export default defineConfig({ include: ["docs/**/*.mdx"] })
```

Kiira derives `paths` from real `package.json` `exports` and prefers source over `dist`; hand-written paths drift.

Source: docs/content/05-projects/01-monorepos.mdx; packages/core/src/workspace.ts

### HIGH Non-React JSX checked against React types

Wrong:

```ts
// Solid docs with no override — JSX typed against the wrong runtime
export default defineConfig({ include: ["docs/**/*.mdx"] })
```

Correct:

```ts
export default defineConfig({
  include: ["docs/**/*.mdx"],
  overrides: [{ include: ["**/*solid*"], jsxImportSource: "solid-js" }],
})
```

`jsxImportSource` defaults to the React runtime; Solid/Preact/Vue fences need an override (or run `kiira check --fix`).

Source: docs/content/05-projects/02-per-glob-overrides.mdx; packages/core/src/check.ts (TS7026 detection)

### MEDIUM Override include glob doesn't match file paths

Wrong:

```ts
// files live at docs/frameworks/solid/*.mdx
overrides: [{ include: ["docs/solid/**"], jsxImportSource: "solid-js" }]   // never matches
```

Correct:

```ts
overrides: [{ include: ["docs/frameworks/solid/**"], jsxImportSource: "solid-js" }]
```

Override globs match against actual file paths; a glob that doesn't match silently applies no override.

Source: docs/content/05-projects/02-per-glob-overrides.mdx

### MEDIUM `package=packed` on an unpublished local package

Wrong:

````md
```ts package=packed
import { thing } from "@my/unpublished-pkg"   // not resolvable in packed mode
```
````

Correct:

````md
```ts
import { thing } from "@my/unpublished-pkg"   // default workspace mode resolves to source
```
````

Packed mode resolves against the installed/published form; a workspace package that isn't published (or built) won't resolve.

Source: docs/content/05-projects/01-monorepos.mdx; packages/core/src/check.ts

### MEDIUM Tension: workspace-source vs packed reality

Workspace mode checks docs against package **source**, which can pass even when the
**published** type surface differs from what users install. Before release, consider
checking critical examples with `package=packed` so docs match what consumers get.
See `ci-integration/SKILL.md` § Common Mistakes.

## See also

- `ci-integration/SKILL.md` — `packageMode` and `overrides` decide what CI actually validates.
- `authoring-and-debugging-fences/SKILL.md` — the `package=` token and framework fixtures.
