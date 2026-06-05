export const VERSION = "0.1.0"

export const HELP_TEXT = `typedown — type-check the code in your Markdown

Usage:
  typedown [check] [files...] [options]
  typedown init

Commands:
  check            Validate Markdown code fences (default).
  init             Scaffold typedown.config.ts and tsconfig.docs.json.

Options:
  --entry <path>       Directory, file, or glob to check (repeatable).
  --ignore <path>      Directory, file, or glob to exclude (repeatable).
  --config <path>      Path to a Typedown config file.
  --reporter <name>    Output format: pretty (default), json, or github.
  --fix                Rewrite mistagged code fences (e.g. ts -> tsx for JSX).
  --verbose            Show full error messages and code frames.
  --raw                Disable colored output (plain text).
  -h, --help           Show this help.
  -v, --version        Show the version.

Examples:
  typedown check
  typedown check --entry docs --entry README.md
  typedown check --entry docs --ignore docs/api
  typedown check --reporter github
  typedown check --config typedown.config.ts --reporter json
`
