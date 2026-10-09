import type { Root } from "mdast"
import { collectCodeNodes } from "../code-nodes"
import { parseFenceMeta } from "../meta"
import { defineRule } from "../plugin"
import type { ExtractedSnippet, RuleReport } from "../types"

/** One report per invalid fence-metadata value, anchored to the whole fence. */
export function fenceMetaReports(mdast: Root, snippets: readonly ExtractedSnippet[]): RuleReport[] {
	const byLine = new Map(snippets.map((snippet) => [snippet.markdownRange.start.line, snippet]))
	const reports: RuleReport[] = []
	for (const node of collectCodeNodes(mdast)) {
		const snippet = node.position ? byLine.get(node.position.start.line - 1) : undefined
		if (!snippet) {
			continue
		}
		for (const issue of parseFenceMeta(node.meta).issues) {
			reports.push({ range: snippet.markdownRange, message: issue.message })
		}
	}
	return reports
}

export const fenceMetaRule = defineRule({
	meta: {
		scope: "document",
		defaultSeverity: "warn",
		docs: { description: "Reports invalid `validate=` or `package=` values in a code fence's info string." },
	},
	create(ctx) {
		for (const report of fenceMetaReports(ctx.mdast, ctx.snippets)) {
			ctx.report(report)
		}
	},
})
