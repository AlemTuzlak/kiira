# kiira-core

## 0.7.0

### Minor Changes

- f643d18: Add `setFallbackTypescriptModule(ts)`. A host such as the VS Code extension uses it to give kiira-core a TypeScript for projects that have no usable TypeScript of their own. The project's own TypeScript still wins. The fallback is tried before the TypeScript that kiira-core resolves itself, and only when its version is 5.4+ or 6.
- af009bd: `typescript` and `jiti` are now optional peer dependencies of `kiira-core`, and sourcemaps are no longer published. The `kiira` CLI installs both itself, so CLI users change nothing to install. If you call `kiira-core` programmatically, install `typescript` 5.4+ or 6, and `jiti` to load a `.ts` config.

  The CLI now uses your project's TypeScript when it is 5.4+ or 6, instead of always using its own copy. If your project has no TypeScript, or has an older version or TypeScript 7, the CLI uses its own copy.

  **Breaking for direct `kiira-core` API users:** the MDX parser now loads on demand. If you call `extractSnippetsFromContent` directly on `.mdx` files, `await loadMdxSupport()` first.

- 675747f: perf: the classic engine now caches parsed lib and `node_modules` declaration files across checks, so a repeat check — the editor re-check, the `group` rule's probes, the `--fix` recheck — skips re-parsing TypeScript's libs. Each cached file is checked against its current text on disk, files parsed under different compiler settings are kept apart, and the cache holds at most 5000 files. Hosts can call `resetClassicEngineCache()` to drop the cache.
- bdc272a: Document rules now get `ctx.frontmatter`, the raw text and range of a leading `---` block. Kiira does not parse YAML. The block is no longer part of `ctx.mdast`, and line numbers after it are unchanged.
- fd8108a: Reuse TypeScript 7 API sessions across repeated checks and expose lifecycle cleanup for long-lived hosts.
- 4338645: Add three optional built-in rules, all off by default: `broken-link` (relative links, images, and definitions that point at missing files, with an `anchors` option for headings), `max-lines` (requires a `max` option), and `deprecated-import` (imports of `@deprecated` symbols). A new `recommended` preset turns on `broken-link` and `deprecated-import`. A rule that needs options now fails config resolution when you enable it without them.
- 08f4470: Add opt-in owner-scoped workspace dependency resolution while keeping exhaustive lookup as the default.
- c0d39ab: Add an experimental `check()` to `kiira-core` that checks Markdown and runs every rule from code, with extra `plugins` passed inline. The JSON reporter output gained a first `schemaVersion` key, set to `1`, and its fields are now documented. With the `github` reporter, `kiira check` appends a summary to `$GITHUB_STEP_SUMMARY` when it is set.
- 4060329: Add an experimental rule and plugin API. Kiira's own diagnostics now run as built-in rules, and the new `rules`, `presets`, and `plugins` options (and `overrides[].rules`, `overrides[].presets`, `overrides[].codeFenceLanguages`) set rule levels and add your own rules with `defineRule` and `definePlugin` from `kiira-core/plugin`. `kiira check --rule <id>=<off|warn|error>` sets a level for one run. Rule diagnostics use the rule id as their `code`, so fence metadata warnings and parse errors now have the codes `fence-meta` and `parse-error`. `checkMarkdownText` checks one in-memory document, and the VS Code extension uses it so rule diagnostics show in the editor. A rule that throws does not stop the check: Kiira reports it as an `error` diagnostic with the rule id as its `code`, and the other rules still run. A report's `severity` can lower the configured level, but not raise it. `collectSuggestions` also returns the `language-tag` warnings, because `createVirtualFiles` no longer reports them.
- 21e4e23: Rules can return an `edits` fix that changes any file the check read. `kiira check --fix` now refuses stale, unread, overlapping, non-UTF-8, read-only, or unsafe edits, writes files atomically, and keeps CRLF line endings. A fix is all or nothing: if one of its files is refused, no file gets its edits. `KiiraCheckResult` and `checkMarkdownText` have a new `sources` field with the text the run read. Add `--dry-run` to `--fix` to print a diff without writing. The VS Code extension offers `edits` fixes as quick fixes, but only while every file they edit still has the text the check read.
- 331cb86: Add an experimental per-file TypeScript hook for plugins and presets. A `typescript(file, ctx)` hook can return `compilerOptions`, `paths`, `replaceTsconfig`, and a `filterDiagnostic` function for each Markdown file. Files whose resulting options differ are checked in separate programs, and editor quick fixes use the same options. `getCodeFixes` takes an optional `text` for the document.

### Patch Changes

- 7f48374: Reuse classic TypeScript module resolutions across checks and invalidate cached results when their resolution inputs change. `resetClassicEngineCache()` now also drops the cached resolutions.
- 8bec1b1: Bundle acorn once instead of twice, shrinking the published `kiira-core` bundle by about 180 kB per format (ESM and CJS).
- 4979d3d: perf: `project.isTracked` lists the tracked files once per run with a single `git ls-files` and answers from a set, instead of spawning git for every path a rule asks about.
- 963bcc9: perf: diagnostics map virtual lines to Markdown by index instead of a scan, the native engine converts offsets with precomputed line starts and a binary search, and the `group` rule counts a snippet's lines once instead of splitting its code for every diagnostic.
- 87d2704: perf: a document's code nodes are collected once per parsed tree and each fence's info string is parsed once, shared by extraction and the `fence-meta` rule.
- d97de59: Document the rule and plugin API: a new Plugins section with a page on what is experimental, a reference for rules and presets, and a guide to writing a plugin, plus an `examples/plugin-basic` project. `TypescriptHookContext` gets a new `frontmatter` field, the same value document rules get, so a TypeScript hook can read a page's frontmatter. It is `undefined` when the document has none or when only the checked fences are known. The agent skills now cover `--rule`, `--fix --dry-run`, and the JSON `schemaVersion`.
- e3bdf5a: perf: override `include` globs are compiled once per override, per-file rule settings are memoized per resolved config, and each override's `compilerOptions` is converted once, instead of on every lookup for every file.
- 5e4fad7: perf: workspace discovery and resolution (`discoverWorkspacePackages`, `buildWorkspaceResolution`) are cached per project behind an mtime fingerprint of the workspace manifest, every directory the workspace globs walk, and each package's directory, `package.json`, `src`, and `node_modules`, so a run no longer globs and re-reads every package manifest for `createProject`, `buildBaseOptions`, and each `group` rule probe, and the editor skips it on every re-check. `discoverWorkspacePackages` returns a fresh copy, the cached `buildWorkspaceResolution` result is frozen, and `KiiraProject.workspacePackages` is now typed readonly. `resetWorkspaceCache()` drops the cache.

## 0.6.0

### Minor Changes

- e3f8b4c: Add TypeScript 7 support via a new `engine` config option (`"auto" | "classic" | "native"`, default `"auto"`).

  When your project has `typescript@>=7` installed, `"auto"` type-checks doc snippets with TypeScript 7's native (Go) compiler through its `unstable/sync` API; otherwise it uses Kiira's bundled TypeScript. Diagnostics are identical across engines. Editor code-fixes continue to use the bundled TypeScript (the native compiler has no code-fix API yet).

### Patch Changes

- e3f8b4c: Fix `externalPackages` install failing on pnpm (and Windows). The isolated cache install now runs with `--ignore-scripts`, so pnpm no longer exits non-zero on `ERR_PNPM_IGNORED_BUILDS` (its build-script security gate) when the install actually succeeded — which previously made Kiira discard a good install, fall back to npm, and report a misleading npm error. Kiira only reads types/source to type-check, so dependency build scripts are never needed; skipping them is also safer (no arbitrary postinstall from doc-only deps) and faster. When an install does fail, the warning now includes every attempt's output instead of only the last.

## 0.5.0

### Minor Changes

- 4f7f678: Add `externalPackages` config option

  Declare packages your docs import but your project doesn't depend on — a competitor library in a comparison, or a third-party tool in an integration example. Kiira installs them into a hidden, isolated cache (`node_modules/.kiira`) purely so those fences type-check, without touching your real `package.json`/`node_modules`.

  ```ts
  export default defineConfig({
    externalPackages: { langchain: "^0.3.0", zod: "^3" },
  });
  ```

  The install runs on `kiira check` with your project's package manager (detected from the lockfile, falling back to npm), and re-installs only when the list changes. Declarations on `overrides[].externalPackages` are merged into the same install and resolve globally.

## 0.4.0

### Minor Changes

- f42a191: Add out-of-the-box MDX support and a `defaultGroup` config option.

  - `.mdx` files are now checked alongside `.md` out of the box. The default `include` covers both (`**/*.{md,mdx}`), `kiira init` and path shorthands scaffold both, and `.mdx` is parsed MDX-aware so code fences nested inside JSX components (`<Tabs>`, `<Callout>`, …) and files with ESM `import`/`export` are extracted correctly.
  - New `defaultGroup: "none" | "file"` option (default `"none"`). Set `"file"` to implicitly group every checkable fence in a file (concatenated in document order) so later fences see earlier declarations — ideal for literate docs. An explicit `group=` wins, `group=none` detaches a fence, and `defaultGroup` is settable per-glob via `overrides`.

## 0.3.0

### Minor Changes

- a285163: Documentation: new animated landing page (hero, a "watch Kiira catch a bug" demo
  showing wrong code → Kiira → highlighted errors, and a "core → Kiira → CLI / VS
  Code / GitHub Action" usage flow) with a header logo + Docs / VS Code / GitHub
  links. No public API changes.

## 0.2.0

### Minor Changes

- b6de37a: Type-check TypeScript & JavaScript code fences in Markdown against your real
  project. Includes monorepo-aware module resolution, snippet grouping (`group=`),
  per-glob compiler-option overrides, language-tag detection, and a VS Code
  extension with live diagnostics and quick fixes (TypeScript auto-import, spelling,
  etc.) plus the `kiira` CLI and GitHub Action.
