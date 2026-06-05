import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { extractMarkdownSnippets } from "./extract"
import type { TypedownConfig } from "./types"
import { createVirtualFiles } from "./virtual"

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = resolve(here, "../tests/fixtures/markdown")

const configWithReact: Partial<TypedownConfig> = {
	include: ["**/*.md"],
	fixtures: {
		react: { type: "prepend", content: 'import * as React from "react"' },
	},
}

async function snippets() {
	return extractMarkdownSnippets({ cwd: fixtures, files: ["intro.md"], config: { include: ["**/*.md"] } })
}

describe("createVirtualFiles", () => {
	it("creates one virtual file per checkable snippet and skips ignored ones", async () => {
		const { virtualFiles } = await createVirtualFiles({
			cwd: fixtures,
			snippets: await snippets(),
			config: configWithReact,
		})
		// ts (#0) and tsx (#1) are checkable; the ignored ts fence is skipped.
		expect(virtualFiles).toHaveLength(2)
		expect(virtualFiles.map((v) => v.lang)).toEqual(["ts", "tsx"])
	})

	it("applies the named fixture and maps generated lines to null", async () => {
		const { virtualFiles } = await createVirtualFiles({
			cwd: fixtures,
			snippets: await snippets(),
			config: configWithReact,
		})
		const tsx = virtualFiles.find((v) => v.lang === "tsx")
		expect(tsx?.content.startsWith('import * as React from "react"\n')).toBe(true)
		expect(tsx?.mappings[0]?.markdownLine).toBeNull()
		expect(tsx?.fileName.replace(/\\/g, "/").endsWith(".typedown/virtual/intro__snippet_001.tsx")).toBe(true)
	})

	it("warns and checks as tsx when a ts fence contains JSX", async () => {
		const snippet = {
			id: "comp.md#0",
			markdownFile: "comp.md",
			lang: "ts" as const,
			code: "export const C = () => <div>{1}</div>",
			meta: {},
			markdownRange: { start: { line: 4, character: 0 }, end: { line: 6, character: 3 } },
			codeStart: { line: 5, character: 0 },
		}
		const { virtualFiles, diagnostics } = await createVirtualFiles({
			cwd: fixtures,
			snippets: [snippet],
			config: { include: ["**/*.md"] },
		})
		const warning = diagnostics.find((d) => d.code === "language-tag")
		expect(warning?.severity).toBe("warning")
		expect(warning?.fix).toEqual({ kind: "fence-language", line: 4, language: "tsx" })
		// The virtual file is checked as tsx, not ts.
		expect(virtualFiles[0]?.lang).toBe("tsx")
		expect(virtualFiles[0]?.fileName.endsWith(".tsx")).toBe(true)
	})

	it("reports a diagnostic for an unknown fixture instead of throwing", async () => {
		const { virtualFiles, diagnostics } = await createVirtualFiles({
			cwd: fixtures,
			snippets: await snippets(),
			config: { include: ["**/*.md"] }, // no `react` fixture defined
		})
		expect(diagnostics).toHaveLength(1)
		expect(diagnostics[0]?.message).toContain("react")
		// The snippet is still emitted (without the fixture) so it can be checked.
		expect(virtualFiles).toHaveLength(2)
	})
})
