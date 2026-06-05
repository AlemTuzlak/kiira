# @typedown-example/monorepo

Demonstrates validating Markdown docs spread across multiple package folders
from a single Typedown config using glob includes
(`packages/*/README.md`, `packages/*/docs/**/*.md`).

```bash
pnpm check:docs   # runs `typedown check`
```

See [`typedown.config.ts`](typedown.config.ts) and the docs under
[`packages/`](packages).
