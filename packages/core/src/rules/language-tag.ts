import { detectLanguageTag } from "../detect"
import { defineRule } from "../plugin"
import { isCheckable } from "../virtual"

export const languageTagRule = defineRule({
	meta: {
		scope: "document",
		defaultSeverity: "warn",
		docs: { description: "Suggests `tsx` for a `ts` fence that contains JSX, with a fix that rewrites the fence." },
	},
	create(ctx) {
		for (const snippet of ctx.snippets) {
			const suggestion = isCheckable(snippet, ctx.config) ? detectLanguageTag(snippet.code, snippet.lang) : undefined
			if (suggestion) {
				const start = snippet.markdownRange.start
				ctx.report({
					range: { start, end: start },
					message: `This \`${snippet.lang}\` code fence contains JSX. Change the language tag to \`${suggestion.suggested}\` (run \`kiira check --fix\` to apply).`,
					fix: { kind: "fence-language", line: start.line, language: suggestion.suggested },
				})
			}
		}
	},
})
