---
"kiira-core": minor
"kiira": minor
---

Add `externalPackages` config option

Declare packages your docs import but your project doesn't depend on — a competitor library in a comparison, or a third-party tool in an integration example. Kiira installs them into a hidden, isolated cache (`node_modules/.kiira`) purely so those fences type-check, without touching your real `package.json`/`node_modules`.

```ts
export default defineConfig({
  externalPackages: { langchain: "^0.3.0", zod: "^3" },
})
```

The install runs on `kiira check` with your project's package manager (detected from the lockfile, falling back to npm), and re-installs only when the list changes. Declarations on `overrides[].externalPackages` are merged into the same install and resolve globally.
