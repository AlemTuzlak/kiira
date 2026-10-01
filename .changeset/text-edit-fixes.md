---
"kiira-core": minor
"kiira": minor
"kiira-vscode": patch
---

Rules can return an `edits` fix that changes any file the check read. `kiira check --fix` now refuses stale, unread, overlapping, or unsafe edits, writes files atomically, and keeps CRLF line endings. `KiiraCheckResult` has a new `sources` field with the text the run read. Add `--dry-run` to `--fix` to print a diff without writing. The VS Code extension offers `edits` fixes as quick fixes.
