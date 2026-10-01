---
"kiira-core": patch
---

perf: workspace discovery and resolution (`discoverWorkspacePackages`, `buildWorkspaceResolution`) are cached per project behind an mtime fingerprint of the workspace manifest, glob roots, and each package's `package.json` and `node_modules`, so a run no longer globs and re-reads every package manifest for `createProject`, `buildBaseOptions`, and each `group` rule probe, and the editor skips it on every re-check. `resetWorkspaceCache()` drops the cache.
