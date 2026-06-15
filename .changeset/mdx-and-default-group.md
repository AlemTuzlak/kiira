---
"kiira-core": minor
"kiira": minor
---

Add out-of-the-box MDX support and a `defaultGroup` config option.

- `.mdx` files are now checked alongside `.md` out of the box. The default `include` covers both (`**/*.{md,mdx}`), `kiira init` and path shorthands scaffold both, and `.mdx` is parsed MDX-aware so code fences nested inside JSX components (`<Tabs>`, `<Callout>`, …) and files with ESM `import`/`export` are extracted correctly.
- New `defaultGroup: "none" | "file"` option (default `"none"`). Set `"file"` to implicitly group every checkable fence in a file (concatenated in document order) so later fences see earlier declarations — ideal for literate docs. An explicit `group=` wins, `group=none` detaches a fence, and `defaultGroup` is settable per-glob via `overrides`.
