---
"kiira-core": patch
"kiira": patch
---

Fix `externalPackages` install failing on pnpm (and Windows). The isolated cache install now runs with `--ignore-scripts`, so pnpm no longer exits non-zero on `ERR_PNPM_IGNORED_BUILDS` (its build-script security gate) when the install actually succeeded — which previously made Kiira discard a good install, fall back to npm, and report a misleading npm error. Kiira only reads types/source to type-check, so dependency build scripts are never needed; skipping them is also safer (no arbitrary postinstall from doc-only deps) and faster. When an install does fail, the warning now includes every attempt's output instead of only the last.
