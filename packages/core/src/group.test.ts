import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { checkMarkdownFiles } from "./check"
import type { TypedownDiagnostic } from "./types"

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = resolve(here, "../tests/fixtures/group")

function errors(diagnostics: TypedownDiagnostic[]): TypedownDiagnostic[] {
	return diagnostics.filter((d) => d.severity === "error")
}

describe("group= checking", () => {
	it("type-checks grouped fences together so later fences see earlier declarations", async () => {
		const result = await checkMarkdownFiles({
			cwd: fixtures,
			files: ["doc.md"],
			config: { include: ["**/*.md"] },
		})

		const cannotFindGreeting = errors(result.diagnostics).filter(
			(d) => d.code === 2304 && d.message.includes("greeting")
		)
		// Exactly one "Cannot find name 'greeting'" — from the ungrouped orphan fence.
		// The grouped fence resolves `greeting` from its group-mate.
		expect(cannotFindGreeting).toHaveLength(1)
		expect(cannotFindGreeting[0]?.markdownRange.start.line).toBe(17)
	})

	it("suggests grouping (with a fence-meta fix) for ungrouped continuation snippets", async () => {
		const result = await checkMarkdownFiles({
			cwd: fixtures,
			files: ["ungrouped.md"],
			config: { include: ["**/*.md"] },
		})

		const groupSuggestions = result.diagnostics.filter((d) => d.code === "group")
		// One suggestion per fence in the doc (both should be tagged).
		expect(groupSuggestions).toHaveLength(2)
		expect(groupSuggestions[0]?.severity).toBe("warning")
		expect(groupSuggestions[0]?.fix).toEqual({ kind: "fence-meta", line: 2, append: "group=ungrouped" })
		expect(groupSuggestions[1]?.fix?.kind).toBe("fence-meta")
	})

	it("groups only the genuine continuation, excluding an independent redeclaring block", async () => {
		const result = await checkMarkdownFiles({
			cwd: fixtures,
			files: ["conflict.md"],
			config: { include: ["**/*.md"] },
		})
		// The definer (line 2) and its continuation (line 8) are grouped; the
		// independent `const base = 99` block (line 15) is left out, so no redeclare.
		const lines = result.diagnostics
			.filter((d) => d.code === "group")
			.map((d) => d.markdownRange.start.line)
			.sort((a, b) => a - b)
		expect(lines).toEqual([2, 8])
	})

	it("plans separate groups for independent continuation clusters", async () => {
		const result = await checkMarkdownFiles({
			cwd: fixtures,
			files: ["two-clusters.md"],
			config: { include: ["**/*.md"] },
		})
		const groups = result.diagnostics.filter((d) => d.code === "group")
		const slugs = new Set(groups.map((d) => (d.fix?.kind === "fence-meta" ? d.fix.append : "")))
		// Two independent clusters -> two distinct group ids, four tagged fences.
		expect(groups).toHaveLength(4)
		expect(slugs.size).toBe(2)
	})

	it("does not suggest grouping when snippets are already standalone", async () => {
		// doc.md's grouped fences resolve; its only error is the intentional orphan,
		// which grouping would NOT fix — so no group suggestion should appear.
		const result = await checkMarkdownFiles({
			cwd: fixtures,
			files: ["doc.md"],
			config: { include: ["**/*.md"] },
		})
		expect(result.diagnostics.some((d) => d.code === "group")).toBe(false)
	})

	it("groups two fences into a single virtual file plus the ungrouped one", async () => {
		const result = await checkMarkdownFiles({
			cwd: fixtures,
			files: ["doc.md"],
			config: { include: ["**/*.md"] },
		})
		// 3 snippets, but the two group=demo fences share one virtual file -> 2 files.
		expect(result.stats.snippets).toBe(3)
		expect(result.virtualFiles).toHaveLength(2)
		const grouped = result.virtualFiles.find((v) => v.id.includes("group:demo"))
		expect(grouped?.content).toContain('const greeting: string = "hello"')
		expect(grouped?.content).toContain("greeting.toUpperCase()")
	})
})
