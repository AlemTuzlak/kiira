# typedown-action

A GitHub composite action that runs [Typedown](https://github.com/AlemTuzlak/typedown) to
type-check the TypeScript and JavaScript code fences in your Markdown docs as part of CI.

The action assumes Typedown is already installed in your project (e.g. via
`pnpm add -D @typedown/cli`) and that dependencies have been installed in a previous step.

## Usage

```yaml
name: Docs

on:
  pull_request:
  push:
    branches:
      - main

jobs:
  typedown:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 10

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - uses: AlemTuzlak/typedown/packages/github-action@v1
        with:
          command: pnpm typedown check
          reporter: github
```

## Inputs

| Input               | Default          | Description                                              |
| ------------------- | ---------------- | -------------------------------------------------------- |
| `command`           | `typedown check` | The Typedown command to run.                             |
| `config`            | _(none)_         | Path to a Typedown config file.                          |
| `reporter`          | `github`         | Reporter format: `pretty`, `github`, `json`, or `sarif`. |
| `files`             | _(none)_         | Optional space-separated Markdown files/globs to check.  |
| `working-directory` | `.`              | Directory to run Typedown in.                            |

With `reporter: github`, validation errors appear as inline annotations on the
offending Markdown lines and a non-zero exit code fails the job.
