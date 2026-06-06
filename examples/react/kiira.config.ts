import { defineConfig } from "kiira-core"

export default defineConfig({
	include: ["docs/**/*.md", "README.md"],
	tsconfig: "tsconfig.docs.json",
	defaultValidate: "type",
	defaultFixture: "react",
	languages: ["ts", "tsx", "js", "jsx"],
	fixtures: {
		// Make `React` available to every JSX snippet.
		react: { type: "prepend", content: 'import * as React from "react"' },
		// Wrap a bare JSX expression in a component so it is a valid module.
		"react-component": {
			type: "wrap",
			before: 'import * as React from "react"\n\nexport function Example() {\n  return (',
			after: "  )\n}",
		},
	},
})
