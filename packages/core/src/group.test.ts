import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { checkMarkdownFiles } from "./check"
import type { KiiraDiagnostic } from "./types"

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = resolve(here, "../tests/fixtures/group")

function errors(diagnostics: KiiraDiagnostic[]): KiiraDiagnostic[] {
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

	it("excludes a redeclaring example that only shares a free reference with the definer", async () => {
		const result = await checkMarkdownFiles({
			cwd: fixtures,
			files: ["redeclare-ref.md"],
			config: { include: ["**/*.md"] },
		})
		// The definer (fence line 2) and its continuation (line 9) group. The third
		// fence (line 16) references `Widget` from the definer but redeclares `client`,
		// so merging it would cause TS2451 — it must be left out, and the legitimate
		// group must still be suggested (the bug was the whole cluster being dropped).
		const lines = result.diagnostics
			.filter((d) => d.code === "group")
			.map((d) => d.markdownRange.start.line)
			.sort((a, b) => a - b)
		expect(lines).toEqual([2, 9])
	})

	it("leaves a snippet ungrouped when its nearest provider would redeclare a shared name", async () => {
		const result = await checkMarkdownFiles({
			cwd: fixtures,
			files: ["nearest-conflicts.md"],
			config: { include: ["**/*.md"] },
		})
		// The third fence (line 18) references `Item` but its nearest declarer (line
		// 11) also declares `shared`, which it redeclares — so it is an independent
		// example, not a continuation, and must be left ungrouped rather than chained
		// back to the distant definer at line 2 (which would over-group).
		const groups = result.diagnostics.filter((d) => d.code === "group")
		expect(groups).toHaveLength(0)
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

	it("defaultGroup=file collapses TS2304 continuations with no annotations", async () => {
		const result = await checkMarkdownFiles({
			cwd: fixtures,
			files: ["file-group.md"],
			config: { include: ["**/*.md"], defaultGroup: "file" },
		})
		expect(errors(result.diagnostics)).toHaveLength(0)
		// Both fences share one virtual file under the file-level group.
		expect(result.virtualFiles).toHaveLength(1)
	})

	it("does not suggest group= when defaultGroup=file is active", async () => {
		const result = await checkMarkdownFiles({
			cwd: fixtures,
			files: ["file-group.md"],
			config: { include: ["**/*.md"], defaultGroup: "file" },
		})
		expect(result.diagnostics.some((d) => d.code === "group")).toBe(false)
	})

	it("group=none detaches a fence from the file group, re-surfacing TS2304", async () => {
		const result = await checkMarkdownFiles({
			cwd: fixtures,
			files: ["file-group-detach.md"],
			config: { include: ["**/*.md"], defaultGroup: "file" },
		})
		expect(errors(result.diagnostics).some((d) => d.code === 2304)).toBe(true)
	})

	it("a per-glob override can opt a subtree out of file grouping", async () => {
		const result = await checkMarkdownFiles({
			cwd: fixtures,
			files: ["file-group.md"],
			config: {
				include: ["**/*.md"],
				defaultGroup: "file",
				overrides: [{ include: ["**/*.md"], defaultGroup: "none" }],
			},
		})
		// Opted back out -> the continuation fence cannot find `greeting`.
		expect(errors(result.diagnostics).some((d) => d.code === 2304)).toBe(true)
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
