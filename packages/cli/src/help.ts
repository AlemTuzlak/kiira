export const VERSION = "0.1.0"

export const HELP_TEXT = `kiira — type-check the code in your Markdown

Usage:
  kiira [check] [files...] [options]
  kiira init

Commands:
  check            Validate Markdown code fences (default).
  init             Scaffold kiira.config.ts and tsconfig.docs.json.

Options:
  --entry <path>       Directory, file, or glob to check (repeatable).
  --ignore <path>      Directory, file, or glob to exclude (repeatable).
  --config <path>      Path to a Kiira config file.
  --reporter <name>    Output format: pretty (default), json, or github.
  --fix                Rewrite mistagged code fences (e.g. ts -> tsx for JSX).
  --verbose            Show full error messages and code frames.
  --raw                Disable colored output (plain text).
  --static             Disable the loading spinner.
  -h, --help           Show this help.
  -v, --version        Show the version.

Examples:
  kiira check
  kiira check --entry docs --entry README.md
  kiira check --entry docs --ignore docs/api
  kiira check --reporter github
  kiira check --config kiira.config.ts --reporter json
`
