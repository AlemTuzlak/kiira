# Kiira — Skill Spec

Kiira extracts TypeScript/JavaScript code fences from Markdown and MDX, type-checks
them against the real project API, and maps each diagnostic back to its source line.
It runs as a CLI (`kiira check`), a VS Code extension (live squiggles), and a GitHub
composite action (CI). The monorepo ships three packages: `kiira-core` (engine,
effectively internal), `kiira` (CLI), and `kiira-vscode` (editor extension, private).
All agent skills are generated into the `kiira` CLI package, since that is what
consumers install.

## Domains

| Domain                  | Description                                                                                       | Skills                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Onboarding a project    | Install where types resolve, run the first check, understand the defaults-first config model.     | getting-started                                       |
| Authoring examples      | Write fences that type-check; use metadata, grouping, fixtures, validation; debug failing fences. | authoring-and-debugging-fences                        |
| Wiring Kiira to project | Resolve internal/published packages and multi-framework JSX via per-glob overrides.               | monorepo-and-frameworks                               |
| Running and integrating | CLI, reporters, exit codes, CI gating, editor experience.                                         | ci-integration, editor-vscode                         |

## Skill Inventory

| Skill                          | Type      | Domain          | What it covers                                                        | Failure modes |
| ------------------------------ | --------- | --------------- | --------------------------------------------------------------------- | ------------- |
| getting-started                | lifecycle | onboarding      | install, kiira init, defaults model, fence format, tsconfig.docs.json | 3             |
| authoring-and-debugging-fences | core      | authoring       | fence metadata, grouping, fixtures, ts→tsx, ignored-by-default rules  | 8             |
| monorepo-and-frameworks        | framework | project-wiring  | packageMode workspace/packed, per-glob overrides, jsxImportSource     | 4             |
| ci-integration                 | lifecycle | running         | exit codes, reporters, GitHub action, any-CI, --static/--raw          | 4             |
| editor-vscode                  | lifecycle | running         | live diagnostics, commands, settings, quick fixes, shared config      | 3             |

## Failure Mode Inventory

### getting-started (3)

| # | Mistake                                  | Priority | Source                                | Cross-skill? |
| - | ---------------------------------------- | -------- | ------------------------------------- | ------------ |
| 1 | Installing Kiira where types don't resolve | HIGH   | 01-getting-started.mdx                | —            |
| 2 | Assuming a config file is required         | MEDIUM | config.ts + maintainer interview      | —            |
| 3 | Letting default include scan whole repo    | MEDIUM | config.ts / discover.ts               | —            |

### authoring-and-debugging-fences (8)

| # | Mistake                                       | Priority | Source                              | Cross-skill? |
| - | --------------------------------------------- | -------- | ----------------------------------- | ------------ |
| 1 | Continuation fence fails 'cannot find name'   | HIGH     | 02-grouping-snippets.mdx / virtual.ts | —          |
| 2 | JSX written in a `ts` fence                   | HIGH     | 03-language-tag-checking.mdx / detect.ts | —       |
| 3 | Confusing ignore vs validate=none vs group=none | HIGH   | 01-fence-metadata.mdx / virtual.ts  | —            |
| 4 | Snippet needs framework/global scope          | MEDIUM   | README / virtual.ts                 | —            |
| 5 | Expecting unused imports/locals to error      | MEDIUM   | 02-options.mdx / check.ts           | —            |
| 6 | Expecting broken relative imports to fail     | MEDIUM   | 02-options.mdx / check.ts           | —            |
| 7 | Silencing a valid error instead of fixing it  | CRITICAL | maintainer interview                | —            |
| 8 | Using validate=runtime                        | MEDIUM   | virtual.ts / maintainer interview   | —            |

### monorepo-and-frameworks (4)

| # | Mistake                                   | Priority | Source                          | Cross-skill? |
| - | ----------------------------------------- | -------- | ------------------------------- | ------------ |
| 1 | Hand-writing tsconfig paths for a monorepo | MEDIUM  | 01-monorepos.mdx / workspace.ts | —            |
| 2 | Non-React JSX checked against React types  | HIGH    | 02-per-glob-overrides.mdx / check.ts | —       |
| 3 | Override include glob doesn't match paths  | MEDIUM  | 02-per-glob-overrides.mdx       | —            |
| 4 | package=packed on unpublished local pkg    | MEDIUM  | 01-monorepos.mdx / check.ts     | —            |

### ci-integration (4)

| # | Mistake                                | Priority | Source                          | Cross-skill? |
| - | -------------------------------------- | -------- | ------------------------------- | ------------ |
| 1 | Not distinguishing exit code 2 from 1  | HIGH     | 05-exit-codes.mdx / index.ts    | —            |
| 2 | Using pretty reporter for annotations  | MEDIUM   | 03-reporters.mdx / reporters.ts | —            |
| 3 | Assuming --entry appends to include    | MEDIUM   | 02-flags.mdx / entries.ts       | —            |
| 4 | Spinner/color noise in captured logs   | LOW      | 02-flags.mdx / spinner.ts       | —            |

### editor-vscode (3)

| # | Mistake                                   | Priority | Source                          | Cross-skill? |
| - | ----------------------------------------- | -------- | ------------------------------- | ------------ |
| 1 | Editing config without restarting server  | MEDIUM  | 01-overview.mdx / extension.ts  | —            |
| 2 | Pointing kiira.configPath at wrong file    | MEDIUM  | 01-overview.mdx / extension.ts  | —            |
| 3 | Enabling showGeneratedDiagnostics          | LOW     | 01-overview.mdx / diagnostics.ts | —           |

## Tensions

| Tension                                  | Skills                                              | Agent implication                                                            |
| ---------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------- |
| Lenient defaults vs strict validation    | getting-started ↔ authoring-and-debugging-fences    | Trusts a passing run too much, or enables strict and breaks illustrative code |
| Isolated fences vs literate continuity   | authoring-and-debugging-fences                      | Multi-fence tutorials get 'cannot find name', or over-grouping redeclares     |
| Workspace-source vs packed reality       | monorepo-and-frameworks ↔ ci-integration            | Examples pass against source but fail against the published package types     |
| Auto-fix convenience vs masking errors   | authoring-and-debugging-fences ↔ ci-integration     | Runs --fix to green CI and silences a real API mismatch                       |

## Cross-References

| From                           | To                             | Reason                                                          |
| ------------------------------ | ------------------------------ | -------------------------------------------------------------- |
| getting-started                | authoring-and-debugging-fences | First real work after install is making fences pass            |
| getting-started                | ci-integration                 | Setup leads to gating CI on the same check                     |
| getting-started                | editor-vscode                  | Editor reads the same config produced during setup             |
| authoring-and-debugging-fences | monorepo-and-frameworks        | package= and framework fixtures depend on project resolution   |
| authoring-and-debugging-fences | editor-vscode                  | Quick fixes are the interactive version of ts→tsx / group=     |
| monorepo-and-frameworks        | ci-integration                 | packageMode and overrides decide what CI validates             |
| editor-vscode                  | ci-integration                 | Editor and CI share kiira.config.ts                            |

## Subsystems & Reference Candidates

| Skill                          | Subsystems                  | Reference candidates       |
| ------------------------------ | --------------------------- | -------------------------- |
| authoring-and-debugging-fences | —                           | fence metadata tokens      |
| monorepo-and-frameworks        | workspace mode, packed mode | —                          |

## Remaining Gaps

All gaps resolved in the maintainer interview:

- `validate=runtime` → agents should not emit it (behaves like `validate=type` today).
- `kiira-core` programmatic-api skill → dropped (package is effectively internal).
- Top AI-agent failure mode → silencing valid errors with `ignore`/`validate=none`/`group=none` instead of fixing them (now a CRITICAL failure mode).
- `editor-vscode` skill → lives in the `kiira` CLI package (kiira-vscode is private).

## Recommended Skill File Structure

- **Core skills:** authoring-and-debugging-fences
- **Framework skills:** monorepo-and-frameworks (per-framework jsxImportSource handled via overrides, not separate skills)
- **Lifecycle skills:** getting-started, ci-integration, editor-vscode
- **Composition skills:** none standalone — Kiira composes with TypeScript/tsconfig, package managers (workspaces), and CI, but these are covered inside the lifecycle/wiring skills rather than as separate integration skills
- **Reference files:** authoring-and-debugging-fences (fence metadata token reference)

## Composition Opportunities

| Library / tool         | Integration points                          | Composition skill needed?                    |
| ---------------------- | ------------------------------------------- | -------------------------------------------- |
| TypeScript / tsconfig  | compiler options, tsconfig.docs.json        | No — covered in getting-started + wiring     |
| pnpm/npm/yarn workspaces | workspace discovery, package resolution   | No — covered in monorepo-and-frameworks      |
| GitHub Actions         | composite action, github reporter           | No — covered in ci-integration               |
| JSX frameworks (Solid/Preact/Vue) | jsxImportSource overrides         | No — covered in monorepo-and-frameworks      |
