---
"kiira-core": patch
---

perf: workspace discovery and resolution (`discoverWorkspacePackages`, `buildWorkspaceResolution`) are cached per project behind an mtime fingerprint of the workspace manifest, every directory the workspace globs walk, and each package's directory, `package.json`, `src`, and `node_modules`, so a run no longer globs and re-reads every package manifest for `createProject`, `buildBaseOptions`, and each `group` rule probe, and the editor skips it on every re-check. `discoverWorkspacePackages` returns a fresh copy, the cached `buildWorkspaceResolution` result is frozen, and `KiiraProject.workspacePackages` is now typed readonly. `resetWorkspaceCache()` drops the cache.
