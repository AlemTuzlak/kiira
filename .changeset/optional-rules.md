---
"kiira-core": minor
"kiira": minor
---

Add three optional built-in rules, all off by default: `broken-link` (relative links, images, and definitions that point at missing files, with an `anchors` option for headings), `max-lines` (requires a `max` option), and `deprecated-import` (imports of `@deprecated` symbols). A new `recommended` preset turns on `broken-link` and `deprecated-import`. A rule that needs options now fails config resolution when you enable it without them.
