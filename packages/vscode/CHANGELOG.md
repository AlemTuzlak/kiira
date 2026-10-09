# kiira-vscode

## 0.4.0

### Minor Changes

- f643d18: The extension no longer bundles TypeScript (about 10 MB of the install). It checks each workspace folder with the folder's own TypeScript 5.4+ or 6 when installed, so diagnostics match the project, and otherwise with the TypeScript VS Code ships for its built-in TypeScript features. An error is shown if neither is available. When TypeScript is installed or updated in the workspace, the extension asks you to reload the window.

### Patch Changes

- af009bd: `typescript` and `jiti` are now optional peer dependencies of `kiira-core`, and sourcemaps are no longer published. The `kiira` CLI installs both itself, so CLI users change nothing to install. If you call `kiira-core` programmatically, install `typescript` 5.4+ or 6, and `jiti` to load a `.ts` config.

  The CLI now uses your project's TypeScript when it is 5.4+ or 6, instead of always using its own copy. If your project has no TypeScript, or has an older version or TypeScript 7, the CLI uses its own copy.

  **Breaking for direct `kiira-core` API users:** the MDX parser now loads on demand. If you call `extractSnippetsFromContent` directly on `.mdx` files, `await loadMdxSupport()` first.

- 4060329: Add an experimental rule and plugin API. Kiira's own diagnostics now run as built-in rules, and the new `rules`, `presets`, and `plugins` options (and `overrides[].rules`, `overrides[].presets`, `overrides[].codeFenceLanguages`) set rule levels and add your own rules with `defineRule` and `definePlugin` from `kiira-core/plugin`. `kiira check --rule <id>=<off|warn|error>` sets a level for one run. Rule diagnostics use the rule id as their `code`, so fence metadata warnings and parse errors now have the codes `fence-meta` and `parse-error`. `checkMarkdownText` checks one in-memory document, and the VS Code extension uses it so rule diagnostics show in the editor. A rule that throws does not stop the check: Kiira reports it as an `error` diagnostic with the rule id as its `code`, and the other rules still run. A report's `severity` can lower the configured level, but not raise it. `collectSuggestions` also returns the `language-tag` warnings, because `createVirtualFiles` no longer reports them.
- 21e4e23: Rules can return an `edits` fix that changes any file the check read. `kiira check --fix` now refuses stale, unread, overlapping, non-UTF-8, read-only, or unsafe edits, writes files atomically, and keeps CRLF line endings. A fix is all or nothing: if one of its files is refused, no file gets its edits. `KiiraCheckResult` and `checkMarkdownText` have a new `sources` field with the text the run read. Add `--dry-run` to `--fix` to print a diff without writing. The VS Code extension offers `edits` fixes as quick fixes, but only while every file they edit still has the text the check read.
- b3bdcd1: Shrink the extension icon from 1254×1254 (711 kB) to 256×256 (38 kB), cutting about 670 kB from the `.vsix` download.
- b760b25: Minify the extension bundle: its JavaScript drops from 1.17 MB to 672 kB and the `.vsix` from 963 kB to 886 kB. Function and class names are kept, so stack traces in bug reports stay readable.
- Updated dependencies [7f48374]
- Updated dependencies [8bec1b1]
- Updated dependencies [f643d18]
- Updated dependencies [af009bd]
- Updated dependencies [675747f]
- Updated dependencies [bdc272a]
- Updated dependencies [4979d3d]
- Updated dependencies [963bcc9]
- Updated dependencies [87d2704]
- Updated dependencies [fd8108a]
- Updated dependencies [4338645]
- Updated dependencies [08f4470]
- Updated dependencies [d97de59]
- Updated dependencies [c0d39ab]
- Updated dependencies [4060329]
- Updated dependencies [e3bdf5a]
- Updated dependencies [21e4e23]
- Updated dependencies [331cb86]
- Updated dependencies [5e4fad7]
  - kiira-core@0.7.0

## 0.3.3

### Patch Changes

- Updated dependencies [e3f8b4c]
- Updated dependencies [e3f8b4c]
  - kiira-core@0.6.0

## 0.3.2

### Patch Changes

- Updated dependencies [4f7f678]
  - kiira-core@0.5.0

## 0.3.1

### Patch Changes

- Updated dependencies [f42a191]
  - kiira-core@0.4.0

## 0.3.0

### Minor Changes

- a285163: Documentation: new animated landing page (hero, a "watch Kiira catch a bug" demo
  showing wrong code → Kiira → highlighted errors, and a "core → Kiira → CLI / VS
  Code / GitHub Action" usage flow) with a header logo + Docs / VS Code / GitHub
  links. No public API changes.

### Patch Changes

- e29cec8: Use the light Kiira logo as the VS Code Marketplace icon.
- Updated dependencies [a285163]
  - kiira-core@0.3.0

## 0.2.0

### Minor Changes

- b6de37a: Type-check TypeScript & JavaScript code fences in Markdown against your real
  project. Includes monorepo-aware module resolution, snippet grouping (`group=`),
  per-glob compiler-option overrides, language-tag detection, and a VS Code
  extension with live diagnostics and quick fixes (TypeScript auto-import, spelling,
  etc.) plus the `kiira` CLI and GitHub Action.

### Patch Changes

- Updated dependencies [b6de37a]
  - kiira-core@0.2.0
