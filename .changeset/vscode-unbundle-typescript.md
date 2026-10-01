---
"kiira-vscode": minor
---

The extension no longer bundles TypeScript (about 10 MB of the install). It checks with the workspace's TypeScript 5/6 when installed, so diagnostics match the project, and otherwise with the TypeScript VS Code ships for its built-in TypeScript features. An error is shown if neither is available.
