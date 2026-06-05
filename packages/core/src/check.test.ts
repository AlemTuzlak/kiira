import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { checkMarkdownFiles } from "./check"
import type { TypedownDiagnostic } from "./types"

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = resolve(here, "../tests/fixtures/check")

function errors(diagnostics: TypedownDiagnostic[]): TypedownDiagnostic[] {
	return diagnostics.filter((d) => d.severity === "error")
}

describe("checkMarkdownFiles", () => {
	it("reports a missing export as TS2305 mapped to the Markdown source range", async () => {
		const result = await checkMarkdownFiles({
			cwd: fixtures,
			files: ["docs.md"],
			config: { include: ["**/*.md"] },
		})

		const missing = errors(result.diagnostics).find((d) => d.code === 2305)
		expect(missing).toBeDefined()
		expect(missing?.source).toBe("typescript")
		expect(missing?.markdownFile).toBe("docs.md")
		expect(missing?.markdownRange.start.line).toBe(5)
		// `import { ` is 9 characters, so the member starts at character 9.
		expect(missing?.markdownRange.start.character).toBe(9)
	})

	it("reports a plain type error (TS2322) on its Markdown line", async () => {
		const result = await checkMarkdownFiles({
			cwd: fixtures,
			files: ["docs.md"],
			config: { include: ["**/*.md"] },
		})
		const typeError = errors(result.diagnostics).find((d) => d.code === 2322)
		expect(typeError?.markdownRange.start.line).toBe(19)
	})

	it("produces no errors for snippets that type-check cleanly", async () => {
		const result = await checkMarkdownFiles({
			cwd: fixtures,
			files: ["docs.md"],
			config: { include: ["**/*.md"] },
		})
		// Only the two intentionally-broken snippets should error.
		expect(errors(result.diagnostics)).toHaveLength(2)
	})

	it("computes stats", async () => {
		const result = await checkMarkdownFiles({
			cwd: fixtures,
			files: ["docs.md"],
			config: { include: ["**/*.md"] },
		})
		expect(result.stats.markdownFiles).toBe(1)
		expect(result.stats.snippets).toBe(3)
		expect(result.stats.checked).toBe(3)
		expect(result.stats.ignored).toBe(0)
		expect(result.stats.errors).toBe(2)
	})

	it("maps diagnostics back through prepended fixture lines", async () => {
		const result = await checkMarkdownFiles({
			cwd: fixtures,
			files: ["with-fixture.md"],
			config: {
				include: ["**/*.md"],
				fixtures: {
					node: { type: "prepend", content: "const a = 1\nconst b = 2\nconst c = 3" },
				},
			},
		})
		const typeError = errors(result.diagnostics).find((d) => d.code === 2322)
		expect(typeError).toBeDefined()
		// The error is on the single code line (Markdown line 1), despite the
		// three prepended fixture lines pushing it to virtual line 3.
		expect(typeError?.markdownRange.start.line).toBe(1)
	})
})
