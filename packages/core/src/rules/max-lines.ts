import { defineRule } from "../plugin"

interface MaxLinesOptions {
	max: number
}

export const maxLinesRule = defineRule<"document", MaxLinesOptions>({
	meta: {
		scope: "document",
		defaultSeverity: "off",
		docs: { description: "Reports a Markdown file with more lines than `max`." },
		options: {
			validate: (options) => {
				if (options === undefined) {
					return '`max` is required, for example ["error", { max: 300 }]'
				}
				const max = (options as { max?: unknown } | null)?.max
				return typeof max === "number" && Number.isInteger(max) && max > 0
					? undefined
					: "`max` must be a positive integer"
			},
		},
	},
	create(ctx) {
		const lines = ctx.text.split(/\r?\n/)
		// A trailing newline ends the last line; it does not start a new one.
		if (lines.at(-1) === "") {
			lines.pop()
		}
		const { max } = ctx.options
		const firstExtra = lines[max]
		if (firstExtra !== undefined) {
			ctx.report({
				range: { start: { line: max, character: 0 }, end: { line: max, character: firstExtra.length } },
				message: `File has ${lines.length} lines (max ${max}).`,
			})
		}
	},
})
