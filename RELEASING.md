# Releasing

Typedown ships three artifacts from this monorepo:

| Package | Registry | Published by |
| --- | --- | --- |
| `@alemtuzlak/typedown` | npm | `.github/workflows/publish.yaml` (Changesets) |
| `@alemtuzlak/typedown-cli` | npm | `.github/workflows/publish.yaml` (Changesets) |
| `typedown-vscode` (CodeForge.typedown-vscode) | VS Code Marketplace + Open VSX | `.github/workflows/publish-vscode.yaml` |

## The flow (Changesets)

1. Every change that should ship includes a changeset: `pnpm changeset`.
2. On merge to `main`, the **Release** workflow opens (or refreshes) a
   **"Version Packages"** PR that applies the changesets — bumping versions and
   updating changelogs for all three packages.
3. Merging that **Version Packages** PR:
   - publishes `@alemtuzlak/typedown` and `@alemtuzlak/typedown-cli` to npm (with provenance), and
   - bumps `typedown-vscode`'s version, which triggers the **Publish VS Code
     Extension** workflow to build, package, and publish the `.vsix` to the
     Marketplace and Open VSX, then tag + cut a GitHub Release.

The VS Code extension is `private: true`, so Changesets version-bumps it but never
publishes it to npm — only the Marketplace workflow ships it.

## One-time setup (required before the first publish)

### npm trusted publishing (for `@alemtuzlak/typedown` and `@alemtuzlak/typedown-cli`)

The `@alemtuzlak` scope must be owned by the publishing account on npm. For each of
`@alemtuzlak/typedown` and `@alemtuzlak/typedown-cli`, configure a **trusted publisher** on
npmjs.com → package **Settings → Trusted Publisher → GitHub Actions**:

- Repository: `AlemTuzlak/typedown`
- Workflow: `.github/workflows/publish.yaml`

No `NPM_TOKEN` is needed — the workflow authenticates via OIDC (`id-token: write`)
and publishes with provenance. (If you prefer a token instead, add an `NPM_TOKEN`
secret and set `NODE_AUTH_TOKEN` in the publish step.)

### VS Code Marketplace + Open VSX (for `typedown-vscode`, publisher `CodeForge`)

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
