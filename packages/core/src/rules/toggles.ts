import { defineRule } from "../plugin"

// These two rules report nothing themselves. The type-check step reads their
// level: it enables `noUnusedLocals`/`noUnusedParameters` and keeps unresolved
// relative imports, and "warn" downgrades the diagnostics each one owns.

export const unusedSymbolsRule = defineRule({
	meta: {
		scope: "document",
		defaultSeverity: "off",
		docs: { description: "Enables TypeScript's unused local and parameter checks (TS6133 and related)." },
	},
	create() {},
})

export const relativeImportsRule = defineRule({
	meta: {
		scope: "document",
		defaultSeverity: "off",
		docs: {
			description: "Keeps `Cannot find module './x'` errors for relative imports, which are dropped by default.",
		},
	},
	create() {},
})
