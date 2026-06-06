# @kiira-example/monorepo

Demonstrates validating Markdown docs spread across multiple package folders
from a single Kiira config using glob includes
(`packages/*/README.md`, `packages/*/docs/**/*.md`).

```bash
pnpm check:docs   # runs `kiira check`
```

See [`kiira.config.ts`](kiira.config.ts) and the docs under
[`packages/`](packages).
