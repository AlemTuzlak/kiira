import { defineConfig } from "kiira-core"
import { teamPlugin } from "./kiira-plugin"

export default defineConfig({
	// Program rules need the classic engine, which builds a `ts.Program` in-process.
	engine: "classic",
	tsconfig: "tsconfig.docs.json",
	plugins: [teamPlugin],
	// The preset sets which files to check and the level of each rule.
	presets: ["team/docs"],
	// Top-level `rules` layer on top of the preset.
	rules: { "team/no-any-exports": "warn" },
})
