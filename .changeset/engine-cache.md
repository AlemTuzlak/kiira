---
"kiira-core": minor
---

perf: the classic engine now caches parsed lib and `node_modules` declaration files across checks (validated by mtime) and reuses the previous program, so a repeat check — the editor re-check, the `group` rule's probes, the `--fix` recheck — skips re-parsing TypeScript's libs. Hosts can call `resetClassicEngineCache()` to drop the cache.
