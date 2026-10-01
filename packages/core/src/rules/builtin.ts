import { definePlugin } from "../plugin"
import type { KiiraPlugin } from "../types"
import { fenceMetaRule } from "./fence-meta"
import { groupRule } from "./group"
import { jsxFrameworkRule } from "./jsx-framework"
import { languageTagRule } from "./language-tag"
import { parseErrorRule } from "./parse-error"
import { relativeImportsRule, unusedSymbolsRule } from "./toggles"

// `config.ts` imports this file, and some rules import modules that import
// `config.ts` back. That is safe only while rule modules touch those imports
// inside `create`, never at load, and are reached through this file.

/** Kiira's own rules, registered unprefixed and in this order (it is the execution order). */
export const builtinPlugin: KiiraPlugin = definePlugin({
	name: "kiira",
	rules: {
		"parse-error": parseErrorRule,
		"fence-meta": fenceMetaRule,
		"language-tag": languageTagRule,
		group: groupRule,
		"jsx-framework": jsxFrameworkRule,
		"unused-symbols": unusedSymbolsRule,
		"relative-imports": relativeImportsRule,
	},
})
