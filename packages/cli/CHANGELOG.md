# kiira

## 0.4.0

### Minor Changes

- f42a191: Add out-of-the-box MDX support and a `defaultGroup` config option.

  - `.mdx` files are now checked alongside `.md` out of the box. The default `include` covers both (`**/*.{md,mdx}`), `kiira init` and path shorthands scaffold both, and `.mdx` is parsed MDX-aware so code fences nested inside JSX components (`<Tabs>`, `<Callout>`, …) and files with ESM `import`/`export` are extracted correctly.
  - New `defaultGroup: "none" | "file"` option (default `"none"`). Set `"file"` to implicitly group every checkable fence in a file (concatenated in document order) so later fences see earlier declarations — ideal for literate docs. An explicit `group=` wins, `group=none` detaches a fence, and `defaultGroup` is settable per-glob via `overrides`.

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
