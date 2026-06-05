import type { ExtractedSnippet } from "./types"
import { buildVirtualFile, mapVirtualLine, virtualFileName } from "./virtual"

function snippet(overrides: Partial<ExtractedSnippet> = {}): ExtractedSnippet {
	return {
		id: "docs/intro.md#0",
		markdownFile: "docs/intro.md",
		lang: "tsx",
		code: "const a = 1\nconst b = 2",
		meta: {},
		markdownRange: { start: { line: 0, character: 0 }, end: { line: 4, character: 3 } },
		codeStart: { line: 1, character: 0 },
		...overrides,
	}
}

describe("virtualFileName", () => {
	it("derives a stable filename from the markdown path, index, and language", () => {
		expect(virtualFileName(snippet({ id: "docs/intro.md#0", lang: "tsx" }))).toBe("docs__intro__snippet_000.tsx")
		expect(virtualFileName(snippet({ id: "README.md#2", markdownFile: "README.md", lang: "ts" }))).toBe(
			"README__snippet_002.ts"
		)
	})
})

describe("buildVirtualFile", () => {
	it("returns the code verbatim when there is no fixture", () => {
		const s = snippet({ code: "const a = 1\nconst b = 2", codeStart: { line: 10, character: 0 } })
		const built = buildVirtualFile({ snippet: s })

		expect(built.content).toBe("const a = 1\nconst b = 2")
		expect(built.mappings).toEqual([
			{ virtualLine: 0, markdownLine: 10, characterDelta: 0 },
			{ virtualLine: 1, markdownLine: 11, characterDelta: 0 },
		])
	})

	it("prepends fixture lines as generated (unmapped) lines", () => {
		const s = snippet({ code: "useChat()", codeStart: { line: 20, character: 0 } })
		const built = buildVirtualFile({ snippet: s, before: 'import * as React from "react"' })

		expect(built.content).toBe('import * as React from "react"\nuseChat()')
		expect(built.mappings[0]).toEqual({ virtualLine: 0, markdownLine: null, characterDelta: 0 })
		expect(built.mappings[1]).toEqual({ virtualLine: 1, markdownLine: 20, characterDelta: 0 })
	})

	it("maps a diagnostic line back through prepended fixture lines (acceptance)", () => {
		// Snippet starts on markdown line 20; fixture prepends 3 lines.
		const s = snippet({ code: "line0\nline1\nline2", codeStart: { line: 20, character: 0 } })
		const built = buildVirtualFile({ snippet: s, before: "a\nb\nc" })

		// Virtual line 5 is the 3rd code line (5 - 3 prepended) -> markdown line 22.
		expect(mapVirtualLine(built.mappings, 5)).toBe(22)
	})

	it("wraps code with before and after blocks", () => {
		const s = snippet({ code: "return <div />", codeStart: { line: 5, character: 0 } })
		const built = buildVirtualFile({
			snippet: s,
			before: "export function Example() {",
			after: "}",
		})

		expect(built.content).toBe("export function Example() {\nreturn <div />\n}")
		expect(built.mappings.map((m) => m.markdownLine)).toEqual([null, 5, null])
	})
})

describe("createVirtualFiles uniqueness", () => {
	it("disambiguates filenames when distinct paths flatten to the same base", async () => {
		const { createVirtualFiles } = await import("./virtual")
		const a = snippet({ id: "a/b.md#0", markdownFile: "a/b.md", lang: "ts", code: "const x = 1" })
		const b = snippet({ id: "a__b.md#0", markdownFile: "a__b.md", lang: "ts", code: "const y = 1" })
		const { virtualFiles } = await createVirtualFiles({ cwd: "/repo", snippets: [a, b], config: {} })
		const names = virtualFiles.map((v) => v.fileName)
		expect(new Set(names).size).toBe(2)
	})
})

describe("mapVirtualLine", () => {
	it("returns null for generated lines and out-of-range lines", () => {
		const mappings = buildVirtualFile({ snippet: snippet({ code: "x" }), before: "gen" }).mappings
		expect(mapVirtualLine(mappings, 0)).toBeNull()
		expect(mapVirtualLine(mappings, 99)).toBeNull()
	})
})
