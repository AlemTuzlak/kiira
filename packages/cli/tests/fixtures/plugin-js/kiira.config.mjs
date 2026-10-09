import { definePlugin, defineRule } from "kiira-core/plugin"

const noWord = defineRule({
	meta: {
		scope: "document",
		defaultSeverity: "warn",
		options: {
			default: { word: "TODO" },
			validate: (options) => (typeof options?.word === "string" ? undefined : "`word` must be a string"),
		},
	},
	create(ctx) {
		ctx.text.split("\n").forEach((line, index) => {
			const character = line.indexOf(ctx.options.word)
			if (character !== -1) {
				const start = { line: index, character }
				const end = { line: index, character: character + ctx.options.word.length }
				ctx.report({ range: { start, end }, message: `Remove "${ctx.options.word}" before publishing.` })
			}
		})
	},
})

export default {
	include: ["**/*.md"],
	plugins: [definePlugin({ name: "docs", rules: { "no-word": noWord } })],
	rules: { "docs/no-word": "error" },
}
