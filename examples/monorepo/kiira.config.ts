import { defineConfig } from "kiira-core"

export default defineConfig({
	// One config validating docs across every package in the monorepo.
	include: ["packages/*/README.md", "packages/*/docs/**/*.md"],
	exclude: ["**/node_modules/**"],
	tsconfig: "tsconfig.docs.json",
	defaultValidate: "type",
	fixtures: {
		node: { type: "prepend", content: "export {}" },
	},
})
