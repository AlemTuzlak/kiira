---
"kiira-core": minor
"kiira": minor
---

Add an experimental `check()` to `kiira-core` that checks Markdown and runs every rule from code, with extra `plugins` passed inline. The JSON reporter output gained a first `schemaVersion` key, set to `1`, and its fields are now documented. With the `github` reporter, `kiira check` appends a summary to `$GITHUB_STEP_SUMMARY` when it is set.
