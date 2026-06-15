---
name: ci-integration
description: >
  Gate CI on Markdown doc errors and keep examples current. Load when wiring
  `kiira check` into CI, choosing a reporter, or interpreting exit codes.
  Covers exit codes (0 clean, 1 doc errors, 2 config/runtime failure), the
  `github`/`json`/`pretty` reporters, the `AlemTuzlak/kiira@v1` composite
  action, plain exit-code-gated steps for any runner, `--entry` overriding
  `include`, and `--static`/`--raw` for clean log capture.
type: lifecycle
library: kiira
library_version: "0.4.0"
sources:
  - "AlemTuzlak/kiira:docs/content/02-cli/05-exit-codes.mdx"
  - "AlemTuzlak/kiira:docs/content/02-cli/03-reporters.mdx"
  - "AlemTuzlak/kiira:docs/content/06-ci/01-github-action.mdx"
  - "AlemTuzlak/kiira:packages/cli/src/index.ts"
---

# Kiira — CI Integration

`kiira check` is gated by its exit code: `0` clean, `1` validation errors (docs have
type errors), `2` config/runtime failure (broken config, unresolved tsconfig).

## Setup

GitHub Actions — use the composite action (its reporter defaults to `github`, so
failures appear as inline PR annotations):

```yaml
- uses: AlemTuzlak/kiira@v1
  with:
    command: pnpm kiira check
    reporter: github
```

## Core Patterns

### Gate any CI runner by exit code

GitLab, CircleCI, Jenkins — it's the same check; the runner fails on non-zero:

```yaml
# example step
- run: pnpm kiira check --reporter github
```

### Distinguish setup failures from doc failures

```bash
pnpm kiira check; status=$?
if [ "$status" -eq 2 ]; then echo "::error::Kiira config/setup problem"; fi
if [ "$status" -eq 1 ]; then echo "::error::docs have type errors"; fi
```

### Capture machine-readable or clean output

```bash
pnpm kiira check --reporter json > kiira-report.json   # 1-based positions, fixable count
pnpm kiira check --static --raw > kiira-report.txt      # no spinner, no ANSI color
```

## Common Mistakes

### HIGH Not distinguishing exit code 2 from 1

Wrong:

```bash
kiira check || echo "docs have errors"   # also fires on a broken config (exit 2)
```

Correct:

```bash
kiira check; status=$?
[ "$status" -eq 2 ] && echo "config/setup problem"
[ "$status" -eq 1 ] && echo "docs have type errors"
```

Exit `2` is a setup problem, not a docs problem; conflating them misreports a broken config as "docs broken".

Source: docs/content/02-cli/05-exit-codes.mdx; packages/cli/src/index.ts

### MEDIUM Using the pretty reporter for CI annotations

Wrong:

```yaml
- run: pnpm kiira check --reporter pretty   # no inline PR annotations; compact by default
```

Correct:

```yaml
- run: pnpm kiira check --reporter github
# or use the composite action (reporter defaults to github)
```

Inline annotations come from the `github` reporter; `pretty` is compact human output (needs `--verbose` for full messages) and emits no workflow commands.

Source: docs/content/02-cli/03-reporters.mdx; docs/content/06-ci/01-github-action.mdx

### MEDIUM Assuming `--entry` appends to `include`

Wrong:

```bash
# config include is ["docs/**"]; expecting both docs and README to be checked
kiira check --entry README.md   # checks ONLY README.md
```

Correct:

```bash
kiira check --entry docs --entry README.md   # both, explicitly (repeatable)
```

`--entry` (and positional paths) override the `include` globs rather than adding to them.

Source: docs/content/02-cli/02-flags.mdx; packages/cli/src/entries.ts

### LOW Spinner/color noise in captured logs

Wrong:

```bash
pnpm kiira check > report.txt   # spinner frames + escape codes end up in the file
```

Correct:

```bash
pnpm kiira check --static --raw > report.txt
# or: pnpm kiira check --reporter json > report.json
```

The animated spinner and ANSI colors render fine in a TTY but pollute redirected logs.

Source: docs/content/02-cli/02-flags.mdx; packages/cli/src/spinner.ts

### MEDIUM Tension: auto-fix to green vs masking real errors

Running `kiira check --fix` in CI to make the job pass can hide a genuinely wrong
example. Keep `--fix` out of the gating step; run it locally, commit the result, and
let CI verify. See `authoring-and-debugging-fences/SKILL.md` § Common Mistakes.

## See also

- `getting-started/SKILL.md` — the check you gate is the same one you ran locally.
- `monorepo-and-frameworks/SKILL.md` — `packageMode` and `overrides` decide what CI validates.
- `editor-vscode/SKILL.md` — the editor and CI share `kiira.config.ts`.
