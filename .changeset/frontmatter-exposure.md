---
"kiira-core": minor
"kiira": minor
---

Document rules now get `ctx.frontmatter`, the raw text and range of a leading `---` block. Kiira does not parse YAML. The block is no longer part of `ctx.mdast`, and line numbers after it are unchanged.
