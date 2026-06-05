import type { TypedownCheckResult } from "@typedown/core"
import { formatGithub, formatJson, formatPretty } from "./reporters"

function result(): TypedownCheckResult {
	return {
		snippets: [],
		virtualFiles: [],
		diagnostics: [
			{
				severity: "error",
				code: 2305,
				source: "typescript",
				message: "Module '\"@tanstack/ai/react\"' has no exported member 'useAgentChat'.",
				markdownFile: "docs/quickstart.md",
				markdownRange: {
					start: { line: 41, character: 9 },
					end: { line: 41, character: 21 },
				},
			},
		],
		stats: { markdownFiles: 1, snippets: 5, checked: 4, ignored: 1, errors: 1, warnings: 0 },
	}
}

describe("formatJson", () => {
	it("emits machine-readable diagnostics with 1-based positions", () => {
		const parsed = JSON.parse(formatJson(result()))
		expect(parsed.stats.errors).toBe(1)
		expect(parsed.diagnostics[0].code).toBe(2305)
		expect(parsed.diagnostics[0].markdownFile).toBe("docs/quickstart.md")
		expect(parsed.diagnostics[0].markdownRange.start).toEqual({ line: 42, character: 10 })
		expect(parsed.diagnostics[0].markdownRange.end).toEqual({ line: 42, character: 22 })
	})
})

describe("formatGithub", () => {
	it("emits a workflow error annotation with 1-based line/col", () => {
		const out = formatGithub(result())
		expect(out).toContain("::error file=docs/quickstart.md,line=42,col=10,title=TS2305::")
		expect(out).toContain("has no exported member 'useAgentChat'")
	})

	it("escapes newlines in messages", () => {
		const r = result()
		const [first] = r.diagnostics
		if (!first) {
			throw new Error("expected a diagnostic")
		}
		first.message = "line one\nline two"
		expect(formatGithub(r)).toContain("line one%0Aline two")
	})
})

describe("formatPretty", () => {
	it("includes the location, code, and message", () => {
		const out = formatPretty(result(), { cwd: "/repo" })
		expect(out).toContain("docs/quickstart.md:42:10")
		expect(out).toContain("TS2305")
		expect(out).toContain("has no exported member 'useAgentChat'")
	})

	it("renders a code frame with a caret when source lines are available", () => {
		const lines = ["# Quickstart", "", "```tsx", 'import { useAgentChat } from "@tanstack/ai/react"']
		// Pad so index 41 exists.
		while (lines.length < 42) {
			lines.push("")
		}
		lines[41] = 'import { useAgentChat } from "@tanstack/ai/react"'
		const out = formatPretty(result(), {
			cwd: "/repo",
			getSourceLines: () => lines,
		})
		expect(out).toContain("import { useAgentChat }")
		expect(out).toContain("^")
	})

	it("reports success when there are no diagnostics", () => {
		const clean: TypedownCheckResult = {
			snippets: [],
			virtualFiles: [],
			diagnostics: [],
			stats: { markdownFiles: 2, snippets: 3, checked: 3, ignored: 0, errors: 0, warnings: 0 },
		}
		expect(formatPretty(clean, { cwd: "/repo" })).toMatch(/no (errors|problems)/i)
	})
})
