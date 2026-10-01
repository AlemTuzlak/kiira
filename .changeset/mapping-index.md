---
"kiira-core": patch
---

perf: diagnostics map virtual lines to Markdown by index instead of a scan, the native engine converts offsets with precomputed line starts and a binary search, and the `group` rule counts a snippet's lines once instead of splitting its code for every diagnostic.
