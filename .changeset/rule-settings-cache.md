---
"kiira-core": patch
---

perf: override `include` globs are compiled once per override, per-file rule settings are memoized per resolved config, and each override's `compilerOptions` is converted once, instead of on every lookup for every file.
