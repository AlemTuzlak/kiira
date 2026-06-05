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

function fixableResult(): TypedownCheckResult {
	const r = result()
	r.diagnostics.push({
		severity: "warning",
		code: "language-tag",
		source: "typedown",
		message: "This `ts` fence contains JSX.",
		markdownFile: "docs/quickstart.md",
		markdownRange: { start: { line: 40, character: 0 }, end: { line: 40, character: 0 } },
		fix: { kind: "fence-language", line: 40, language: "tsx" },
	})
	return r
}

describe("fixable stat", () => {
	it("includes a fixable count in the JSON stats", () => {
		expect(JSON.parse(formatJson(result())).stats.fixable).toBe(0)
		expect(JSON.parse(formatJson(fixableResult())).stats.fixable).toBe(1)
	})

	it("shows a fixable line in pretty output when fixes are available", () => {
		expect(formatPretty(result(), { cwd: "/repo" })).not.toContain("fixable")
		const out = formatPretty(fixableResult(), { cwd: "/repo" })
		expect(out).toContain("1 issue fixable with `typedown check --fix`.")
	})
})

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

	it("renders a code frame with a caret in verbose mode", () => {
		const lines: string[] = ["# Quickstart", "", "```tsx"]
		while (lines.length < 42) {
			lines.push("")
		}
		lines[41] = 'import { useAgentChat } from "@tanstack/ai/react"'
		const out = formatPretty(result(), { cwd: "/repo", getSourceLines: () => lines, verbose: true })
		expect(out).toContain("import { useAgentChat }")
		expect(out).toContain("^")
	})

	it("is compact by default: location + message, no code frame", () => {
		const lines: string[] = []
		while (lines.length < 42) {
			lines.push("")
		}
		lines[41] = 'import { useAgentChat } from "@tanstack/ai/react"'
		const out = formatPretty(result(), { cwd: "/repo", getSourceLines: () => lines })
		expect(out).not.toContain("import { useAgentChat }") // source line is verbose-only
		expect(out).not.toContain("^^^")
		expect(out).toContain("docs/quickstart.md:42:10")
		expect(out).toContain("has no exported member 'useAgentChat'")
	})

	it("counts failed snippets (not error messages) so Passed never goes negative", () => {
		const r: TypedownCheckResult = {
			snippets: [],
			virtualFiles: [],
			diagnostics: [
				{
					severity: "error",
					code: 2322,
					source: "typescript",
					message: "err 1",
					markdownFile: "a.md",
					markdownRange: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } },
					virtualFile: "a__snippet_000.ts",
				},
				{
					severity: "error",
					code: 2304,
					source: "typescript",
					message: "err 2",
					markdownFile: "a.md",
					markdownRange: { start: { line: 2, character: 0 }, end: { line: 2, character: 1 } },
					virtualFile: "a__snippet_000.ts",
				},
			],
			stats: { markdownFiles: 1, snippets: 1, checked: 1, ignored: 0, errors: 2, warnings: 0 },
		}
		const out = formatPretty(r, { cwd: "/repo" })
		// One snippet with two errors -> Passed 0, Failed 1 (not Passed -1).
		expect(out).toContain("Passed 0. Failed 1.")
	})

	it("emits no ANSI escape codes in raw mode", () => {
		const out = formatPretty(result(), { cwd: "/repo", raw: true })
		// ESC (char 27) introduces every ANSI sequence; raw mode must emit none.
		expect(out.includes(String.fromCharCode(27))).toBe(false)
		expect(out).toContain("docs/quickstart.md:42:10")
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
