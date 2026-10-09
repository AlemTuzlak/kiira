import { defineRule } from "../plugin"
import type { DocumentParseError, RuleReport } from "../types"

/** The report for a Markdown/MDX parse failure, anchored where the parser stopped. */
export function parseErrorReport(file: string, parseError: DocumentParseError): RuleReport {
	const kind = /\.mdx$/i.test(file) ? "MDX" : "Markdown"
	return {
		range: { start: parseError.position, end: parseError.position },
		message: `Failed to parse ${kind}: ${parseError.message}`,
	}
}

export const parseErrorRule = defineRule({
	meta: {
		scope: "document",
		defaultSeverity: "error",
		docs: { description: "Reports a Markdown or MDX file that fails to parse, so no code fences are checked in it." },
	},
	create(ctx) {
		if (ctx.parseError) {
			ctx.report(parseErrorReport(ctx.file, ctx.parseError))
		}
	},
})
