import { defineConfig } from "@typedown/core"

export default defineConfig({
	include: ["docs/**/*.md", "README.md"],
	tsconfig: "tsconfig.docs.json",
	defaultValidate: "type",
	languages: ["ts", "tsx", "js", "jsx"],
	fixtures: {
		node: { type: "prepend", content: "export {}" },
	},
})
