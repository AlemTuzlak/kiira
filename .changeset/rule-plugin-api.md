---
"kiira-core": minor
"kiira": minor
"kiira-vscode": patch
---

Add an experimental rule and plugin API. Kiira's own diagnostics now run as built-in rules, and the new `rules`, `presets`, and `plugins` options (and `overrides[].rules`, `overrides[].presets`, `overrides[].codeFenceLanguages`) set rule levels and add your own rules with `defineRule` and `definePlugin` from `kiira-core/plugin`. `kiira check --rule <id>=<off|warn|error>` sets a level for one run. Rule diagnostics use the rule id as their `code`, so fence metadata warnings and parse errors now have the codes `fence-meta` and `parse-error`. `checkMarkdownText` checks one in-memory document, and the VS Code extension uses it so rule diagnostics show in the editor. A rule that throws does not stop the check: Kiira reports it as an `error` diagnostic with the rule id as its `code`, and the other rules still run. A report's `severity` can lower the configured level, but not raise it. `collectSuggestions` also returns the `language-tag` warnings, because `createVirtualFiles` no longer reports them.
