# @kiira-example/plugin-basic

A project with a small Kiira plugin, defined in [`kiira-plugin.ts`](kiira-plugin.ts):

- a document rule that reads `frontmatter.raw`, requires a `title:`, and adds a missing `slug:` with an `edits` fix
- a program rule that uses the type checker to flag exported values typed `any`
- a project rule that requires `docs/index.md`
- a preset whose `include` function derives the globs from the workspace
- a TypeScript hook that drops one diagnostic

```bash
pnpm check:docs                # runs `kiira check`
pnpm exec kiira check --fix --dry-run   # after deleting a `slug:` line, shows the fix
pnpm test:unit                 # end-to-end tests for every rule
```

The pages in [`docs/`](docs) are clean. The tests in [`tests/plugin.test.ts`](tests/plugin.test.ts) copy them into
throwaway projects and break them one rule at a time. See the plugin guide in the Kiira docs for the API.
