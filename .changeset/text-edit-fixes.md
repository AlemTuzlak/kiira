---
"kiira-core": minor
"kiira": minor
"kiira-vscode": patch
---

Rules can return an `edits` fix that changes any file the check read. `kiira check --fix` now refuses stale, unread, overlapping, non-UTF-8, read-only, or unsafe edits, writes files atomically, and keeps CRLF line endings. A fix is all or nothing: if one of its files is refused, no file gets its edits. `KiiraCheckResult` and `checkMarkdownText` have a new `sources` field with the text the run read. Add `--dry-run` to `--fix` to print a diff without writing. The VS Code extension offers `edits` fixes as quick fixes, but only while every file they edit still has the text the check read.
