# Releasing

Kiira ships three artifacts from this monorepo:

| Package | Registry | Published by |
| --- | --- | --- |
| `kiira-core` | npm | `.github/workflows/publish.yaml` (Changesets) |
| `kiira` | npm | `.github/workflows/publish.yaml` (Changesets) |
| `kiira-vscode` (CodeForge.kiira-vscode) | VS Code Marketplace + Open VSX | `.github/workflows/publish-vscode.yaml` |

## The flow (Changesets)

1. Every change that should ship includes a changeset: `pnpm changeset`.
2. On merge to `main`, the **Release** workflow opens (or refreshes) a
   **"Version Packages"** PR that applies the changesets — bumping versions and
   updating changelogs for all three packages.
3. Merging that **Version Packages** PR:
   - publishes `kiira-core` and `kiira` to npm (with provenance), and
   - bumps `kiira-vscode`'s version, which triggers the **Publish VS Code
     Extension** workflow to build, package, and publish the `.vsix` to the
     Marketplace and Open VSX, then tag + cut a GitHub Release, and
   - deploys the production docs (the `deploy-docs` job in **Release**).

The VS Code extension is `private: true`, so Changesets version-bumps it but never
publishes it to npm — only the Marketplace workflow ships it.

> [!IMPORTANT]
> **Merge the "Version Packages" PR with a *merge commit* — not a squash.**
> Changesets opens that PR as `github-actions[bot]`, and GitHub will not trigger
> workflows from a bot-authored push (anti-recursion, because CI uses the default
> `GITHUB_TOKEN`). A **merge commit** is authored by *you* (the human clicking
> merge), so it triggers the **Release** workflow and everything downstream
> publishes automatically. A **squash** rewrites the tip into a single
> bot-authored commit, which does **not** trigger anything — so the version bump
> lands on `main` but nothing publishes.
>
> If you do squash it by accident (or the publish otherwise doesn't fire), the
> recovery is one click: run the **Release** workflow manually via
> *workflow_dispatch* (Actions → Release → Run workflow). `changeset publish` is
> idempotent — it only publishes versions not already on npm, and the VS Code and
> docs jobs self-gate the same way, so a manual run is always safe.
>
> Normal feature PRs can be squashed freely; this only matters for the
> Changesets-authored "Version Packages" PR.

## One-time setup (required before the first publish)

### npm trusted publishing (for `kiira-core` and `kiira`)

The `@alemtuzlak` scope must be owned by the publishing account on npm. For each of
`kiira-core` and `kiira`, configure a **trusted publisher** on
npmjs.com → package **Settings → Trusted Publisher → GitHub Actions**:

- Repository: `AlemTuzlak/kiira`
- Workflow: `.github/workflows/publish.yaml`

No `NPM_TOKEN` is needed — the workflow authenticates via OIDC (`id-token: write`)
and publishes with provenance. (If you prefer a token instead, add an `NPM_TOKEN`
secret and set `NODE_AUTH_TOKEN` in the publish step.)

### VS Code Marketplace + Open VSX (for `kiira-vscode`, publisher `CodeForge`)

Add these repository (or `production` environment) secrets:

- **`VSCE_PAT`** — an Azure DevOps Personal Access Token with **Marketplace →
  Manage** rights for the **`CodeForge`** publisher. Create it at
  <https://dev.azure.com> → User settings → Personal access tokens, then ensure the
  account is a member of the `CodeForge` publisher at
  <https://marketplace.visualstudio.com/manage>.
- **`OVSX_PAT`** — an [Open VSX](https://open-vsx.org) access token for the
  `CodeForge` namespace (create the namespace first: `npx ovsx create-namespace
  CodeForge -p <token>`). Open VSX publishing is best-effort and skipped if the
  secret is absent.

Until `VSCE_PAT` is present, the extension publish workflow skips publishing (and
`main` stays green); add the secret to enable it.

## Manual / dry runs

- Build + package a `.vsix` locally: `pnpm -C packages/vscode run package`.
- Validate the publish workflow without publishing: run **Publish VS Code
  Extension** via *workflow_dispatch* with `dry_run: true`.
