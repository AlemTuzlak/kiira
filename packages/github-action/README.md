# kiira-action

A GitHub composite action that runs [Kiira](https://github.com/AlemTuzlak/kiira) to
type-check the TypeScript and JavaScript code fences in your Markdown docs as part of CI.

The action assumes Kiira is already installed in your project (e.g. via
`pnpm add -D kiira`) and that dependencies have been installed in a previous step.

## Usage

```yaml
name: Docs

on:
  pull_request:
  push:
    branches:
      - main

jobs:
  kiira:
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

      - uses: AlemTuzlak/kiira/packages/github-action@v1
        with:
          command: pnpm kiira check
          reporter: github
```

## Inputs

| Input               | Default          | Description                                              |
| ------------------- | ---------------- | -------------------------------------------------------- |
| `command`           | `kiira check` | The Kiira command to run.                             |
| `config`            | _(none)_         | Path to a Kiira config file.                          |
| `reporter`          | `github`         | Reporter format: `pretty`, `github`, `json`, or `sarif`. |
| `files`             | _(none)_         | Optional space-separated Markdown files/globs to check.  |
| `working-directory` | `.`              | Directory to run Kiira in.                            |

With `reporter: github`, validation errors appear as inline annotations on the
offending Markdown lines and a non-zero exit code fails the job.
