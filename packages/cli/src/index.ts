// Public entry of `kiira`. Users install only `kiira`, and with pnpm the
// transitive `kiira-core` is not importable from their code, so the config
// helpers are re-exported here. The CLI lives in ./cli.ts.
export { defineConfig } from "kiira-core"
export type {
	KiiraConfig,
	KiiraEngine,
	KiiraFixture,
	KiiraLanguage,
	KiiraOverride,
	RuleSetting,
} from "kiira-core"
