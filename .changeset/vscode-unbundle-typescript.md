---
"kiira-vscode": minor
---

The extension no longer bundles TypeScript (about 10 MB of the install). It checks each workspace folder with the folder's own TypeScript 5.4+ or 6 when installed, so diagnostics match the project, and otherwise with the TypeScript VS Code ships for its built-in TypeScript features. An error is shown if neither is available. When TypeScript is installed or updated in the workspace, the extension asks you to reload the window.
