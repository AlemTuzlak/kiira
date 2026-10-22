import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { checkMarkdownFiles } from "./check"

const here = dirname(fileURLToPath(import.meta.url))
const fixtures = resolve(here, "../tests/fixtures/relative-imports")

describe("relative import handling", () => {
	it("ignores unresolved relative imports by default, but still flags bare package imports", async () => {
		const result = await checkMarkdownFiles({
			cwd: fixtures,
			files: ["doc.md"],
			config: { include: ["**/*.md"] },
		})
		expect(result.diagnostics.some((d) => d.message.includes("./tool-definitions"))).toBe(false)
		expect(result.diagnostics.some((d) => d.message.includes("totally-not-a-real-package-xyz"))).toBe(true)
	})

	it("reports unresolved relative imports when checkRelativeImports is enabled", async () => {
		const result = await checkMarkdownFiles({
			cwd: fixtures,
			files: ["doc.md"],
			config: { include: ["**/*.md"], checkRelativeImports: true },
		})
		expect(result.diagnostics.some((d) => d.code === 2307 && d.message.includes("./tool-definitions"))).toBe(true)
	})

	it("still type-checks calls that use an unresolved relative import (#44)", async () => {
		const result = await checkMarkdownFiles({
			cwd: fixtures,
			files: ["hidden-errors.md"],
			config: { include: ["**/*.md"] },
		})
		// The missing `count` is reported; the stubbed value, type and default imports are `any`.
		expect(result.diagnostics.map((d) => [d.code, d.markdownRange.start.line])).toEqual([[2345, 11]])
		expect(result.diagnostics[0]?.message).toContain("Property 'count' is missing")
	})

	it("resolves an unresolved relative import to an earlier fence that exports the names", async () => {
		const result = await checkMarkdownFiles({
			cwd: fixtures,
			files: ["earlier-fence.md"],
			config: { include: ["**/*.md"] },
		})
		// `amount` keeps its real `number` type from the first fence.
		expect(result.diagnostics.map((d) => [d.code, d.markdownRange.start.line])).toEqual([[2322, 10]])
	})
})
