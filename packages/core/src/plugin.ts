// Public `kiira-core/plugin` entry. Keep this file free of runtime imports so a
// plugin author's import pulls nothing else in; types are erased at build.
import type { KiiraPlugin, KiiraRule, RuleScope } from "./types"

export type {
	KiiraPlugin,
	KiiraPreset,
	KiiraProject,
	KiiraRule,
	RuleContextFor,
	RuleDocumentContext,
	RuleMeta,
	RuleProgramContext,
	RuleProjectContext,
	RuleReport,
	RuleScope,
	RuleSetting,
	RuleSeverity,
} from "./types"

/** Identity helper that types a rule's `create` context from `meta.scope` and its options from `meta.options`. */
export function defineRule<TScope extends RuleScope, TOptions = unknown>(
	rule: KiiraRule<TScope, TOptions>
): KiiraRule<TScope, TOptions> {
	return rule
}

/** Identity helper that gives editors type-checking for a plugin. */
export function definePlugin<TPlugin extends KiiraPlugin>(plugin: TPlugin): TPlugin {
	return plugin
}
