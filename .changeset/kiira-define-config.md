---
"kiira": minor
---

Export `defineConfig` and the config types from `kiira`, and add a `kiira/plugin` entry that re-exports `kiira-core/plugin`. Import from `kiira` and `kiira/plugin` in your config and local plugins. Before, the docs and `kiira init` imported from `kiira-core`. With pnpm, that import fails, because `kiira-core` is only a dependency of `kiira` and is not visible to your code. The CLI binary now lives in `dist/cli.mjs`.
