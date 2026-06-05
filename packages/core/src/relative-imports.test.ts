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
})
