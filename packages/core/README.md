<div align="center">

<picture>
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/AlemTuzlak/kiira/main/assets/cover-light.png" />
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/AlemTuzlak/kiira/main/assets/cover-dark.png" />
  <img alt="Kiira — type-check the code in your Markdown" src="https://raw.githubusercontent.com/AlemTuzlak/kiira/main/assets/cover-dark.png" width="860" />
</picture>

# @alemtuzlak/kiira-core

**The Kiira engine — extract Markdown code fences, type-check them, and map diagnostics back to source.**

[![npm](https://img.shields.io/npm/v/@alemtuzlak/kiira-core?label=@alemtuzlak/kiira-core&logo=npm)](https://www.npmjs.com/package/@alemtuzlak/kiira-core)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/AlemTuzlak/kiira/blob/main/LICENSE)

</div>

---

`@alemtuzlak/kiira-core` is the programmatic engine behind the [`kiira` CLI](https://www.npmjs.com/package/@alemtuzlak/kiira)
and the [Kiira VS Code extension](https://marketplace.visualstudio.com/items?itemName=CodeForge.kiira-vscode).
Install it directly when you want to embed Markdown code-fence type-checking in your own
tooling — a custom CLI, a lint rule, a docs pipeline, or an editor integration.

> Most users want the [`kiira` CLI](https://www.npmjs.com/package/@alemtuzlak/kiira) instead.
> Reach for `kiira-core` only when you're building tooling on top of the engine.

## Install

```bash
pnpm add @alemtuzlak/kiira-core
```

The package is published dual ESM/CJS with full type declarations.

## How it works

Kiira's pipeline is a sequence of pure-ish stages you can use end-to-end or one at a time:

1. **Discover** — `discoverMarkdownFiles` expands your `include`/`exclude` globs into a file list.
2. **Extract** — `extractMarkdownSnippets` / `extractSnippetsFromContent` parse the Markdown AST,
   pull out each ` ```ts/tsx/js/jsx ` fence, and read its info-string metadata
   (`parseFenceMeta`).
3. **Build virtual files** — `createVirtualFiles` / `buildVirtualFile` / `buildGroupedVirtualFile`
   turn each snippet (or each `group=`) into an in-memory `.ts`/`.tsx` file, applying fixtures
   and recording a line map. Nothing touches disk.
4. **Type-check** — `checkMarkdownFiles` / `checkVirtualFiles` run a TypeScript program seeded
   from your `tsconfig` and workspace module resolution, then `mapVirtualLine` maps every
   diagnostic back to the exact line/column inside the Markdown fence.
5. **Suggest & fix** — `detectLanguageTag`, `collectSuggestions`, and `getCodeFixes` power the
   `ts`→`tsx`, `group=`, and `jsxImportSource` auto-fixes.

## Quick start

Define a config with full type-checking and autocomplete:

```ts
import { defineConfig } from "@alemtuzlak/kiira-core"

export default defineConfig({
  include: ["docs/**/*.md", "README.md"],
  tsconfig: "tsconfig.docs.json",
  defaultValidate: "type",
  languages: ["ts", "tsx", "js", "jsx"],
})
```

Check Markdown files programmatically — `checkMarkdownFiles` runs the whole pipeline
(discover → extract → virtualize → type-check) and returns typed diagnostics and stats:

```ts
import { checkMarkdownFiles } from "@alemtuzlak/kiira-core"

const result = await checkMarkdownFiles({
  cwd: process.cwd(),
  config: { include: ["docs/**/*.md", "README.md"] },
})

for (const d of result.diagnostics) {
  // SourcePosition is zero-based; +1 for editor-style line/column.
  const { line, character } = d.markdownRange.start
  console.log(`${d.severity} ${d.markdownFile}:${line + 1}:${character + 1} ${d.message}`)
}

console.log(result.stats) // { markdownFiles, snippets, checked, ignored, errors, warnings }
```

> `config` accepts a `Partial<KiiraConfig>`; omit it to load the nearest `kiira.config.*`.
> Every input/result shape is fully typed — let your editor guide you, or read the exports below.

## Public API

`@alemtuzlak/kiira-core` exports the whole pipeline. Highlights:

| Export | Purpose |
| --- | --- |
| `defineConfig`, `resolveConfig`, `loadConfig`, `loadConfigFile`, `findConfigFile`, `CONFIG_FILENAMES`, `DEFAULT_LANGUAGES` | Define, locate, load, and normalize Kiira config. |
| `discoverMarkdownFiles` | Expand include/exclude globs into a Markdown file list. |
| `extractMarkdownSnippets`, `extractSnippetsFromContent`, `parseFenceMeta` | Extract code fences and parse their metadata. |
| `createVirtualFiles`, `buildVirtualFile`, `buildGroupedVirtualFile`, `mapVirtualLine`, `virtualFileName`, `dedent`, `isCheckable`, `effectiveValidate` | Build in-memory virtual files and map lines back to source. |
| `checkMarkdownFiles`, `checkVirtualFiles`, `buildBaseOptions`, `optionsForFile`, `resolveTsconfigPath`, `setTypescriptLibDir`, `collectSuggestions` | Run the TypeScript program and collect diagnostics/suggestions. |
| `getCodeFixes` | Produce TypeScript + Kiira quick-fix edits for a snippet. |
| `detectLanguageTag` | Detect a mistagged `ts` fence that actually contains JSX. |
| `discoverWorkspacePackages`, `parsePnpmWorkspacePackages`, `buildWorkspaceResolution` | Monorepo-aware package resolution. |
| `KIIRA_CORE_VERSION` | The installed engine version. |

All input/result/option shapes are exported as types (e.g. `KiiraConfig`, `ResolvedKiiraConfig`,
`KiiraLanguage`, `SnippetExtraction`, `BuiltVirtualFile`, `CheckMarkdownFilesInput`,
`CodeFixAction`, `WorkspaceResolution`).

## Configuration reference

See the [`kiira` CLI README](https://www.npmjs.com/package/@alemtuzlak/kiira) for the full
config and fence-metadata reference (`include`, `exclude`, `tsconfig`, `packageMode`,
`defaultValidate`, `checkUnusedSymbols`, `checkRelativeImports`, `overrides`, `fixtures`,
`defaultFixture`, `languages`) — `kiira-core` consumes exactly the same shape via `defineConfig`.

## Documentation

Full, browsable docs (every feature, CI recipes, and the VS Code extension) live in
[`/docs`](https://github.com/AlemTuzlak/kiira/tree/main/docs).

## License

MIT © AlemTuzlak
