---
"kiira-core": patch
---

perf: `project.isTracked` lists the tracked files once per run with a single `git ls-files` and answers from a set, instead of spawning git for every path a rule asks about.
