---
"kiira-core": minor
---

perf: the classic engine now caches parsed lib and `node_modules` declaration files across checks, so a repeat check — the editor re-check, the `group` rule's probes, the `--fix` recheck — skips re-parsing TypeScript's libs. Each cached file is checked against its current text on disk, files parsed under different compiler settings are kept apart, and the cache holds at most 5000 files. Hosts can call `resetClassicEngineCache()` to drop the cache.
