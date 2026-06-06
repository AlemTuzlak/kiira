# Kiira Documentation Site

This is the documentation website for **Kiira** — a tool that type-checks the TypeScript/JavaScript code fences inside your Markdown docs against your real project API, reporting errors on the exact Markdown line in your editor, on the CLI, and in CI.

The site is built with [React Router v7](https://reactrouter.com/) and [content-collections](https://github.com/sdorra/content-collections), scaffolded from the [code-forge-io/docs](https://github.com/code-forge-io/docs) template.

- Kiira repository: https://github.com/AlemTuzlak/kiira

## Project structure

- `app/` — the React Router v7 application (components, routes, utilities, styles).
- `content/` — the documentation content as `.md` / `.mdx` files. This is what you edit to change the docs.
- `resources/` — icons, fonts, and other assets.
- `public/` — static assets served as-is.
- `content-collections.ts` — content-collections configuration and schemas.
- `Dockerfile`, `fly.toml` — container build and Fly.io deployment configuration.

## Content conventions

- Pages are `.mdx` files under `content/`. Each page's frontmatter requires `title`, `summary`, and `description` (all strings). Page bodies start with `##` headings — the H1 comes from the `title`.
- Sections are numbered subfolders (`01-`, `02-`, …). Each section folder contains an `index.md` whose frontmatter has only a `title`.
- Ordering in the sidebar is by the numeric filename prefix.
- `content/_index.mdx` is the docs homepage.

## Local development

```bash
pnpm install
cp .env.example .env   # then fill in GITHUB_OWNER / GITHUB_REPO / GITHUB_REPO_URL
pnpm run dev
```

## Build

```bash
pnpm run build
pnpm run typecheck
```

## Deployment

The site ships a `Dockerfile` and `fly.toml` (app name `kiira-docs`):

```bash
fly deploy
```
