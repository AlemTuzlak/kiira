import { detectLanguageTag } from "../detect"
import { defineRule } from "../plugin"
import type { ExtractedSnippet, ResolvedKiiraConfig, RuleReport } from "../types"
import { isCheckable } from "../virtual"

/** For each checkable `ts` fence that contains JSX, suggest `tsx` with a fix that rewrites the fence. */
export function languageTagSuggestions(
	snippets: readonly ExtractedSnippet[],
	config: ResolvedKiiraConfig
): RuleReport[] {
	const reports: RuleReport[] = []
	for (const snippet of snippets) {
		const suggestion = isCheckable(snippet, config) ? detectLanguageTag(snippet.code, snippet.lang) : undefined
		if (suggestion) {
			const start = snippet.markdownRange.start
			reports.push({
				range: { start, end: start },
				message: `This \`${snippet.lang}\` code fence contains JSX. Change the language tag to \`${suggestion.suggested}\` (run \`kiira check --fix\` to apply).`,
				fix: { kind: "fence-language", line: start.line, language: suggestion.suggested },
			})
		}
	}
	return reports
}

export const languageTagRule = defineRule({
	meta: {
		scope: "document",
		defaultSeverity: "warn",
		docs: { description: "Suggests `tsx` for a `ts` fence that contains JSX, with a fix that rewrites the fence." },
	},
	create(ctx) {
		for (const report of languageTagSuggestions(ctx.snippets, ctx.config)) {
			ctx.report(report)
		}
	},
})
